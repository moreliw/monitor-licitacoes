import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { agilFit } from '../agil.ts';
import { DocPipeline, MAX_DOC_ATTEMPTS, type Extractor } from '../docs.ts';
import { listZip, officeText } from '../zip.ts';
import { dailyBackup, listBackups } from '../backup.ts';
import { openDb } from '../db.ts';
import { HttpError } from '../http.ts';
import { normalizeProcurement } from '../pncp.ts';
import { getOpportunity, listOpportunities, opportunityStats } from '../query.ts';
import { SyncEngine } from '../sync.ts';
import { rescueDeletedRecords, upgradeClassification } from '../services.ts';
import { makeStore, rec } from './helpers.ts';
import type { SourceConnector } from '../connector.ts';

const put = (env: ReturnType<typeof makeStore>, seq: number, over: Record<string, any>) =>
  env.store.upsertProcurement(normalizeProcurement(rec({ sequencialCompra: seq, ...over }), 'x'), { silent: true, level: 0, route: 'lista' }).id;

// ---------- aderência ----------
test('aderência ao Ágil: núcleo, plenário, compilação, condicionada e fora', () => {
  const jaguare = agilFit({ objeto: 'Solução integrada: portal institucional, portal legislativo, sistema de processo e tramitação eletrônica legislativa, sessões e votação eletrônica, e-SIC/LAI e ouvidoria, 30 contas de e-mail institucional', relevance: 'alta' });
  assert.equal(jaguare.aderencia, 'nucleo');
  assert.ok(jaguare.bloqueios.includes('e-SIC / LAI / ouvidoria'));
  assert.ok(jaguare.bloqueios.includes('Portal institucional (CMS)'));

  const tanabi = agilFit({ objeto: 'Locação de sistema de votação eletrônica para as sessões plenárias, com painel eletrônico, registro de presença e quórum', relevance: 'alta' });
  assert.equal(tanabi.aderencia, 'plenario');
  assert.ok(tanabi.score >= 70, String(tanabi.score));

  const cruzeiro = agilFit({ objeto: 'Estruturação e atualização do repositório legislativo, compilação, consolidação e indexação dos atos normativos', relevance: 'alta' });
  assert.equal(cruzeiro.aderencia, 'compilacao');

  const linhares = agilFit({ objeto: 'Solução integrada de gestão pública: compras e licitações, folha de pagamento, patrimônio, almoxarifado e protocolo eletrônico com tramitação', relevance: 'revisar' });
  assert.equal(linhares.aderencia, 'condicionada');

  const paineiras = agilFit({ objeto: 'Plataforma SaaS para gestão e transparência das emendas parlamentares impositivas e parcerias com organizações da sociedade civil', relevance: 'revisar' });
  assert.equal(paineiras.aderencia, 'complemento');
  assert.ok(paineiras.lacunas.includes('Emendas impositivas e parcerias com OSC'));

  assert.equal(agilFit({ objeto: 'Gerenciamento do abastecimento de combustíveis da frota', relevance: 'fora' }).aderencia, 'fora');
  // menção solta no edital (uma vez) não conta; duas contam
  assert.ok(!agilFit({ objeto: 'Locação de software', docs: ['... transcrição ...'] }).temas.some((t) => t.id === 'transcricao'));
  assert.ok(agilFit({ objeto: 'Locação de software', docs: ['transcrição automática', 'transcrição revisada'] }).temas.some((t) => t.id === 'transcricao'));
});

