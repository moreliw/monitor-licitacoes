import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpClient, HttpError, NotFoundError, CancelledError, parseRetryAfter, SchemaError } from '../http.ts';
import { fakeFetch, page, rec } from './helpers.ts';
import { PncpConnector } from '../pncp.ts';

const mk = (handlers: any, extra: any = {}) => {
  const sleeps: number[] = [];
  let t = 1_000_000; // relógio falso: dormir avança o tempo (a penalidade por 429 expira junto com a espera)
  const http = new HttpClient({ fetchImpl: fakeFetch(handlers), now: () => t, sleep: async (ms) => { sleeps.push(ms); t += ms; }, random: () => 0, baseBackoffMs: 100, maxRetries: 3, ...extra });
  return { http, sleeps };
};

test('429 respeita Retry-After e depois tem sucesso', async () => {
  const { http, sleeps } = mk({ '/x': (_u: URL, n: number) => n === 1 ? { status: 429, headers: { 'retry-after': '7' } } : { status: 200, body: { ok: 1 } } });
  const r = await http.getJson('https://pncp.gov.br/x');
  assert.deepEqual(r.body, { ok: 1 });
  assert.deepEqual(sleeps, [7000]);
});

test('5xx usa backoff exponencial com jitter e esgota as tentativas', async () => {
  const { http, sleeps } = mk({ '/x': () => ({ status: 503 }) });
  await assert.rejects(() => http.getJson('https://pncp.gov.br/x'), (e: any) => e instanceof HttpError && !e.permanent && e.status === 503);
  assert.equal(sleeps.length, 3);
  assert.ok(sleeps[1] > sleeps[0] && sleeps[2] > sleeps[1], `crescente: ${sleeps}`);
});

test('400 é erro permanente (sem repetição) e 404 é NotFoundError', async () => {
  let calls = 0;
  const { http } = mk({ '/bad': () => { calls++; return { status: 400, body: 'tamanhoPagina inválido' }; }, '/nf': () => ({ status: 404 }) });
  await assert.rejects(() => http.getJson('https://pncp.gov.br/bad'), (e: any) => e.permanent && e.status === 400);
  assert.equal(calls, 1);
  await assert.rejects(() => http.getJson('https://pncp.gov.br/nf'), NotFoundError);
});

test('204 sem corpo é tratado', async () => {
  const { http } = mk({ '/e': () => ({ status: 204 }) });
  const r = await http.getJson('https://pncp.gov.br/e');
  assert.equal(r.status, 204);
  assert.equal(r.body, null);
});

test('erro de rede é repetido e cancelamento interrompe', async () => {
  let n = 0;
  const flaky = (async () => { n++; if (n < 3) throw new Error('ECONNRESET'); return new Response('{"a":1}', { status: 200 }); }) as unknown as typeof fetch;
  const http = new HttpClient({ fetchImpl: flaky, sleep: async () => {}, maxRetries: 4 });
  assert.deepEqual((await http.getJson('https://pncp.gov.br/x')).body, { a: 1 });
  const ctl = new AbortController();
  ctl.abort();
  await assert.rejects(() => http.getJson('https://pncp.gov.br/x', ctl.signal), CancelledError);
});

test('Retry-After em data HTTP', () => {
  assert.equal(parseRetryAfter('10', 0), 10000);
  assert.equal(parseRetryAfter(new Date(5000).toUTCString(), 0), 5000);
  assert.equal(parseRetryAfter(null, 0), null);
});

test('concorrência por host limitada', async () => {
  let active = 0, peak = 0;
  const slow = (async () => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 15)); active--; return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
  const http = new HttpClient({ fetchImpl: slow, maxConcurrent: 2, sleep: async () => {} });
  await Promise.all(Array.from({ length: 8 }, () => http.getJson('https://pncp.gov.br/x')));
  assert.equal(peak, 2);
});

test('pedido do usuário não espera a coleta parada por 429 no mesmo host', async () => {
  // a coleta toma 429 com Retry-After longo: as requisições dela ficam esperando e ocupando as vagas do host
  const f = fakeFetch({
    '/api/consulta': () => ({ status: 429, headers: { 'retry-after': '600' } }),
    '/pncp-api/arquivo': () => ({ status: 200, body: '%PDF-1.7' }),
  });
  const forever = new Promise<void>(() => {});
  const http = new HttpClient({ fetchImpl: f, maxConcurrent: 2, sleep: (ms) => (ms > 1000 ? forever : Promise.resolve()) });
  for (let i = 0; i < 4; i++) void http.getJson(`https://pncp.gov.br/api/consulta?p=${i}`).catch(() => {});
  await new Promise((r) => setTimeout(r, 20));
  const timeout = new Promise<string>((r) => setTimeout(() => r('preso na fila da coleta'), 1000));
  const user = http.getRaw('https://pncp.gov.br/pncp-api/arquivo', undefined, { interactive: true }).then((res) => `HTTP ${res.status}`);
  assert.equal(await Promise.race([user, timeout]), 'HTTP 200');
  // sem a marca de pedido do usuário, o mesmo download continua atrás da coleta (comportamento da fila preservado)
  const queued = http.getRaw('https://pncp.gov.br/pncp-api/arquivo').then(() => 'passou');
  assert.equal(await Promise.race([queued, new Promise<string>((r) => setTimeout(() => r('na fila'), 200))]), 'na fila');
});

