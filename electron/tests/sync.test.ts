import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeStore, makeEngine, fakeFetch, rec, page, type Handler } from './helpers.ts';
import { listOpportunities, exportCsv, getOpportunity } from '../query.ts';

interface World {
  publicacao: any[];
  atualizacao: any[];
  proposta: any[];
  detail: Record<string, any | number>;
  items: any[];
  docs: any[];
  fail: Record<string, (n: number) => number | null>;
}

function setup(over: Partial<World> = {}, settingsPatch: any = {}) {
  const env = makeStore();
  env.settings.set({ modalidades: [8], diasIniciais: 1, sobreposicaoDias: 1, horizonteDias: 30, ...settingsPatch });
  const world: World = { publicacao: [], atualizacao: [], proposta: [], detail: {}, items: [], docs: [], fail: {}, ...over };
  const calls: string[] = [];
  const list = (key: keyof Pick<World, 'publicacao' | 'atualizacao' | 'proposta'>): Handler => (url, n) => {
    const f = world.fail[key]?.(n);
    if (f) return { status: f };
    const size = Number(url.searchParams.get('tamanhoPagina') ?? 50);
    const p = Number(url.searchParams.get('pagina') ?? 1);
    const all = world[key];
    if (!all.length) return { status: 204 };
    const slice = all.slice((p - 1) * size, p * size);
    return { status: 200, body: page(slice, p, Math.max(1, Math.ceil(all.length / size)), all.length) };
  };
  const fetchImpl = fakeFetch({
    '/contratacoes/publicacao': list('publicacao'),
    '/contratacoes/atualizacao': list('atualizacao'),
    '/contratacoes/proposta': list('proposta'),
    '/itens': () => ({ status: 200, body: world.items }),
    '/arquivos': () => ({ status: 200, body: world.docs }),
    '/compras/': (url) => {
      const seq = url.pathname.split('/').pop()!;
      const d = world.detail[seq];
      if (typeof d === 'number') return { status: d };
      return d ? { status: 200, body: d } : { status: 404 };
    },
  }, calls);
  const eng = makeEngine(env, fetchImpl, { retries: 1 });
  return { ...env, ...eng, world, calls };
}

const count = (db: any, sql: string, ...p: any[]) => Number(db.get(sql, ...p).c);

test('1ª importação é silenciosa (resumo único) e repetir a coleta não multiplica registros, eventos ou avisos', async () => {
  const t = setup({ publicacao: [rec({ sequencialCompra: 1 }), rec({ sequencialCompra: 2, objeto: 'Aquisição de canetas' })] });
  const st = await t.engine.runCycle('manual');
  assert.equal(count(t.db, 'SELECT COUNT(*) c FROM procurements'), 1, 'canetas (fora do nicho) é analisada e descartada');
  assert.equal(st.discarded, 1);
  assert.equal(count(t.db, "SELECT COUNT(*) c FROM events WHERE silent=0"), 0, 'sem eventos individuais retroativos');
  assert.equal(count(t.db, "SELECT COUNT(*) c FROM events WHERE type='nova_publicacao' AND silent=1"), 1);
  assert.equal(count(t.db, "SELECT COUNT(*) c FROM notifications WHERE kind='resumo'"), 1);
  assert.equal(count(t.db, "SELECT COUNT(*) c FROM notifications WHERE kind='nova_publicacao'"), 0);
  const snap = JSON.stringify([count(t.db, 'SELECT COUNT(*) c FROM procurements'), count(t.db, 'SELECT COUNT(*) c FROM events'), count(t.db, 'SELECT COUNT(*) c FROM notifications'), count(t.db, 'SELECT COUNT(*) c FROM snapshots')]);
  await t.engine.runCycle('manual');
  await t.engine.runCycle('manual');
  assert.equal(JSON.stringify([count(t.db, 'SELECT COUNT(*) c FROM procurements'), count(t.db, 'SELECT COUNT(*) c FROM events'), count(t.db, 'SELECT COUNT(*) c FROM notifications'), count(t.db, 'SELECT COUNT(*) c FROM snapshots')]), snap);
  assert.ok(t.settings.getRaw('covered_through'));
});

test('depois da importação inicial, nova publicação aderente gera um único aviso', async () => {
  const t = setup({ publicacao: [rec({ sequencialCompra: 1 })] });
  await t.engine.runCycle('manual');
  t.world.publicacao.push(rec({ sequencialCompra: 9, atualizacao: '2026-11-17T10:00:00' }));
  await t.engine.runCycle('manual');
  await t.engine.runCycle('manual');
  assert.equal(count(t.db, "SELECT COUNT(*) c FROM notifications WHERE kind='nova_publicacao'"), 1);
});