test('aderência: gravada por oportunidade, filtra e ordena a lista; alvo aberto entra sozinho em Triagem uma única vez', () => {
  const env = makeStore();
  const alvo = put(env, 1, { objeto: 'Locação de software de processo legislativo com tramitação legislativa e votação eletrônica', encerramento: '2026-11-30T09:00:00' });
  const erp = put(env, 2, { objeto: 'Sistema de gestão legislativa integrado a contabilidade, folha de pagamento, patrimônio e almoxarifado' });
  assert.equal(listOpportunities(env.store, { aderencia: ['nucleo'] }).total, 1);
  assert.equal(listOpportunities(env.store, { aderencia: ['condicionada'] }).rows[0].id, erp);
  const top = listOpportunities(env.store, { sort: 'agil', dir: 'desc' }).rows[0];
  assert.equal(top.id, alvo);
  assert.ok(Array.isArray(top.agil_lacunas));
  const det = getOpportunity(env.store, alvo)!;
  assert.equal(det.agil.aderencia, 'nucleo');
  assert.ok(det.agil.temas.some((t: any) => t.id === 'tramitacao' && t.situacao === 'parcial'));

  // acompanhamento automático
  const w = env.db.get<any>('SELECT status, notes FROM watchlist WHERE procurement_id=?', alvo);
  assert.equal(w.status, 'triagem');
  assert.match(w.notes, /aderência ao Ágil/);
  assert.equal(opportunityStats(env.store).alvosAbertos, 1);
  // quem tirou do acompanhamento não volta a ser acompanhado sozinho
  env.store.setWatch(alvo, null);
  env.store.reclassify(alvo);
  assert.equal(env.db.get<any>('SELECT COUNT(*) c FROM watchlist WHERE procurement_id=?', alvo).c, 0);
  // configuração desligada
  env.settings.set({ acompanharAlvosAgil: false });
  const outro = put(env, 3, { objeto: 'Sistema de votação eletrônica e painel eletrônico para as sessões plenárias' });
  assert.equal(env.db.get<any>('SELECT COUNT(*) c FROM watchlist WHERE procurement_id=?', outro).c, 0);
});

test('republicações da mesma compra e datas incoerentes aparecem na lista', () => {
  const env = makeStore();
  const a = put(env, 10, { objeto: 'Software de processo legislativo' });
  put(env, 11, { objeto: 'Software de processo legislativo' }); // mesmo órgão, ano e número da compra (rec usa numeroCompra '1')
  const r = listOpportunities(env.store, {}).rows.find((x) => x.id === a)!;
  assert.equal(r.republicacoes, 1);
  assert.equal(getOpportunity(env.store, a)!.republicacoes_lista.length, 1);
  env.db.run("UPDATE procurements SET data_publicacao='2026-11-22T10:00:00Z', encerramento_utc='2025-09-18T13:00:00Z' WHERE id=?", a);
  assert.equal(listOpportunities(env.store, {}).rows.find((x) => x.id === a)!.datas_a_conferir, 1);
});

// ---------- sem perda de dados ----------
test('acervo sem perdas: candidato que vira "fora" depois da leitura do edital continua no banco (caso Santa Isabel)', () => {
  const env = makeStore();
  const id = put(env, 1, { objeto: 'Prestação de serviços técnicos voltados ao aperfeiçoamento dos fluxos internos, com licenciamento de uso, implantação e hospedagem' });
  assert.notEqual(env.db.get<any>('SELECT relevance r FROM procurements WHERE id=?', id).r, 'fora');
  // enriquecimento sem sinais legislativos: reclassifica como fora
  env.store.saveItems(id, []);
  env.store.reclassify(id);
  env.db.run("UPDATE procurements SET relevance='fora' WHERE id=?", id);
  assert.equal(env.store.purgeOutOfProfile(), 0);
  assert.equal(env.db.get<any>('SELECT COUNT(*) c FROM procurements WHERE id=?', id).c, 1);
  // some da lista padrão, mas aparece quando pedido
  assert.equal(listOpportunities(env.store, {}).total, 0);
  assert.equal(listOpportunities(env.store, { incluirFora: true }).total, 1);
  // abertura do app com regras novas também não apaga
  env.db.run("UPDATE classifications SET rules_version='2026.11.1'");
  upgradeClassification(env.store, new SyncEngine({ store: env.store, connector: { id: 'pncp' } as any, clock: env.clock.now }));
  assert.equal(env.db.get<any>('SELECT COUNT(*) c FROM procurements WHERE id=?', id).c, 1);
});