test('conector: URL de listagem usa 10–50 por página, formato YYYYMMDD e modalidade', async () => {
  const seen: string[] = [];
  const f = fakeFetch({ '/contratacoes/publicacao': () => ({ status: 200, body: page([rec()], 1, 1) }) }, seen);
  const c = new PncpConnector(new HttpClient({ fetchImpl: f, sleep: async () => {} }));
  await c.listWindow({ route: 'publicacao', dataInicial: '20261116', dataFinal: '20261116', modalidade: 6, pagina: 1, tamanhoPagina: 999 });
  const u = new URL('https://x' + seen[0]);
  assert.equal(u.pathname, '/api/consulta/v1/contratacoes/publicacao');
  assert.equal(u.searchParams.get('tamanhoPagina'), '50');
  assert.equal(u.searchParams.get('dataInicial'), '20261116');
  assert.equal(u.searchParams.get('codigoModalidadeContratacao'), '6');
  assert.equal(u.searchParams.get('uf'), null, 'coleta nacional não envia uf');
  assert.equal(u.searchParams.get('pagina'), '1');
});

test('conector: rota de propostas só envia dataFinal; 204 vira página vazia; schema inválido gera diagnóstico', async () => {
  const seen: string[] = [];
  const f = fakeFetch({ '/contratacoes/proposta': () => ({ status: 204 }), '/contratacoes/atualizacao': () => ({ status: 200, body: { foo: 1 } }) }, seen);
  const c = new PncpConnector(new HttpClient({ fetchImpl: f, sleep: async () => {} }));
  const r = await c.listWindow({ route: 'proposta', dataFinal: '20261217', pagina: 1, tamanhoPagina: 50 });
  assert.equal(r.empty, true);
  assert.equal(new URL('https://x' + seen[0]).searchParams.get('dataInicial'), null);
  await assert.rejects(() => c.listWindow({ route: 'atualizacao', dataInicial: '20261116', dataFinal: '20261116', pagina: 1, tamanhoPagina: 50 }), SchemaError);
});

test('conector: campos novos e nulos opcionais são tolerados; registro inválido é rejeitado sem derrubar a página', async () => {
  const bom = { ...rec(), campoNovoDoFuturo: { a: 1 }, informacaoComplementar: null, unidadeOrgao: { ufSigla: 'ES', municipioNome: null } };
  const ruim = { numeroControlePNCP: 'x', orgaoEntidade: { cnpj: '123' }, anoCompra: 2026, sequencialCompra: 1 };
  const f = fakeFetch({ '/contratacoes/publicacao': () => ({ status: 200, body: page([bom, ruim]) }) });
  const c = new PncpConnector(new HttpClient({ fetchImpl: f, sleep: async () => {} }));
  const r = await c.listWindow({ route: 'publicacao', dataInicial: '20261116', dataFinal: '20261116', pagina: 1, tamanhoPagina: 50 });
  assert.equal(r.records.length, 1);
  assert.equal(r.rejected.length, 1);
  assert.equal(r.records[0].uf, 'ES');
});

test('conector: anexo só de origem PNCP, tamanho limitado', async () => {
  const pdf = Buffer.from('%PDF-1.4 conteudo');
  const f = (async (u: any) => String(u).includes('evil')
    ? new Response('x', { status: 200 })
    : new Response(pdf, { status: 200, headers: { 'content-type': 'application/pdf', 'content-length': String(pdf.length) } })) as unknown as typeof fetch;
  const c = new PncpConnector(new HttpClient({ fetchImpl: f, sleep: async () => {} }));
  const ref = { cnpj: '01512008000108', ano: 2026, sequencial: 2 };
  const doc = { sequencial: 1, titulo: '../../evil:name?.pdf', tipoId: 1, tipoNome: 'Edital', url: 'https://pncp.gov.br/x', dataPublicacao: null, ativo: true };
  const ok = await c.downloadDocument(ref, doc, { maxBytes: 1000, timeoutMs: 5000 });
  assert.equal(ok.contentType, 'application/pdf');
  assert.ok(!/[\\/:?]/.test(ok.fileName), ok.fileName);
  await assert.rejects(() => c.downloadDocument(ref, doc, { maxBytes: 5, timeoutMs: 5000 }), /limite/);
});

test('limite de requisições por minuto espera a janela deslizante', async () => {
  let now = 1_000_000;
  const waits: number[] = [];
  const http = new HttpClient({
    fetchImpl: (async () => new Response('{}', { status: 200 })) as unknown as typeof fetch,
    maxPerMinute: 3, now: () => now, sleep: async (ms) => { waits.push(ms); now += ms; },
  });
  for (let i = 0; i < 4; i++) await http.getJson('https://pncp.gov.br/x');
  assert.equal(waits.length, 1, 'a 4ª requisição aguarda');
  assert.ok(waits[0] >= 50 && waits[0] <= 60_000);
});

test('após 429, todas as requisições ao host respeitam a penalidade compartilhada', async () => {
  let t = 5_000;
  const sleeps: number[] = [];
  let first = true;
  const f = (async () => { if (first) { first = false; return new Response('', { status: 429, headers: { 'retry-after': '10' } }); } return new Response('{}', { status: 200 }); }) as unknown as typeof fetch;
  const http = new HttpClient({ fetchImpl: f, now: () => t, maxConcurrent: 2, sleep: async (ms) => { sleeps.push(ms); t += ms; }, maxRetries: 2 });
  await Promise.all([http.getJson('https://pncp.gov.br/a'), http.getJson('https://pncp.gov.br/b')]);
  assert.ok(sleeps.includes(10_000));
  assert.ok(t - 5_000 >= 10_000);
});
