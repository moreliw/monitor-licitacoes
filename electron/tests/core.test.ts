import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseInstant, ymd, addDaysYmd } from '../time.ts';
import { deriveState } from '../states.ts';
import { csvCell, toCsv } from '../csv.ts';
import { toFtsQuery, openDb } from '../db.ts';
import { normalizeCnpj, normalizeProcurement, normalizeItem, normalizeDocument, toCents, safeHttpsUrl, sniffFileType, buildControlId } from '../pncp.ts';
import { fixture, rec } from './helpers.ts';
import { sanitizeSettings } from '../settings.ts';
import { assessText } from '../docs.ts';

test('datas: sem offset = Brasília; offset explícito preservado; inválidas viram null', () => {
  assert.equal(parseInstant('2026-11-12T09:00:00')?.utc, '2026-11-12T12:00:00.000Z');
  assert.equal(parseInstant('2026-11-12T09:00:00')?.origin, 'pncp-brasilia');
  assert.equal(parseInstant('2026-11-12T09:00:00+00:00')?.utc, '2026-11-12T09:00:00.000Z');
  assert.equal(parseInstant('2026-11-12T09:00:00+00:00')?.origin, 'offset-explicito');
  assert.equal(parseInstant('2026-11-12T09:00:00Z')?.utc, '2026-11-12T09:00:00.000Z');
  assert.equal(parseInstant(null), null);
  assert.equal(parseInstant(''), null);
  assert.equal(parseInstant('2026-02-31T10:00:00'), null);
  assert.equal(parseInstant('lixo'), null);
  assert.equal(parseInstant('2026-11-12'), null, 'data sem hora não vira meia-noite');
  assert.equal(ymd(new Date('2026-11-17T01:00:00Z')), '20261116'); // ainda dia 16 em Brasília
  assert.equal(addDaysYmd('20261231', 1), '20270101');
});

test('estado derivado: precedência e datas', () => {
  const now = new Date('2026-11-17T15:00:00Z');
  const base = { situacao_id: 1, situacao_nome: 'Divulgada no PNCP', modalidade_id: 6 };
  assert.equal(deriveState({ ...base, abertura_utc: '2026-11-20T12:00:00Z', encerramento_utc: '2026-11-25T12:00:00Z' }, now), 'Abertura futura');
  assert.equal(deriveState({ ...base, abertura_utc: '2026-11-10T12:00:00Z', encerramento_utc: '2026-11-25T12:00:00Z' }, now), 'Recebendo propostas');
  assert.equal(deriveState({ ...base, abertura_utc: '2026-11-10T12:00:00Z', encerramento_utc: '2026-11-12T12:00:00Z' }, now), 'Prazo encerrado');
  assert.equal(deriveState({ ...base, abertura_utc: null, encerramento_utc: null }, now), 'Sem prazo confirmado');
  assert.equal(deriveState({ ...base, abertura_utc: '2026-11-10T12:00:00Z', encerramento_utc: null }, now), 'Sem prazo confirmado');
  for (const [id, st] of [[4, 'Suspensa'], [2, 'Revogada'], [3, 'Anulada']] as const) {
    assert.equal(deriveState({ ...base, situacao_id: id, situacao_nome: 'x', abertura_utc: '2026-11-10T12:00:00Z', encerramento_utc: '2026-11-25T12:00:00Z' }, now), st);
  }
  assert.equal(deriveState({ situacao_id: 1, situacao_nome: 'Divulgada', modalidade_id: 9, abertura_utc: null, encerramento_utc: null }, now), 'Sem prazo confirmado');
  // código desconhecido é preservado e não quebra
  assert.equal(deriveState({ ...base, situacao_id: 99, situacao_nome: 'Nova situação', abertura_utc: '2026-11-10T12:00:00Z', encerramento_utc: '2026-11-25T12:00:00Z' }, now), 'Recebendo propostas');
});

test('CSV: UTF-8 com BOM e proteção contra fórmulas', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"');
  assert.equal(csvCell('+55'), "'+55");
  assert.equal(csvCell('@cmd'), "'@cmd");
  assert.equal(csvCell('a;b'), '"a;b"');
  assert.equal(csvCell(null), '');
  const csv = toCsv(['a', 'b'], [['ç', '=1+1']]);
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes("'=1+1"));
});

test('FTS: entrada do usuário nunca gera sintaxe inválida e ignora acentos', () => {
  const db = openDb(':memory:');
  db.run("INSERT INTO search_fts (control_id, orgao, municipio, objeto, itens, documentos) VALUES ('a','Câmara Municipal','São João','Software de gestão legislativa','','')");
  const hits = (q: string) => { const f = toFtsQuery(q); return f ? db.all("SELECT control_id FROM search_fts WHERE search_fts MATCH ?", f).length : -1; };
  assert.equal(hits('camara'), 1);
  assert.equal(hits('Gestão legis'), 1); // prefixo
  assert.equal(hits('sao joao'), 1);
  for (const evil of ['"', '*', 'AND OR NOT', 'a" OR "b', '(', 'NEAR(', '-x', 'objeto:foo', '\\']) {
    assert.doesNotThrow(() => hits(evil), `entrada: ${evil}`);
  }
  assert.equal(toFtsQuery('!!!'), null);
  db.close();
});

