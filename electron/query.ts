import type { Row, SqlValue } from './db.ts';
import { toFtsQuery } from './db.ts';
import type { Store } from './store.ts';
import { toCsv } from './csv.ts';
import { LABEL_TEXT } from './classify.ts';
import { fmtBrasilia } from './time.ts';
import { ymd } from './time.ts';
import { CATEGORY_LABEL, ESFERA_LABEL } from './market.ts';
import { ADERENCIA_TEXT } from './agil.ts';

export interface OppFilter {
  text?: string;
  uf?: string[];
  modalidade?: number[];
  fonte?: string;
  relevancia?: string[];
  estado?: string[];
  prazoDias?: number | null; // encerramento nos próximos N dias
  watch?: 'todas' | 'acompanhadas' | 'favoritas' | 'triagem' | 'analise' | 'descartada';
  /** Aderência ao Ágil (nucleo, plenario, compilacao, complemento, condicionada, fora). */
  aderencia?: string[];
  /** Inclui o que está fora do perfil (por padrão só aparece se acompanhado ou com decisão manual). */
  incluirFora?: boolean;
  sort?: 'prazo' | 'publicacao' | 'relevancia' | 'orgao' | 'valor' | 'agil';
  dir?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

const SORTS: Record<string, string> = {
  prazo: "CASE WHEN p.encerramento_utc IS NULL THEN 1 ELSE 0 END, p.encerramento_utc",
  publicacao: 'p.data_publicacao',
  // abertas primeiro, depois pontuação
  relevancia: "(p.derived_state IN ('Recebendo propostas','Abertura futura')) DESC, p.relevance_score",
  orgao: 'p.orgao_nome COLLATE NOCASE',
  valor: 'p.valor_estimado_cents',
  // abertas primeiro, depois aderência ao Ágil
  agil: "(p.derived_state IN ('Recebendo propostas','Abertura futura')) DESC, COALESCE(f.score, 0)",
};

const FROM = `
  FROM procurements p
  LEFT JOIN classifications c ON c.procurement_id=p.id
  LEFT JOIN watchlist w ON w.procurement_id=p.id
  LEFT JOIN agil_fit f ON f.procurement_id=p.id`;

const SELECT = `
  SELECT p.id, p.control_id, p.source, p.orgao_nome, p.unidade_nome, p.municipio, p.uf, p.objeto, p.modalidade_id, p.modalidade_nome,
    p.situacao_nome, p.derived_state, p.relevance, p.relevance_score, p.data_publicacao, p.encerramento_utc, p.abertura_utc, p.prazo_origem,
    p.valor_estimado_cents, p.valor_homologado_cents, p.orcamento_sigiloso, p.link_pncp, p.link_origem, p.not_found_at, p.missing_count,
    (c.label_manual IS NOT NULL) AS manual, c.label_auto,
    w.status AS watch_status, COALESCE(w.favorito,0) AS favorito,
    f.aderencia AS agil_aderencia, f.score AS agil_score, f.resumo AS agil_resumo, f.bloqueios AS agil_bloqueios, f.lacunas AS agil_lacunas,
    (SELECT COUNT(*) FROM procurements q WHERE q.cnpj=p.cnpj AND q.ano=p.ano AND q.numero_compra=p.numero_compra
       AND q.modalidade_id=p.modalidade_id AND q.id<>p.id) AS republicacoes,
    (p.encerramento_utc IS NOT NULL AND p.data_publicacao IS NOT NULL AND p.data_publicacao > p.encerramento_utc) AS datas_a_conferir
  ${FROM}`;

function parseFit<T extends Row>(r: T): T {
  for (const k of ['agil_bloqueios', 'agil_lacunas']) {
    try { (r as Row)[k] = r[k] ? JSON.parse(r[k]) : []; } catch { (r as Row)[k] = []; }
  }
  return r;
}

export function buildWhere(f: OppFilter, nowIso: string): { where: string; params: SqlValue[] } {
  const w: string[] = [];
  const params: SqlValue[] = [];
  const inList = (col: string, vals: (string | number)[] | undefined) => {
    if (vals?.length) { w.push(`${col} IN (${vals.map(() => '?').join(',')})`); params.push(...vals); }
  };
  if (f.text?.trim()) {
    const q = toFtsQuery(f.text);
    if (q) { w.push('p.id IN (SELECT rowid FROM search_fts WHERE search_fts MATCH ?)'); params.push(q); }
    else { w.push('0'); } // texto só com pontuação: sem resultados, nunca uma consulta FTS inválida
  }
  inList('p.uf', f.uf);
  inList('p.modalidade_id', f.modalidade);
  inList('p.relevance', f.relevancia);
  inList('p.derived_state', f.estado);
  if (f.fonte) { w.push('p.source=?'); params.push(f.fonte); }
  if (f.prazoDias) {
    w.push('p.encerramento_utc > ? AND p.encerramento_utc <= ?');
    params.push(nowIso, new Date(Date.parse(nowIso) + f.prazoDias * 86_400_000).toISOString());
  }
  switch (f.watch) {
    case 'acompanhadas': w.push("w.procurement_id IS NOT NULL AND w.status!='descartada'"); break;
    case 'favoritas': w.push('w.favorito=1'); break;
    case 'triagem': case 'analise': case 'descartada': w.push('w.status=?'); params.push(f.watch); break;
  }
  inList('f.aderencia', f.aderencia);
  // o acervo guarda o que já foi candidato e depois saiu do perfil; por padrão isso fica fora da lista
  if (!f.incluirFora && !f.relevancia?.includes('fora')) w.push("(p.relevance!='fora' OR w.procurement_id IS NOT NULL OR c.label_manual IS NOT NULL)");
  return { where: w.length ? 'WHERE ' + w.join(' AND ') : '', params };
}

/** Com "guardar fora do perfil" ligado, o usuário quer ver também o que está fora do nicho. */
function withProfile(store: Store, f: OppFilter): OppFilter {
  return f.incluirFora === undefined && store.getSettings().guardarForaDoPerfil ? { ...f, incluirFora: true } : f;
}

export function listOpportunities(store: Store, f: OppFilter): { rows: Row[]; total: number; page: number; pageSize: number } {
  const pageSize = Math.min(200, Math.max(5, f.pageSize ?? 25));
  const page = Math.max(1, f.page ?? 1);
  const { where, params } = buildWhere(withProfile(store, f), store.now());
  const sort = SORTS[f.sort ?? 'publicacao'] ?? SORTS['publicacao'];
  const dir = f.dir === 'asc' ? 'ASC' : 'DESC';
  const total = store.db.get<{ c: number }>(`SELECT COUNT(*) AS c ${FROM} ${where}`, ...params)!.c;
  const rows = store.db.all(`${SELECT} ${where} ORDER BY ${sort} ${dir}, p.id DESC LIMIT ? OFFSET ?`, ...params, pageSize, (page - 1) * pageSize).map(parseFit);
  return { rows, total, page, pageSize };
}

export function getOpportunity(store: Store, id: number): Row | null {
  const db = store.db;
  const p0 = db.get<Row>(`${SELECT} WHERE p.id=?`, id);
  if (!p0) return null;
  const p = parseFit(p0);
  const full = db.get<Row>('SELECT * FROM procurements WHERE id=?', id)!;
  const cls = db.get<Row>('SELECT * FROM classifications WHERE procurement_id=?', id);
  const watch = db.get<Row>('SELECT * FROM watchlist WHERE procurement_id=?', id);
  const fit = db.get<Row>('SELECT * FROM agil_fit WHERE procurement_id=?', id);
  return {
    ...p,
    agil: fit ? { ...fit, temas: JSON.parse(fit.temas), bloqueios: JSON.parse(fit.bloqueios), lacunas: JSON.parse(fit.lacunas) } : null,
    republicacoes_lista: db.all(
      `SELECT id, control_id, data_publicacao, derived_state, link_pncp FROM procurements
       WHERE cnpj=? AND ano=? AND numero_compra=? AND modalidade_id=? AND id<>? ORDER BY data_publicacao DESC`,
      full.cnpj, full.ano, full.numero_compra, full.modalidade_id, id),
    detail: full,
    classification: cls ? { ...cls, evidences: JSON.parse(cls.evidences) } : null,
    items: db.all('SELECT * FROM items WHERE procurement_id=? ORDER BY numero_item', id),
    documents: db.all('SELECT id, sequencial, titulo, tipo_nome, url, data_publicacao, ativo, status, error, sha256, bytes, version, text_status, pages, fetched_at, priority FROM documents WHERE procurement_id=? ORDER BY priority DESC, sequencial', id),
    events: db.all('SELECT id, type, payload, silent, created_at FROM events WHERE procurement_id=? ORDER BY id DESC', id)
      .map((e) => ({ ...e, text: store.EVENT_TEXT[e.type] ?? e.type, payload: JSON.parse(e.payload) })),
    snapshots: db.all('SELECT captured_at, source, fields FROM snapshots WHERE procurement_id=? ORDER BY id DESC LIMIT 30', id).map((s) => ({ ...s, fields: JSON.parse(s.fields) })),
    divergences: db.all('SELECT * FROM divergences WHERE procurement_id=? ORDER BY id DESC', id),
    watch: watch ? { ...watch, checklist: JSON.parse(watch.checklist) } : null,
  };
}

export function searchDocumentExcerpts(store: Store, id: number, q: string): Row[] {
  const terms = q.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  if (!terms.length) return [];
  const rows = store.db.all<Row>(
    `SELECT dp.document_id, d.titulo, dp.page, dp.text FROM doc_pages dp JOIN documents d ON d.id=dp.document_id WHERE d.procurement_id=? LIMIT 500`, id);
  const out: Row[] = [];
  for (const r of rows) {
    const t = String(r.text);
    const n = t.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    const i = n.indexOf(terms[0]);
    if (i >= 0 && terms.every((x) => n.includes(x))) out.push({ document_id: r.document_id, titulo: r.titulo, page: r.page, snippet: t.slice(Math.max(0, i - 80), i + 200) });
    if (out.length >= 20) break;
  }
  return out;
}

const fmtMoney = (c: number | null) => (c === null || c === undefined ? '' : (c / 100).toFixed(2).replace('.', ','));

export function exportCsv(store: Store, f: OppFilter): string {
  const { where, params } = buildWhere(withProfile(store, f), store.now());
  const sort = SORTS[f.sort ?? 'publicacao'] ?? SORTS['publicacao'];
  const rows = store.db.all<Row>(`${SELECT} ${where} ORDER BY ${sort} ${f.dir === 'asc' ? 'ASC' : 'DESC'} LIMIT 50000`, ...params).map(parseFit);
  return toCsv(
    ['Número de controle PNCP', 'Órgão', 'Município', 'UF', 'Modalidade', 'Objeto', 'Relevância', 'Situação', 'Publicação', 'Encerramento de propostas', 'Valor estimado (R$)', 'Orçamento', 'Acompanhamento',
      'Aderência ao Ágil', 'Pontuação Ágil', 'A desenvolver no Ágil', 'Fora do Ágil (parceria ou enquadramento)', 'Republicações', 'Link PNCP', 'Portal de origem'],
    rows.map((r) => [
      r.control_id, r.orgao_nome, r.municipio, r.uf, r.modalidade_nome, r.objeto, LABEL_TEXT[r.relevance as keyof typeof LABEL_TEXT] ?? r.relevance,
      r.derived_state, fmtBrasilia(r.data_publicacao), fmtBrasilia(r.encerramento_utc), fmtMoney(r.valor_estimado_cents),
      r.orcamento_sigiloso === 1 ? 'Sigiloso' : r.valor_estimado_cents === null ? 'Não publicado' : 'Publicado',
      r.watch_status ?? '',
      r.agil_aderencia ? ADERENCIA_TEXT[r.agil_aderencia as keyof typeof ADERENCIA_TEXT] ?? r.agil_aderencia : '', r.agil_score ?? '',
      (r.agil_lacunas as string[]).join(' | '), (r.agil_bloqueios as string[]).join(' | '), r.republicacoes ?? 0,
      r.link_pncp, r.link_origem,
    ]),
  );
}

export function sourcesOverview(store: Store, connector: { id: string; label: string; coverage(m: number[], u: string[]): string }) {
  const db = store.db;
  const s = store.getSettings();
  const mods = new Set(s.modalidades);
  if (s.incluirInexigibilidade) mods.add(9);
  const count = (sql: string, ...p: SqlValue[]) => Number(db.get<{ c: number }>(sql, ...p)?.c ?? 0);
  const lastRun = db.get<Row>("SELECT * FROM sync_runs WHERE finished_at IS NOT NULL ORDER BY id DESC LIMIT 1");
  const lastFull = store.settings.getRaw('last_full_sync_at') as string | undefined;
  const lastContact = store.settings.getRaw('last_contact_at') as string | undefined;
  const staleMs = s.baseDesatualizadaHoras * 3_600_000;
  const stale = !lastFull || Date.now() - Date.parse(lastFull) > staleMs;
  return {
    sources: [{
      id: connector.id, label: connector.label, coverage: connector.coverage([...mods], s.ufColeta),
      lastFullSync: lastFull ?? null, lastContact: lastContact ?? null, stale,
      records: count('SELECT COUNT(*) AS c FROM procurements WHERE source=?', connector.id),
      pendingWindows: count("SELECT COUNT(*) AS c FROM sync_jobs WHERE kind IN ('discover','update','reconcile') AND status IN ('pendente','erro','executando')"),
      historicalPending: count("SELECT COUNT(*) AS c FROM sync_jobs WHERE priority>=5 AND status IN ('pendente','erro','executando')"),
      failedJobs: count("SELECT COUNT(*) AS c FROM sync_jobs WHERE status IN ('erro','erro_permanente')"),
      docsWaiting: count("SELECT COUNT(*) AS c FROM documents WHERE status='pendente' AND priority>=90"),
      docsImageOnly: count("SELECT COUNT(*) AS c FROM documents WHERE text_status IN ('imagem','parcial')"),
      modalidades: [...mods],
      horizonDays: s.horizonteDias,
    }],
    lastRun: lastRun ? { ...lastRun, stats: JSON.parse(lastRun.stats) } : null,
    today: ymd(new Date()),
  };
}

/** Números do painel de oportunidades e da navegação. */
export function opportunityStats(store: Store): Row {
  const now = store.now();
  const in7 = new Date(Date.parse(now) + 7 * 86_400_000).toISOString();
  const r = store.db.get<Row>(
    `SELECT COUNT(*) AS total,
       SUM(derived_state = 'Recebendo propostas') AS abertas,
       SUM(derived_state = 'Abertura futura') AS futuras,
       SUM(derived_state IN ('Abertura futura','Recebendo propostas') AND encerramento_utc > ? AND encerramento_utc <= ?) AS encerram7,
       SUM(relevance = 'alta') AS alta,
       SUM(relevance = 'revisar') AS revisar,
       SUM(relevance = 'pendente') AS pendente
     FROM procurements`, now, in7)!;
  const agil = store.db.get<Row>(
    `SELECT SUM(f.aderencia IN ('nucleo','plenario','compilacao')) AS alvos,
       SUM(f.aderencia IN ('nucleo','plenario','compilacao') AND p.derived_state IN ('Recebendo propostas','Abertura futura')) AS alvosAbertos,
       SUM(f.aderencia = 'condicionada' AND p.derived_state IN ('Recebendo propostas','Abertura futura')) AS condicionadasAbertas
     FROM agil_fit f JOIN procurements p ON p.id=f.procurement_id`)!;
  for (const [k, v] of Object.entries(agil)) r[k] = Number(v ?? 0);
  const watched = store.db.get<Row>("SELECT COUNT(*) AS c FROM watchlist WHERE status != 'descartada'")!.c;
  const unread = store.db.get<Row>("SELECT COUNT(*) AS c FROM notifications WHERE status = 'disparada'")!.c;
  const market = store.db.get<Row>("SELECT COUNT(*) AS c, SUM(derived_state IN ('Abertura futura','Recebendo propostas')) AS abertas FROM market_items")!;
  const out: Row = { watched, unread, marketTotal: market.c ?? 0, marketAbertas: market.abertas ?? 0 };
  for (const [k, v] of Object.entries(r)) out[k] = Number(v ?? 0);
  return out;
}

// ---------------- Mercado de software ----------------

export interface MarketFilter {
  dias?: number | null;       // publicação nos últimos N dias (null/0 = todo o acervo)
  uf?: string[];
  esfera?: string[];
  categoria?: string | null;
  abertas?: boolean;          // só recebendo propostas / abertura futura
  text?: string;
  sort?: 'valor' | 'publicacao' | 'prazo';
  page?: number;
  pageSize?: number;
}

function marketWhere(f: MarketFilter, nowIso: string): { where: string; params: SqlValue[] } {
  const w: string[] = [];
  const params: SqlValue[] = [];
  if (f.dias && f.dias > 0) { w.push('m.data_publicacao >= ?'); params.push(new Date(Date.parse(nowIso) - f.dias * 86_400_000).toISOString()); }
  if (f.uf?.length) { w.push(`m.uf IN (${f.uf.map(() => '?').join(',')})`); params.push(...f.uf); }
  if (f.esfera?.length) { w.push(`m.esfera IN (${f.esfera.map(() => '?').join(',')})`); params.push(...f.esfera); }
  if (f.categoria) { w.push('m.primary_category = ?'); params.push(f.categoria); }
  if (f.abertas) { w.push("m.derived_state IN ('Abertura futura','Recebendo propostas')"); }
  if (f.text?.trim()) {
    for (const t of f.text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((x) => x.length > 1).slice(0, 6)) {
      // coluna "busca" já está normalizada (minúsculas, sem acentos)
      w.push("m.busca LIKE ? ESCAPE '\\'");
      params.push(`%${t.replace(/[\\%_]/g, (c) => '\\' + c)}%`);
    }
  }
  return { where: w.length ? 'WHERE ' + w.join(' AND ') : '', params };
}

export function marketOverview(store: Store, f: MarketFilter) {
  const db = store.db;
  const { where, params } = marketWhere({ ...f, categoria: null }, store.now());
  const val = 'SUM(CASE WHEN m.orcamento_sigiloso = 1 THEN 0 ELSE COALESCE(m.valor_estimado_cents, 0) END)';
  const open = "SUM(m.derived_state IN ('Abertura futura','Recebendo propostas'))";
  const kpis = db.get<Row>(`SELECT COUNT(*) AS total, ${val} AS valor, ${open} AS abertas, COUNT(DISTINCT m.cnpj) AS orgaos,
      COUNT(DISTINCT m.uf || m.municipio) AS municipios, MIN(m.data_publicacao) AS desde, MAX(m.data_publicacao) AS ate FROM market_items m ${where}`, ...params)!;
  const byCategory = db.all<Row>(`SELECT m.primary_category AS id, COUNT(*) AS n, ${val} AS valor, ${open} AS abertas, COUNT(DISTINCT m.cnpj) AS orgaos
      FROM market_items m ${where} GROUP BY m.primary_category ORDER BY n DESC`, ...params)
    .map((r) => ({ ...r, label: CATEGORY_LABEL[r.id] ?? r.id }) as Row);
  const byUf = db.all<Row>(`SELECT m.uf, COUNT(*) AS n, ${val} AS valor FROM market_items m ${where} GROUP BY m.uf ORDER BY n DESC`, ...params);
  const byEsfera = db.all<Row>(`SELECT m.esfera, COUNT(*) AS n, ${val} AS valor FROM market_items m ${where} GROUP BY m.esfera ORDER BY n DESC`, ...params)
    .map((r) => ({ ...r, label: ESFERA_LABEL[r.esfera] ?? 'Não informada' }) as Row);
  const weekly = db.all<Row>(`SELECT strftime('%Y-%W', m.data_publicacao) AS semana, MIN(substr(m.data_publicacao,1,10)) AS inicio, COUNT(*) AS n
      FROM market_items m ${where ? where + ' AND' : 'WHERE'} m.data_publicacao IS NOT NULL GROUP BY semana ORDER BY semana DESC LIMIT 12`, ...params).reverse();
  const topOrgaos = db.all<Row>(`SELECT m.orgao_nome, m.uf, COUNT(*) AS n, ${val} AS valor FROM market_items m ${where}
      GROUP BY m.cnpj ORDER BY n DESC, valor DESC LIMIT 10`, ...params);
  return { kpis, byCategory, byUf, byEsfera, weekly, topOrgaos, analisadasTotal: Number(db.get<Row>('SELECT COUNT(*) AS c FROM market_items')!.c) };
}

export function marketList(store: Store, f: MarketFilter): { rows: Row[]; total: number; page: number; pageSize: number } {
  const pageSize = Math.min(200, Math.max(5, f.pageSize ?? 25));
  const page = Math.max(1, f.page ?? 1);
  const { where, params } = marketWhere(f, store.now());
  const order = f.sort === 'publicacao' ? 'm.data_publicacao DESC' : f.sort === 'prazo' ? "CASE WHEN m.encerramento_utc IS NULL THEN 1 ELSE 0 END, m.encerramento_utc ASC" : 'COALESCE(m.valor_estimado_cents,0) DESC';
  const total = Number(store.db.get<Row>(`SELECT COUNT(*) AS c FROM market_items m ${where}`, ...params)!.c);
  const rows = store.db.all<Row>(`SELECT m.* FROM market_items m ${where} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, pageSize, (page - 1) * pageSize)
    .map((r) => ({ ...r, categories: JSON.parse(r.categories), category_label: CATEGORY_LABEL[r.primary_category] ?? r.primary_category, esfera_label: ESFERA_LABEL[r.esfera] ?? '—' }));
  return { rows, total, page, pageSize };
}

export function marketCsv(store: Store, f: MarketFilter): string {
  const { where, params } = marketWhere(f, store.now());
  const rows = store.db.all<Row>(`SELECT m.* FROM market_items m ${where} ORDER BY m.data_publicacao DESC LIMIT 100000`, ...params);
  return toCsv(
    ['Número de controle PNCP', 'Categoria', 'Outras categorias', 'Órgão', 'Esfera', 'Município', 'UF', 'Modalidade', 'Objeto', 'Publicação', 'Encerramento', 'Situação', 'Valor estimado (R$)', 'Link PNCP'],
    rows.map((r) => [
      r.control_id, CATEGORY_LABEL[r.primary_category] ?? r.primary_category,
      (JSON.parse(r.categories) as string[]).filter((c) => c !== r.primary_category).map((c) => CATEGORY_LABEL[c] ?? c).join(' | '),
      r.orgao_nome, ESFERA_LABEL[r.esfera] ?? '', r.municipio, r.uf, r.modalidade_nome, r.objeto, fmtBrasilia(r.data_publicacao), fmtBrasilia(r.encerramento_utc),
      r.derived_state, r.orcamento_sigiloso === 1 ? 'Sigiloso' : fmtMoney(r.valor_estimado_cents), r.link_pncp,
    ]),
  );
}

export function listRuns(store: Store, limit = 30): Row[] {
  return store.db.all<Row>('SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?', limit).map((r) => ({ ...r, stats: JSON.parse(r.stats) }));
}
export function listLogs(store: Store, level: string | null, limit = 200): Row[] {
  return level
    ? store.db.all('SELECT * FROM sync_log WHERE level=? ORDER BY id DESC LIMIT ?', level, limit)
    : store.db.all('SELECT * FROM sync_log ORDER BY id DESC LIMIT ?', limit);
}
export function listJobs(store: Store, limit = 100): Row[] {
  return store.db.all(
    `SELECT id, kind, partition_key, status, priority, attempts, next_run_at, last_error, checkpoint, updated_at FROM sync_jobs
     WHERE status NOT IN ('concluido','dividido') ORDER BY priority, id LIMIT ?`, limit);
}
export function listAlerts(store: Store, limit = 200): Row[] {
  return store.db.all(
    `SELECT n.*, p.control_id, p.orgao_nome FROM notifications n LEFT JOIN procurements p ON p.id=n.procurement_id
     WHERE n.status IN ('agendada','disparada','lida') ORDER BY (n.status='agendada') , n.fire_at DESC LIMIT ?`, limit);
}