test('edital publicado em dia anterior é recuperado pelo feed de atualização', async () => {
  const velho = rec({ sequencialCompra: 5, atualizacao: '2026-11-17T09:00:00', raw: { dataPublicacaoPncp: '2026-10-01T10:00:00' } });
  const t = setup({ atualizacao: [velho] });
  await t.engine.runCycle('manual');
  const r = t.db.get<any>("SELECT data_publicacao FROM procurements WHERE control_id=?", velho.numeroControlePNCP);
  assert.ok(r, 'registro recuperado pela atualização');
  assert.equal(r.data_publicacao.slice(0, 10), '2026-10-01');
});

test('retificação de prazo gera evento único e reprograma lembretes; suspensão interrompe; reabertura recalcula', async () => {
  const base = { sequencialCompra: 1, encerramento: '2026-11-21T09:00:00', atualizacao: '2026-11-16T11:00:00' };
  const t = setup({ publicacao: [rec(base)] });
  await t.engine.runCycle('manual');
  const id = t.db.get<any>('SELECT id FROM procurements').id;
  t.store.setWatch(id, { status: 'analise' });
  const rem = () => t.db.all<any>("SELECT dedupe_key, status, fire_at FROM notifications WHERE kind='lembrete' ORDER BY fire_at");
  assert.equal(rem().filter((r) => r.status === 'agendada').length, 3, '72h, 24h e 3h');
  assert.match(rem()[0].dedupe_key, /:72$/);

  // prorrogação
  t.world.publicacao = [rec({ ...base, encerramento: '2026-11-26T09:00:00', atualizacao: '2026-11-17T08:00:00' })];
  t.world.atualizacao = t.world.publicacao;
  await t.engine.runCycle('manual');
  await t.engine.runCycle('manual'); // repetir não duplica
  assert.equal(count(t.db, "SELECT COUNT(*) c FROM events WHERE type='prorrogacao'"), 1);
  const ev = t.db.get<any>("SELECT payload FROM events WHERE type='prorrogacao'");
  assert.equal(JSON.parse(ev.payload).after.encerramento, '2026-11-26T12:00:00.000Z');
  assert.equal(rem().filter((r) => r.status === 'agendada').length, 3);
  assert.equal(rem().filter((r) => r.status === 'cancelada').length, 3, 'lembretes do prazo substituído cancelados');
  assert.equal(count(t.db, "SELECT COUNT(*) c FROM notifications WHERE kind='prorrogacao'"), 1);

  // suspensão
  t.world.publicacao = t.world.atualizacao = [rec({ ...base, encerramento: '2026-11-26T09:00:00', situacaoCompraId: 4, atualizacao: '2026-11-17T09:00:00' })];
  await t.engine.runCycle('manual');
  assert.equal(count(t.db, "SELECT COUNT(*) c FROM events WHERE type='suspensao'"), 1);
  assert.equal(t.db.get<any>('SELECT derived_state s FROM procurements').s, 'Suspensa');
  assert.equal(rem().filter((r) => r.status === 'agendada').length, 0, 'lembretes interrompidos');

  // reabertura
  t.world.publicacao = t.world.atualizacao = [rec({ ...base, encerramento: '2026-11-26T09:00:00', situacaoCompraId: 1, atualizacao: '2026-11-17T10:00:00' })];
  await t.engine.runCycle('manual');
  assert.equal(count(t.db, "SELECT COUNT(*) c FROM events WHERE type='reabertura'"), 1);
  assert.equal(t.db.get<any>('SELECT derived_state s FROM procurements').s, 'Recebendo propostas');
  assert.equal(rem().filter((r) => r.status === 'agendada').length, 3, 'lembretes recalculados');
});

test('histórico antes/depois fica visível no detalhe', async () => {
  const base = { sequencialCompra: 1, encerramento: '2026-11-20T09:00:00' };
  const t = setup({ publicacao: [rec(base)] });
  await t.engine.runCycle('manual');
  t.world.publicacao = [rec({ ...base, encerramento: '2026-11-22T09:00:00', atualizacao: '2026-11-17T08:00:00' })];
  await t.engine.runCycle('manual');
  const id = t.db.get<any>('SELECT id FROM procurements').id;
  const d = getOpportunity(t.store, id)!;
  assert.ok(d.events.some((e: any) => e.type === 'prorrogacao' && e.payload.before.encerramento && e.payload.after.encerramento));
  assert.ok(d.snapshots.length >= 2);
});