test('banco: migração idempotente, FTS5 e chaves estrangeiras', () => {
  const db = openDb(':memory:');
  assert.equal(db.migrate(), 0);
  const c = db.selfCheck();
  assert.equal(c.fts5, true);
  assert.equal(c.integrity, 'ok');
  assert.equal(c.foreignKeys, true);
  assert.throws(() => db.run("INSERT INTO items (procurement_id, numero_item, fetched_at) VALUES (999, 1, 'x')"));
  db.close();
});

test('PNCP: CNPJ alfanumérico e zeros à esquerda preservados', () => {
  assert.equal(normalizeCnpj('00.012.345/0001-95'), '00012345000195');
  assert.equal(normalizeCnpj('12.ABC.345/01DE-35'), '12ABC34501DE35');
  assert.equal(normalizeCnpj('12abc34501de35'), '12ABC34501DE35');
  assert.equal(normalizeCnpj('123'), null);
  assert.equal(normalizeCnpj(null), null);
  const n = normalizeProcurement(rec({ cnpj: '00012345000195', sequencialCompra: 7 }), 'x');
  assert.equal(n.cnpj, '00012345000195');
  assert.equal(n.controlId, '00012345000195-1-000007/2026');
  assert.equal(buildControlId({ cnpj: 'AB', ano: 2026, sequencial: 3 }), 'AB-1-000003/2026');
  const alfa = normalizeProcurement(rec({ cnpj: '12ABC34501DE35' }), 'x');
  assert.equal(alfa.linkPncp, 'https://pncp.gov.br/app/editais/12ABC34501DE35/2026/1');
});

test('PNCP: normalização do detalhe real (fixture) preserva identidade, prazo e escopo de valor', () => {
  const n = normalizeProcurement(fixture('detalhe_boa_esperanca.json'), 'detalhe');
  assert.equal(n.controlId, '01512008000108-1-000002/2026');
  assert.equal(n.sequencial, 2);
  assert.equal(n.numeroCompra, 'PRD 1'); // não confunde com sequencial
  assert.equal(n.uf, 'PR');
  assert.equal(n.codigoIbge, '4103024');
  assert.equal(n.encerramentoUtc, '2026-11-12T12:00:00.000Z');
  assert.equal(n.prazoOrigem, 'pncp-brasilia');
  assert.equal(n.valorEstimadoCents, 2190000);
  assert.equal(n.valorHomologadoCents, null);
  assert.equal(n.orcamentoSigiloso, false);
  assert.equal(n.linkOrigem, null);
  assert.equal(n.linkPncp, 'https://pncp.gov.br/app/editais/01512008000108/2026/2');
  const items = fixture('itens_boa_esperanca.json').map(normalizeItem);
  assert.ok(items.length >= 1);
  assert.equal(items[0].valorTotalCents, 420000);
  const docs = fixture('arquivos_boa_esperanca.json').map(normalizeDocument);
  assert.equal(docs[0].sequencial, 1);
  assert.ok(docs[0].url?.startsWith('https://'));
});

test('PNCP: sigilo, valor zero e links inválidos', () => {
  const s = normalizeProcurement(rec({ raw: { orcamentoSigilosoCodigo: 2, orcamentoSigilosoDescricao: 'Compra com sigilo', valorTotalEstimado: 0 } }), 'x');
  assert.equal(s.orcamentoSigiloso, true);
  assert.equal(s.valorEstimadoCents, null);
  const z = normalizeProcurement(rec({ valor: 0 }), 'x');
  assert.equal(z.valorEstimadoCents, 0, 'zero publicado sem sigilo é preservado');
  assert.equal(toCents(null), null);
  assert.equal(toCents(4500.96), 450096);
  assert.equal(safeHttpsUrl('http://x.com'), null);
  assert.equal(safeHttpsUrl('javascript:alert(1)'), null);
  assert.equal(safeHttpsUrl('https://user:pw@x.com'), null);
  assert.equal(normalizeProcurement(rec({ link: 'http://inseguro.com' }), 'x').linkOrigem, null);
  assert.equal(normalizeProcurement(rec({ link: 'https://portal.gov.br/x' }), 'x').linkOrigem, 'https://portal.gov.br/x');
  const semData = normalizeProcurement(rec({ encerramento: null, abertura: null }), 'x');
  assert.equal(semData.encerramentoUtc, null);
});

test('arquivos: assinatura de tipo e avaliação de texto extraído', () => {
  assert.equal(sniffFileType(Buffer.from('%PDF-1.7 ...')), 'pdf');
  assert.equal(sniffFileType(Buffer.from('PK\x03\x04')), 'zip');
  assert.equal(sniffFileType(Buffer.from('<!DOCTYPE html><script>')), 'html');
  assert.equal(sniffFileType(Buffer.from('MZ....')), 'outro');
  assert.equal(assessText([], false), 'imagem');
  assert.equal(assessText([{ text: '' }, { text: ' ' }], false), 'imagem');
  assert.equal(assessText([{ text: 'x'.repeat(100) }, { text: 'y'.repeat(100) }], false), 'ok');
  assert.equal(assessText([{ text: 'x'.repeat(100) }], true), 'parcial');
});

test('configurações: valores são limitados e CNPJs validados', () => {
  const s = sanitizeSettings({ tamanhoPagina: 51, concorrencia: 99, ufColeta: ['es', 'xx1', 'MG'], cnpjsLegislativos: ['01.512.008/0001-08', 'abc'] } as any);
  assert.equal(s.tamanhoPagina, 50);
  assert.equal(s.concorrencia, 4);
  assert.deepEqual(s.ufColeta, ['ES', 'MG']);
  assert.deepEqual(s.cnpjsLegislativos, ['01512008000108']);
});
