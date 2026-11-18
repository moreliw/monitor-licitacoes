import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { extractPdfText, DocPipeline } from '../docs.ts';
import { buildPdf } from '../testpdf.ts';
import { makeStore, rec } from './helpers.ts';
import { normalizeProcurement } from '../pncp.ts';
import { validateExternalUrl, resolveSafeUrl, safeJoin, isPrivateHost } from '../links.ts';
import type { SourceConnector } from '../connector.ts';

test('PDF paginado: texto extraído em worker isolado, página a página', async () => {
  const ex = await extractPdfText(buildPdf(['Sistema de gestao do processo legislativo ' + 'x'.repeat(40), 'Segunda pagina com votacao eletronica ' + 'y'.repeat(40)]), { maxPages: 10, timeoutMs: 30_000 });
  assert.equal(ex.textStatus, 'ok');
  assert.equal(ex.totalPages, 2);
  assert.match(ex.pages[0].text, /processo legislativo/);
  assert.match(ex.pages[1].text, /votacao eletronica/);
});

test('PDF: limite de páginas sinaliza extração parcial; PDF sem texto sinaliza imagem; lixo gera erro', async () => {
  const pdf = buildPdf(Array.from({ length: 4 }, (_, i) => `Pagina ${i} ` + 'texto '.repeat(20)));
  const parcial = await extractPdfText(pdf, { maxPages: 2, timeoutMs: 30_000 });
  assert.equal(parcial.pages.length, 2);
  assert.equal(parcial.textStatus, 'parcial');
  const img = await extractPdfText(buildPdf(['', '']), { maxPages: 5, timeoutMs: 30_000 });
  assert.equal(img.textStatus, 'imagem');
  const bad = await extractPdfText(new Uint8Array(Buffer.from('%PDF-1.4 isto nao e um pdf valido')), { maxPages: 5, timeoutMs: 30_000 });
  assert.equal(bad.textStatus, 'erro');
});

function fakeConnector(bytes: () => Uint8Array): SourceConnector {
  return {
    id: 'pncp', label: 'x', coverage: () => '',
    listWindow: async () => { throw new Error('n/a'); }, fetchDetail: async () => { throw new Error('n/a'); },
    fetchItems: async () => [], fetchDocuments: async () => [], fetchModalidades: async () => [],
    downloadDocument: async () => ({ bytes: bytes(), contentType: 'application/pdf', fileName: 'edital.pdf' }),
  };
}