test('lembretes: sem avisos atrasados, disparo no horário e cancelamento após o prazo', async () => {
  const t = setup({ publicacao: [rec({ sequencialCompra: 1, encerramento: '2026-11-17T20:00:00' })] }); // 8h depois do "agora"
  await t.engine.runCycle('manual');
  const id = t.db.get<any>('SELECT id FROM procurements').id;
  t.store.setWatch(id, {});
  const rows = t.db.all<any>("SELECT dedupe_key FROM notifications WHERE kind='lembrete' AND status='agendada'");
  assert.equal(rows.length, 1, 'só o de 3h (72h e 24h já passaram)');
  for (const n of t.store.dueNotifications()) t.store.markFired(n.id); // resumo da importação inicial
  assert.deepEqual(t.store.dueNotifications(), []);
  t.clock.advance(5.5 * 3600_000); // 17:30 de Brasília = 3h antes
  const due = t.store.dueNotifications();
  assert.equal(due.length, 1);
  t.store.markFired(due[0].id);
  assert.equal(t.store.dueNotifications().length, 0);
  // prazo vencido: lembretes pendentes são cancelados, não disparados
  t.store.setWatch(id, null);
  t.store.setWatch(id, {});
  t.clock.advance(10 * 3600_000);
  assert.equal(t.store.dueNotifications().length, 0);
  t.store.refreshStates();
  assert.equal(t.db.get<any>('SELECT derived_state s FROM procurements').s, 'Prazo encerrado');
});

test('falha persistente na página 2 preserva checkpoint; a retomada não reinicia a janela', async () => {
  const many = Array.from({ length: 70 }, (_, i) => rec({ sequencialCompra: i + 1 }));
  let heal = false;
  const t = setup({ publicacao: many, fail: { publicacao: (n) => (!heal && n >= 2 ? 503 : null) } });
  await t.engine.runCycle('manual');
  const job = t.db.get<any>("SELECT * FROM sync_jobs WHERE kind='discover'");
  assert.equal(job.status, 'erro');
  assert.equal(JSON.parse(job.checkpoint).page, 2);
  assert.equal(count(t.db, 'SELECT COUNT(*) c FROM procurements'), 50, 'página 1 persistida');
  assert.equal(t.settings.getRaw('covered_through'), undefined, 'janela incompleta não conta como cobertura');
  assert.ok(t.db.get<any>("SELECT COUNT(*) c FROM sync_log WHERE level='warn'").c > 0);
  t.calls.length = 0;
  heal = true;
  t.clock.advance(5 * 3600_000); // passa o backoff
  await t.engine.runCycle('manual');
  const job2 = t.db.get<any>("SELECT * FROM sync_jobs WHERE kind='discover'");
  assert.equal(job2.status, 'concluido');
  assert.equal(count(t.db, 'SELECT COUNT(*) c FROM procurements'), 70);
  const pubCalls = t.calls.filter((c) => c.includes('/contratacoes/publicacao'));
  assert.ok(pubCalls.every((c) => !c.includes('pagina=1&')), `não releu a página 1: ${pubCalls.join(' ')}`);
  assert.ok(t.settings.getRaw('covered_through'));
});

test('erro 400 vira diagnóstico permanente sem repetição; reprocessar reenfileira', async () => {
  const t = setup({ fail: { publicacao: () => 400 } });
  await t.engine.runCycle('manual');
  const job = t.db.get<any>("SELECT * FROM sync_jobs WHERE kind='discover'");
  assert.equal(job.status, 'erro_permanente');
  assert.equal(job.attempts, 1);
  const before = t.calls.length;
  await t.engine.runCycle('manual');
  assert.equal(t.db.get<any>("SELECT attempts a FROM sync_jobs WHERE kind='discover'").a, 1, 'sem repetição em loop');
  assert.ok(t.calls.length >= before);
  assert.ok(t.engine.resetFailedJobs() >= 1);
});

test('schema inválido gera diagnóstico da execução', async () => {
  const t = setup();
  const bad = fakeFetch({ '/contratacoes/': () => ({ status: 200, body: { qualquer: 'coisa' } }), '/compras/': () => ({ status: 404 }) });
  const e2 = makeEngine(t, bad, { retries: 0 });
  await e2.engine.runCycle('manual');
  const log = t.db.get<any>("SELECT * FROM sync_log WHERE level='error' AND message LIKE '%permanente%'");
  assert.ok(log);
  assert.match(log.detail, /Envelope inesperado/);
});

