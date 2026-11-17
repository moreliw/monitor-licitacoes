import * as fs from 'node:fs';
import * as path from 'node:path';
import { openDb } from '../db.ts';
import { SettingsStore } from '../settings.ts';
import { Store } from '../store.ts';
import { HttpClient } from '../http.ts';
import { PncpConnector } from '../pncp.ts';
import { SyncEngine } from '../sync.ts';

export function fixture(name: string): any {
  return JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'electron', 'tests', 'fixtures', name), 'utf8'));
}

export class Clock {
  constructor(public t: number) {}
  now = () => new Date(this.t);
  advance(ms: number) { this.t += ms; }
}

export function makeStore(nowIso = '2026-11-17T12:00:00-03:00') {
  const clock = new Clock(Date.parse(nowIso));
  const db = openDb(':memory:');
  const settings = new SettingsStore(db);
  const store = new Store(db, settings, clock.now);
  return { db, settings, store, clock };
}

/** Registro de contratação mínimo no formato do PNCP. */
export function rec(over: Record<string, any> = {}): any {
  const seq = over.sequencialCompra ?? 1;
  const cnpj = over.cnpj ?? '01512008000108';
  const ano = over.anoCompra ?? 2026;
  const base = {
    numeroControlePNCP: `${cnpj}-1-${String(seq).padStart(6, '0')}/${ano}`,
    orgaoEntidade: { cnpj, razaoSocial: over.orgao ?? 'MUNICIPIO X CAMARA MUNICIPAL', poderId: 'L', esferaId: 'M' },
    unidadeOrgao: { ufSigla: over.uf ?? 'PR', municipioNome: 'Cidade X', codigoUnidade: '1', nomeUnidade: 'Camara Municipal', codigoIbge: '4103024' },
    anoCompra: ano, sequencialCompra: seq, numeroCompra: '1', processo: '1/2026',
    modalidadeId: over.modalidadeId ?? 8, modalidadeNome: 'Dispensa',
    objetoCompra: over.objeto ?? 'Locação de software para controle do processo legislativo, com protocolo e votação on-line.',
    situacaoCompraId: over.situacaoCompraId ?? 1, situacaoCompraNome: 'Divulgada no PNCP',
    valorTotalEstimado: over.valor ?? 21900, valorTotalHomologado: null,
    orcamentoSigilosoCodigo: 1, orcamentoSigilosoDescricao: 'Compra sem sigilo',
    dataPublicacaoPncp: '2026-11-16T11:00:00',
    dataAberturaProposta: over.abertura === undefined ? '2026-11-16T08:00:00' : over.abertura,
    dataEncerramentoProposta: over.encerramento === undefined ? '2026-11-20T09:00:00' : over.encerramento,
    dataAtualizacao: over.atualizacao ?? '2026-11-16T11:00:00',
    dataAtualizacaoGlobal: over.atualizacao ?? '2026-11-16T11:00:00',
    linkSistemaOrigem: over.link ?? null,
  };
  return { ...base, ...(over.raw ?? {}) };
}

export type Handler = (url: URL, call: number) => { status: number; body?: unknown; headers?: Record<string, string> } | Promise<{ status: number; body?: unknown; headers?: Record<string, string> }>;

/** Fetch falso com roteamento por caminho. */
export function fakeFetch(handlers: Record<string, Handler>, log: string[] = []) {
  const counts: Record<string, number> = {};
  const fn = (async (input: any) => {
    const url = new URL(String(input));
    log.push(url.pathname + url.search);
    const key = Object.keys(handlers).find((k) => url.pathname.endsWith(k) || url.pathname.includes(k));
    if (!key) return new Response('not mocked', { status: 500 });
    counts[key] = (counts[key] ?? 0) + 1;
    const r = await handlers[key](url, counts[key]);
    const body = r.body === undefined ? null : typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return new Response(r.status === 204 ? null : body, { status: r.status, headers: r.headers });
  }) as typeof fetch;
  return fn;
}

export function makeEngine(env: ReturnType<typeof makeStore>, fetchImpl: typeof fetch, opts: { retries?: number } = {}) {
  const http = new HttpClient({ fetchImpl, sleep: async () => {}, random: () => 0.5, maxRetries: opts.retries ?? 2, baseBackoffMs: 1, maxPerMinute: 1_000_000 });
  const connector = new PncpConnector(http);
  const engine = new SyncEngine({ store: env.store, connector, clock: env.clock.now });
  return { http, connector, engine };
}

export function page(records: any[], p = 1, totalPages = 1, total = records.length) {
  return { data: records, totalRegistros: total, totalPaginas: totalPages, numeroPagina: p, paginasRestantes: totalPages - p, empty: records.length === 0 };
}