test('pipeline de anexos: guarda SHA-256, texto por página, classifica pelo termo de referência e detecta mudança de conteúdo', async () => {
  const env = makeStore();
  const n = normalizeProcurement(rec({ objeto: 'Locação de licenças de programas' }), 'x');
  const { id } = env.store.upsertProcurement(n, { silent: false, level: 1, route: 'detalhe' });
  env.store.saveDocuments(id, [{ sequencial: 1, titulo: 'Termo de Referência.pdf', tipoId: 2, tipoNome: 'Termo de Referência', url: 'https://pncp.gov.br/x', dataPublicacao: null, ativo: true }]);
  let content = buildPdf(['Lote 2: sistema de gestao do processo legislativo com tramitacao legislativa ' + 'a'.repeat(30)]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anx-'));
  const pipe = new DocPipeline(env.store, fakeConnector(() => content), dir);
  const docId = env.db.get<any>('SELECT id FROM documents').id;
  assert.equal(env.db.get<any>('SELECT priority p FROM documents').p, 90, 'TR é prioridade alta');

  assert.equal((await pipe.process(docId)).status, 'ok');
  const d1 = env.db.get<any>('SELECT * FROM documents WHERE id=?', docId);
  assert.equal(d1.sha256.length, 64);
  assert.equal(d1.status, 'baixado');
  assert.ok(fs.existsSync(path.join(dir, `${d1.sha256}.pdf`)));
  assert.equal(env.db.get<any>('SELECT COUNT(*) c FROM doc_pages').c, 1);
  const ev = env.db.get<any>("SELECT relevance FROM procurements").relevance;
  assert.equal(ev, 'alta', 'evidência vinda do TR eleva a relevância');
  const cls = env.db.get<any>('SELECT evidences FROM classifications').evidences;
  assert.ok(JSON.parse(cls).some((e: any) => e.field === 'documento' && e.page === 1));

  // mesma URL, conteúdo diferente: detectado por hash
  content = buildPdf(['Lote 2 alterado: sistema de gestao do processo legislativo ' + 'b'.repeat(30)]);
  await pipe.process(docId);
  const d2 = env.db.get<any>('SELECT * FROM documents WHERE id=?', docId);
  assert.notEqual(d2.sha256, d1.sha256);
  assert.equal(d2.version, d1.version + 1);
  assert.equal(env.db.get<any>("SELECT COUNT(*) c FROM events WHERE type='documento_alterado'").c, 1);
  // busca nos documentos (FTS) funciona offline
  assert.equal(env.db.all("SELECT control_id FROM search_fts WHERE search_fts MATCH 'tramitacao OR alterado'").length, 1);
});

test('arquivo que não é PDF é ignorado, nunca executado', async () => {
  const env = makeStore();
  const n = normalizeProcurement(rec(), 'x');
  const { id } = env.store.upsertProcurement(n, { silent: false, level: 1, route: 'detalhe' });
  env.store.saveDocuments(id, [{ sequencial: 1, titulo: 'x.exe', tipoId: 1, tipoNome: 'Edital', url: 'https://pncp.gov.br/x', dataPublicacao: null, ativo: true }]);
  const pipe = new DocPipeline(env.store, fakeConnector(() => new Uint8Array(Buffer.from('MZ\x90\x00 programa'))), fs.mkdtempSync(path.join(os.tmpdir(), 'anx-')));
  assert.equal((await pipe.process(env.db.get<any>('SELECT id FROM documents').id)).status, 'ignorado');
  assert.equal(env.db.get<any>('SELECT status s FROM documents').s, 'ignorado');
});

test('links externos: somente HTTPS público, sem credenciais; redirecionamento validado', async () => {
  assert.ok(validateExternalUrl('https://pncp.gov.br/app/editais/1/2026/2'));
  for (const bad of ['http://pncp.gov.br', 'javascript:alert(1)', 'file:///c:/x', 'https://u:p@x.gov.br', 'https://localhost/x', 'https://127.0.0.1/', 'https://192.168.0.1/', 'https://[::1]/', 'https://intranet/x', null, 42]) {
    assert.equal(validateExternalUrl(bad as any), null, String(bad));
  }
  assert.equal(isPrivateHost('10.1.2.3'), true);
  assert.equal(isPrivateHost('8.8.8.8'), false);
  const redirect = (async (u: any) => String(u).includes('a.gov.br') ? new Response(null, { status: 302, headers: { location: 'http://evil.com/x' } }) : new Response(null, { status: 200 })) as unknown as typeof fetch;
  assert.equal(await resolveSafeUrl('https://a.gov.br/x', redirect), null);
  const ok = (async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
  assert.equal(await resolveSafeUrl('https://b.gov.br/x', ok), 'https://b.gov.br/x');
  const offline = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
  assert.equal(await resolveSafeUrl('https://b.gov.br/x', offline), 'https://b.gov.br/x');
});

test('protocolo app://: sem travessia de diretório', () => {
  const root = path.join(os.tmpdir(), 'ui');
  assert.ok(safeJoin(root, '/index.html', path.join, path.sep)?.startsWith(root));
  assert.equal(safeJoin(root, '/../secret.txt', path.join, path.sep), null);
  assert.equal(safeJoin(root, '/%2e%2e/secret.txt', path.join, path.sep), null);
  assert.equal(safeJoin(root, '/a\0b', path.join, path.sep), null);
});

test('editais: cópia local para visualizar/baixar reaproveita o arquivo e usa a extensão real', async () => {
  const env = makeStore();
  const { id } = env.store.upsertProcurement(normalizeProcurement(rec(), 'x'), { silent: false, level: 1, route: 'detalhe' });
  env.store.saveDocuments(id, [
    { sequencial: 1, titulo: 'Edital Pregão 09/2026.pdf', tipoId: 1, tipoNome: 'Edital', url: 'https://pncp.gov.br/x', dataPublicacao: null, ativo: true },
    { sequencial: 2, titulo: 'Planilha.xlsx', tipoId: 2, tipoNome: 'Anexo', url: 'https://pncp.gov.br/y', dataPublicacao: null, ativo: true },
  ]);
  let calls = 0;
  const conn = fakeConnector(() => { calls++; return calls === 1 ? buildPdf(['edital']) : new Uint8Array(Buffer.from('PK\x03\x04conteudo')); });
  const pipe = new DocPipeline(env.store, conn, fs.mkdtempSync(path.join(os.tmpdir(), 'anx-')));
  const [d1, d2] = env.db.all<any>('SELECT id FROM documents ORDER BY sequencial');
  const a = await pipe.ensureLocal(d1.id);
  assert.equal(a.kind, 'pdf');
  assert.equal(a.fileName, 'Edital Pregão 09_2026.pdf');
  assert.ok(fs.existsSync(a.path));
  await pipe.ensureLocal(d1.id);
  assert.equal(calls, 1, 'não baixa de novo');
  const b = await pipe.ensureLocal(d2.id);
  assert.equal(b.kind, 'outro');
  assert.equal(b.ext, 'xlsx');
});