test('HTTP 404 e falha de reconsulta não fecham a oportunidade; ausência na reconciliação só agenda reconsulta', async () => {
  const base = rec({ sequencialCompra: 1, encerramento: '2026-11-20T09:00:00' });
  const t = setup({ publicacao: [base] });
  await t.engine.runCycle('manual');
  const id = t.db.get<any>('SELECT id FROM procurements').id;
  // proposta (reconciliação) não contém o registro e o detalhe dá 404
  t.world.proposta = [rec({ sequencialCompra: 77 })];
  t.world.publicacao = [];
  t.clock.advance(3600_000);
  await t.engine.runCycle('manual');
  const row = t.db.get<any>('SELECT * FROM procurements WHERE id=?', id);
  assert.equal(row.derived_state, 'Recebendo propostas', 'ausência/404 não fecha');
  assert.equal(row.missing_count, 1);
  assert.ok(row.not_found_at, '404 registrado separadamente');
  assert.equal(row.situacao_id, 1);
  // falha 5xx no detalhe: estado segue igual
  t.db.run('UPDATE procurements SET not_found_at=NULL WHERE id=?', id);
  t.world.detail['1'] = 503;
  t.db.run("UPDATE sync_jobs SET status='pendente', next_run_at=NULL WHERE kind='refetch'");
  await t.engine.runCycle('manual');
  assert.equal(t.db.get<any>('SELECT derived_state s FROM procurements WHERE id=?', id).s, 'Recebendo propostas');
});

test('reconsulta de detalhe atualiza prazo de acompanhada', async () => {
  const base = rec({ sequencialCompra: 1, encerramento: '2026-11-20T09:00:00' });
  const t = setup({ publicacao: [base], detail: { '1': base } });
  await t.engine.runCycle('manual');
  const id = t.db.get<any>('SELECT id FROM procurements').id;
  t.store.setWatch(id, {});
  t.world.publicacao = [];
  t.world.detail['1'] = rec({ sequencialCompra: 1, encerramento: '2026-11-23T09:00:00', atualizacao: '2026-11-17T11:00:00' });
  t.clock.advance(3 * 3600_000);
  await t.engine.runCycle('manual');
  assert.equal(t.db.get<any>('SELECT encerramento_utc e FROM procurements').e, '2026-11-23T12:00:00.000Z');
  assert.equal(count(t.db, "SELECT COUNT(*) c FROM events WHERE type='prorrogacao'"), 1);
});

test('resposta de listagem antiga não sobrescreve dado mais novo', async () => {
  const t = setup();
  const novo = rec({ sequencialCompra: 1, encerramento: '2026-11-25T09:00:00', atualizacao: '2026-11-17T10:00:00' });
  const velho = rec({ sequencialCompra: 1, encerramento: '2026-11-20T09:00:00', atualizacao: '2026-11-16T10:00:00' });
  const { normalizeProcurement } = await import('../pncp.ts');
  t.store.upsertProcurement(normalizeProcurement(novo, 'detalhe'), { silent: false, level: 1, route: 'detalhe' });
  const r = t.store.upsertProcurement(normalizeProcurement(velho, 'lista'), { silent: false, level: 0, route: 'lista' });
  assert.equal(r.stale, true);
  assert.equal(t.db.get<any>('SELECT encerramento_utc e FROM procurements').e, '2026-11-25T12:00:00.000Z');
  assert.equal(count(t.db, "SELECT COUNT(*) c FROM events WHERE type IN ('retificacao','prorrogacao')"), 0);
});

test('enriquecimento: licença genérica em Câmara passa por itens e entra na triagem com evidência do item', async () => {
  const gen = rec({ sequencialCompra: 3, objeto: 'Pregão eletrônico para locação de licenças de programas', encerramento: '2026-11-25T09:00:00' });
  const t = setup({
    publicacao: [gen],
    items: [
      { numeroItem: 1, descricao: 'Licença de uso de sistema de contabilidade', valorTotal: 10000, quantidade: 12, orcamentoSigiloso: false },
      { numeroItem: 2, descricao: 'Sistema de gestão do processo legislativo, licença mensal', valorTotal: 54000.5, quantidade: 12, orcamentoSigiloso: false },
    ],
    docs: [{ sequencialDocumento: 1, titulo: 'Edital.pdf', tipoDocumentoId: 1, tipoDocumentoNome: 'Edital', url: 'https://pncp.gov.br/x', statusAtivo: true }],
  });
  await t.engine.runCycle('manual');
  const row = t.db.get<any>('SELECT * FROM procurements');
  assert.ok(['alta', 'revisar'].includes(row.relevance), row.relevance);
  const d = getOpportunity(t.store, row.id)!;
  assert.equal(d.items.length, 2);
  assert.equal(d.items[1].valor_total_cents, 5400050);
  assert.ok(d.classification.evidences.some((e: any) => e.field === 'item' && e.item === 2 && /processo legislativo/i.test(e.snippet)));
  assert.equal(d.documents.length, 1);
});