test('resgate: janelas de publicação recentes são reabertas uma única vez', () => {
  const env = makeStore();
  env.settings.set({ modalidades: [6, 8] });
  const engine = new SyncEngine({ store: env.store, connector: { id: 'pncp' } as any, clock: env.clock.now });
  const n = rescueDeletedRecords(env.store, engine, 10);
  assert.equal(n, 11 * 2);
  assert.equal(env.db.get<any>("SELECT COUNT(*) c FROM sync_jobs WHERE kind='discover' AND priority=4 AND status='pendente'").c, 22);
  assert.equal(rescueDeletedRecords(env.store, engine, 10), 0);
});

test('cópia diária do banco: uma por dia, mantém só as mais recentes e é um banco válido', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bkp-'));
  const db = openDb(path.join(dir, 'monitor.sqlite'));
  db.run("INSERT INTO settings(key,value) VALUES ('x','1')");
  const d = (s: string) => new Date(s);
  assert.ok(dailyBackup(db, 2, d('2026-11-20T15:00:00Z')));
  assert.equal(dailyBackup(db, 2, d('2026-11-20T18:00:00Z')), null, 'uma por dia');
  dailyBackup(db, 2, d('2026-11-21T15:00:00Z'));
  dailyBackup(db, 2, d('2026-11-22T15:00:00Z'));
  const list = listBackups(db.file);
  assert.equal(list.length, 2);
  assert.match(path.basename(list[0]), /20261122/);
  const copy = openDb(list[0]);
  assert.equal(copy.get<any>("SELECT value FROM settings WHERE key='x'").value, '1');
  copy.close(); db.close();
});

// ---------- anexos ----------
function zip(files: Record<string, string | Uint8Array>): Uint8Array {
  const locals: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
    const data = zlib.deflateRawSync(raw);
    const nameBuf = Buffer.from(name, 'utf8');
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(raw.length, 22); lh.writeUInt16LE(nameBuf.length, 26);
    locals.push(lh, nameBuf, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(raw.length, 24); ch.writeUInt16LE(nameBuf.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, end]));
}
const docx = (text: string) => zip({ '[Content_Types].xml': '<x/>', 'word/document.xml': `<w:document><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p><w:p><w:r><w:t>Segundo &amp; último</w:t></w:r></w:p></w:body></w:document>` });

test('ZIP e DOCX: leitura sem dependências, nomes UTF-8 e texto do Word', () => {
  const z = zip({ 'Termo de Referência.txt': 'Sistema de votação eletrônica' });
  assert.equal(listZip(z)[0].name, 'Termo de Referência.txt');
  assert.equal(officeText(docx('Tramitação legislativa'), 1e6), 'Tramitação legislativa\nSegundo & último');
  assert.equal(officeText(z, 1e6), null);
});

function connector(impl: () => Promise<Uint8Array>): SourceConnector {
  return {
    id: 'pncp', label: 'x', coverage: () => '',
    listWindow: async () => { throw new Error('n/a'); }, fetchDetail: async () => { throw new Error('n/a'); },
    fetchItems: async () => [], fetchDocuments: async () => [], fetchModalidades: async () => [],
    downloadDocument: async () => ({ bytes: await impl(), contentType: 'application/zip', fileName: 'x' }),
  };
}
const fakePdf: Extractor = async (b) => ({ pages: [{ page: 1, text: Buffer.from(b).toString('latin1').replace('%PDF-', '') }], totalPages: 1, textStatus: 'ok' });

function docEnv(title: string) {
  const env = makeStore();
  const id = put(env, 1, { objeto: 'Locação de software para a Câmara' });
  env.store.saveDocuments(id, [{ sequencial: 1, titulo: title, tipoId: 1, tipoNome: 'Edital', url: 'https://pncp.gov.br/x', dataPublicacao: null, ativo: true }]);
  const docId = env.db.get<any>('SELECT id FROM documents').id;
  return { env, id, docId, dir: fs.mkdtempSync(path.join(os.tmpdir(), 'anx-')) };
}

