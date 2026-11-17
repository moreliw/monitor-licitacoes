import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpClient } from '../http.ts';
import { PncpConnector } from '../pncp.ts';
import { addDaysYmd, ymd } from '../time.ts';

/**
 * Smoke test contra o PNCP real. Desligado por padrão (rede): LIVE=1 npm test
 * Valida estrutura e vinculação, sem exigir contagens permanentes.
 */
const live = process.env['LIVE'] === '1';
const REF = { cnpj: '01512008000108', ano: 2026, sequencial: 2 };

test('PNCP real: detalhe, itens e arquivos da compra 01512008000108-1-000002/2026', { skip: !live }, async () => {
  const c = new PncpConnector(new HttpClient({ maxConcurrent: 1 }));
  const d = await c.fetchDetail(REF);
  assert.equal(d.controlId, '01512008000108-1-000002/2026');
  assert.equal(d.cnpj, '01512008000108');
  assert.ok(d.objeto && d.objeto.length > 10);
  assert.ok(d.linkPncp?.endsWith('/01512008000108/2026/2'));
  const items = await c.fetchItems(REF);
  assert.ok(items.length >= 1);
  assert.ok(items.every((i) => Number.isInteger(i.numeroItem)));
  const docs = await c.fetchDocuments(REF);
  assert.ok(docs.length >= 1);
  assert.ok(docs.every((x) => x.sequencial >= 1));
  const mods = await c.fetchModalidades();
  assert.ok(mods.some((m) => m.id === 6));
});

test('PNCP real: listagens de publicação, atualização e propostas respeitam 10–50 por página', { skip: !live }, async () => {
  const c = new PncpConnector(new HttpClient({ maxConcurrent: 1 }));
  const day = addDaysYmd(ymd(new Date()), -1);
  for (const route of ['publicacao', 'atualizacao'] as const) {
    const p = await c.listWindow({ route, dataInicial: day, dataFinal: day, modalidade: 8, pagina: 1, tamanhoPagina: 10 });
    assert.ok(p.records.length <= 10);
    assert.ok(p.totalPaginas >= 0);
    for (const r of p.records) assert.match(r.controlId, /^[0-9A-Z]{14}-\d-\d{6}\/\d{4}$/);
  }
  const prop = await c.listWindow({ route: 'proposta', dataFinal: addDaysYmd(ymd(new Date()), 30), pagina: 1, tamanhoPagina: 10 });
  assert.ok(prop.records.length <= 10);
});