test('janela grande demais é dividida por UF somente quando necessária', async () => {
  const many = Array.from({ length: 120 }, (_, i) => rec({ sequencialCompra: i + 1 }));
  const t = setup({ publicacao: many }, { maxPaginasJanela: 10, tamanhoPagina: 10 });
  await t.engine.runCycle('manual');
  const parent = t.db.get<any>("SELECT status FROM sync_jobs WHERE partition_key LIKE 'discover:%:BR'");
  assert.equal(parent.status, 'dividido');
  assert.ok(count(t.db, "SELECT COUNT(*) c FROM sync_jobs WHERE partition_key LIKE 'discover:%:ES'") >= 1);
});

test('paginação instável: pontas são reprocessadas', async () => {
  const many = Array.from({ length: 120 }, (_, i) => rec({ sequencialCompra: i + 1 }));
  const t = setup({ publicacao: many });
  let n = 0;
  const orig = t.world.publicacao;
  // total muda entre páginas
  const f = fakeFetch({
    '/contratacoes/publicacao': (url) => {
      n++;
      const p = Number(url.searchParams.get('pagina'));
      const total = n === 1 ? 120 : 121;
      return { status: 200, body: page(orig.slice((p - 1) * 50, p * 50), p, 3, total) };
    },
    '/contratacoes/atualizacao': () => ({ status: 204 }), '/contratacoes/proposta': () => ({ status: 204 }),
  }, t.calls);
  const e2 = makeEngine(t, f);
  await e2.engine.runCycle('manual');
  assert.equal(count(t.db, 'SELECT COUNT(*) c FROM procurements'), 120);
  assert.ok(t.calls.filter((c) => c.includes('pagina=1&')).length >= 2, 'ponta inicial reprocessada');
});

test('decisão manual e acompanhamento sobrevivem a reprocessar relevância; consultas e CSV', async () => {
  const t = setup({ publicacao: [rec({ sequencialCompra: 1 }), rec({ sequencialCompra: 2, objeto: '=cmd|calc Aquisição de canetas', uf: 'ES' })] }, { guardarForaDoPerfil: true });
  await t.engine.runCycle('manual');
  const rows = listOpportunities(t.store, { uf: ['ES'] });
  assert.equal(rows.total, 1);
  assert.equal(listOpportunities(t.store, { text: 'legislativo' }).total, 1);
  assert.equal(listOpportunities(t.store, { text: '"; DROP' }).total, 0);
  assert.equal(listOpportunities(t.store, { relevancia: ['alta'] }).total, 1);
  assert.equal(listOpportunities(t.store, { estado: ['Recebendo propostas'], prazoDias: 7 }).total, 2);
  const es = rows.rows[0] as any;
  t.store.setManualLabel(es.id, 'revisar');
  t.store.setWatch(es.id, { favorito: true, notes: 'ligar na segunda' });
  t.store.reclassifyAll();
  assert.equal(listOpportunities(t.store, { relevancia: ['revisar'] }).total, 1);
  assert.equal(listOpportunities(t.store, { watch: 'favoritas' }).total, 1);
  assert.equal(getOpportunity(t.store, es.id)!.watch.notes, 'ligar na segunda');
  const csv = exportCsv(t.store, {});
  assert.ok(csv.startsWith('﻿'));
  assert.ok(csv.includes("'=cmd|calc"), 'fórmula neutralizada');
});

test('o app opera offline: consulta e busca funcionam sem rede depois da primeira sincronização', async () => {
  const t = setup({ publicacao: [rec({ sequencialCompra: 1 })] });
  await t.engine.runCycle('manual');
  const offline = fakeFetch({}); // tudo falha (500 sem mock)
  const e2 = makeEngine(t, offline, { retries: 0 });
  await e2.engine.runCycle('manual').catch(() => {});
  assert.equal(listOpportunities(t.store, { text: 'software' }).total, 1);
  assert.equal(t.db.get<any>('SELECT derived_state s FROM procurements').s, 'Recebendo propostas');
});

test('recuperação após queda: jobs em execução voltam para a fila', async () => {
  const t = setup({ publicacao: [rec({ sequencialCompra: 1 })] });
  t.engine.planWindows();
  t.db.run("UPDATE sync_jobs SET status='executando'");
  assert.ok(t.engine.recoverStale() > 0);
  await t.engine.runCycle('manual');
  assert.equal(count(t.db, 'SELECT COUNT(*) c FROM procurements'), 1);
});