test('anexo ZIP: PDFs e DOCX de dentro do ZIP viram texto pesquisável e entram na classificação', async () => {
  const { env, id, docId, dir } = docEnv('EDITAL_COPILACAO_01');
  const pdf = new Uint8Array(Buffer.from('%PDF-Termo de referência: repositório legislativo, compilação e consolidação das leis. ' + 'x'.repeat(50), 'latin1'));
  const pack = zip({ 'b/anexo.docx': docx('Sistema de tramitação legislativa e votação eletrônica'), 'a/TR.pdf': pdf, 'leia.exe': 'MZ' });
  const pipe = new DocPipeline(env.store, connector(async () => pack), dir, fakePdf);
  assert.equal((await pipe.process(docId)).status, 'ok');
  const pages = env.db.all<any>('SELECT text FROM doc_pages ORDER BY page').map((p) => p.text);
  assert.equal(pages.length, 2);
  assert.match(pages[0], /^\[Arquivo do ZIP: TR\.pdf\]/);
  assert.match(pages[1], /tramitação legislativa/);
  assert.ok(fs.existsSync(env.db.get<any>('SELECT local_path p FROM documents').p));
  assert.notEqual(env.db.get<any>('SELECT aderencia a FROM agil_fit WHERE procurement_id=?', id).a, 'fora');
});

test('anexo 404: usa a cópia local já baixada; sem cópia, tenta de novo em 1, 2, 4… dias até o limite', async () => {
  const { env, docId, dir } = docEnv('Edital.pdf');
  const gone = connector(async () => { throw new HttpError('Anexo não encontrado', 404, 'https://pncp.gov.br/x', true); });
  // sem cópia local
  const pipe = new DocPipeline(env.store, gone, dir, fakePdf);
  assert.equal((await pipe.process(docId)).status, 'erro');
  let d = env.db.get<any>('SELECT * FROM documents WHERE id=?', docId);
  assert.equal(d.attempts, 1);
  assert.equal(Date.parse(d.revalidate_at) - Date.parse(env.store.now()), 86_400_000);
  for (let i = 2; i <= MAX_DOC_ATTEMPTS; i++) await pipe.process(docId);
  d = env.db.get<any>('SELECT * FROM documents WHERE id=?', docId);
  assert.equal(d.attempts, MAX_DOC_ATTEMPTS);
  assert.equal(d.revalidate_at, null, 'para de tentar sozinho');
  // com cópia local
  const file = path.join(dir, 'copia.pdf');
  fs.writeFileSync(file, '%PDF-Edital com processo legislativo ' + 'y'.repeat(60));
  env.db.run('UPDATE documents SET local_path=? WHERE id=?', file, docId);
  assert.equal((await pipe.process(docId)).status, 'ok');
  assert.equal(env.db.get<any>('SELECT attempts a FROM documents WHERE id=?', docId).a, 0);
});

test('retenção de anexos não apaga arquivo de oportunidade do nicho', () => {
  const { env, docId, dir } = docEnv('Edital.pdf');
  const keep = path.join(dir, 'a.pdf'), orphan = path.join(dir, 'b.pdf');
  fs.writeFileSync(keep, 'x'); fs.writeFileSync(orphan, 'y');
  const old = new Date(Date.now() - 400 * 86_400_000);
  fs.utimesSync(keep, old, old); fs.utimesSync(orphan, old, old);
  env.db.run('UPDATE documents SET local_path=? WHERE id=?', keep, docId);
  const pipe = new DocPipeline(env.store, connector(async () => new Uint8Array()), dir, fakePdf);
  assert.equal(pipe.purge(90), 1);
  assert.ok(fs.existsSync(keep));
  assert.ok(!fs.existsSync(orphan));
});

test('prioridade de anexos: edital, TR, retificação, ETP, anexos e atas', () => {
  const { store } = makeStore();
  const p = (titulo: string) => store.docPriority({ titulo, tipoNome: null });
  assert.equal(p('EDITAL PR11.2026'), 100);
  assert.equal(p('Termo_de_Referencia_Oficial_copilacao'), 90);
  assert.equal(p('Decisão sobre impugnação nº 1'), 85);
  assert.equal(p('ESTUDO TÉCNICO PRELIMINAR (ETP)'), 80);
  assert.equal(p('ANEXOS_EM_WORD'), 70);
  assert.equal(p('Ata de julgamento'), 60);
  assert.equal(p('Pesquisa de Preço'), 10);
});
