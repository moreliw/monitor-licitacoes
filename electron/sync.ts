import type { Row } from './db.ts';
import type { ListQuery, ListRoute, SourceConnector } from './connector.ts';
import { CancelledError, HttpError, NotFoundError, SchemaError } from './http.ts';
import type { Store } from './store.ts';
import { MAX_DOC_ATTEMPTS, type DocPipeline } from './docs.ts';
import { dailyBackup } from './backup.ts';
import { addDaysYmd, daysBetween, eachDay, ymd } from './time.ts';

export type JobKind = 'discover' | 'update' | 'reconcile' | 'refetch' | 'enrich' | 'doc';

export interface SyncProgress {
  running: boolean;
  runId: number | null;
  trigger: string | null;
  jobsPending: number;
  jobsDone: number;
  current: string | null;
  page: number | null;
  totalPages: number | null;
  historicalPaused: boolean;
  message: string;
}

export interface RunStats {
  jobsDone: number; jobsFailed: number; pages: number; records: number; created: number; changed: number; rejected: number; docs: number; budgetExhausted: boolean;
  /** Contratações analisadas e descartadas por estarem fora do nicho. */
  discarded: number;
  /** Contratações de software (qualquer órgão) registradas no mercado. */
  software: number;
}

export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SP', 'SE', 'TO'];

export interface SyncDeps {
  store: Store;
  connector: SourceConnector;
  docs?: DocPipeline | null;
  clock?: () => Date;
  emit?: (p: SyncProgress) => void;
  /** Permite testes sem espera real. */
  sleep?: (ms: number) => Promise<void>;
}

const MAX_BACKOFF_MS = 4 * 3_600_000;

export class SyncEngine {
  private store: Store;
  private db: Store['db'];
  private connector: SourceConnector;
  private docs: DocPipeline | null;
  private clock: () => Date;
  private ctl: AbortController | null = null;
  private progress: SyncProgress;
  private runId: number | null = null;
  private stats: RunStats = this.emptyStats();
  private deadline = Infinity;
  private silent = false;
  private docsThisRun = 0;
  running = false;

  constructor(private deps: SyncDeps) {
    this.store = deps.store;
    this.db = deps.store.db;
    this.connector = deps.connector;
    this.docs = deps.docs ?? null;
    this.clock = deps.clock ?? (() => new Date());
    this.progress = { running: false, runId: null, trigger: null, jobsPending: 0, jobsDone: 0, current: null, page: null, totalPages: null, historicalPaused: !!this.store.settings.getRaw('historical_paused'), message: 'Ocioso' };
  }

  private emptyStats(): RunStats {
    return { jobsDone: 0, jobsFailed: 0, pages: 0, records: 0, created: 0, changed: 0, rejected: 0, docs: 0, budgetExhausted: false, discarded: 0, software: 0 };
  }
  private nowIso(): string { return this.clock().toISOString(); }
  private nowMs(): number { return this.clock().getTime(); }

  // ---------- log ----------
  log(level: 'info' | 'warn' | 'error', message: string, extra: { route?: string; window?: string; attempt?: number; detail?: string; source?: string } = {}): void {
    this.db.run(
      'INSERT INTO sync_log (run_id, ts, level, source, route, window, attempt, message, detail) VALUES (?,?,?,?,?,?,?,?,?)',
      this.runId, this.nowIso(), level, extra.source ?? this.connector.id, extra.route ?? null, extra.window ?? null, extra.attempt ?? null,
      message.slice(0, 500), extra.detail?.slice(0, 2000) ?? null,
    );
  }
  logHttp(i: { url: string; attempt: number; status?: number; error?: string; waitMs?: number }): void {
    const u = new URL(i.url);
    const what = i.status ? `HTTP ${i.status}` : `Falha de rede${i.error ? ': ' + i.error : ''}`;
    const retry = i.waitMs ? ` · nova tentativa em ${Math.round(i.waitMs / 1000)} s` : ' · tentativas esgotadas';
    // 429/5xx/rede são transitórios (aviso); outros 4xx são erros
    this.log(i.status === 429 || (i.status ?? 0) >= 500 || !i.status ? 'warn' : 'error', what + retry, { route: u.pathname, attempt: i.attempt });
  }

  // ---------- planejamento ----------
  private enabledModalidades(): number[] {
    const s = this.store.getSettings();
    const set = new Set(s.modalidades);
    if (s.incluirInexigibilidade) set.add(9);
    return [...set];
  }

  private upsertJob(kind: JobKind, key: string, params: object, priority: number, reset: boolean): void {
    const now = this.nowIso();
    const row = this.db.get<Row>('SELECT id, status FROM sync_jobs WHERE partition_key=?', key);
    if (!row) {
      this.db.run(
        `INSERT INTO sync_jobs (kind, source, partition_key, params, priority, status, created_at, updated_at) VALUES (?,?,?,?,?, 'pendente', ?, ?)`,
        kind, this.connector.id, key, JSON.stringify(params), priority, now, now);
    } else if (reset && (row.status === 'concluido' || row.status === 'dividido')) {
      this.db.run("UPDATE sync_jobs SET status='pendente', checkpoint='{}', attempts=0, last_error=NULL, next_run_at=NULL, priority=?, updated_at=? WHERE id=?", priority, now, row.id);
    }
  }

  /** Cria as janelas de descoberta/atualização por dia e modalidade, com sobreposição. */
  planWindows(reopen = true): { days: number } {
    const s = this.store.getSettings();
    const today = ymd(this.clock());
    const covered = this.store.settings.getRaw('covered_through') as string | undefined;
    const start = covered ? addDaysYmd(covered, -s.sobreposicaoDias) : addDaysYmd(today, -(s.diasIniciais - 1));
    const ufs = s.ufColeta.length ? s.ufColeta : [null];
    let days = 0;
    this.db.tx(() => {
      for (const day of eachDay(start, today)) {
        days++;
        const recent = daysBetween(day, today) <= Math.max(2, s.sobreposicaoDias) ? 0 : 1;
        // dias ainda dentro da sobreposição são reabertos a cada execução; os demais só se ainda não existirem
        const reopenDay = reopen && daysBetween(day, today) <= s.sobreposicaoDias;
        for (const mod of this.enabledModalidades()) {
          for (const uf of ufs) {
            for (const kind of ['discover', 'update'] as const) {
              this.upsertJob(kind, `${kind}:${this.connector.id}:${mod}:${day}:${uf ?? 'BR'}`, { day, modalidade: mod, uf }, recent, reopenDay);
            }
          }
        }
      }
      // reconciliação de contratações abertas (horizonte configurável)
      const horizon = addDaysYmd(today, s.horizonteDias);
      for (const mod of this.enabledModalidades()) {
        this.upsertJob('reconcile', `reconcile:${this.connector.id}:${mod}:${today}`, { dataFinal: horizon, modalidade: mod, runKey: today }, 1, false);
      }
    });
    return { days };
  }

  /** Carga histórica configurável: pode ser pausada e retomada. */
  planHistorical(days: number): number {
    const s = this.store.getSettings();
    const today = ymd(this.clock());
    const endDay = addDaysYmd(today, -s.diasIniciais);
    const startDay = addDaysYmd(endDay, -(days - 1));
    let n = 0;
    this.db.tx(() => {
      for (const day of eachDay(startDay, endDay)) {
        for (const mod of this.enabledModalidades()) {
          for (const kind of ['discover', 'update'] as const) {
            this.upsertJob(kind, `${kind}:${this.connector.id}:${mod}:${day}:BR`, { day, modalidade: mod, uf: null, historical: true }, 5, false);
            n++;
          }
        }
      }
    });
    return n;
  }

  setHistoricalPaused(paused: boolean): void {
    this.store.settings.setRaw('historical_paused', paused);
    this.progress.historicalPaused = paused;
    this.emit('Carga histórica ' + (paused ? 'pausada' : 'retomada'));
  }

  /** Reconsulta detalhe de oportunidades ativas, acompanhadas ou com prazo próximo. */
  planRefetch(): number {
    const now = this.nowMs();
    const rows = this.db.all<Row>(
      `SELECT p.id, p.last_detail_at, p.missing_count, (w.procurement_id IS NOT NULL) AS watched
       FROM procurements p LEFT JOIN watchlist w ON w.procurement_id=p.id AND w.status!='descartada'
       WHERE (w.procurement_id IS NOT NULL OR p.relevance IN ('alta','revisar','pendente'))
         AND (p.derived_state IN ('Abertura futura','Recebendo propostas') OR p.missing_count>0
              OR (p.encerramento_utc IS NOT NULL AND p.encerramento_utc > ?))
         AND (p.not_found_at IS NULL OR p.not_found_at < ?)
       LIMIT 300`, new Date(now - 3 * 86_400_000).toISOString(), new Date(now - 24 * 3_600_000).toISOString());
    let n = 0;
    this.db.tx(() => {
      for (const r of rows) {
        const maxAge = (r.watched ? 2 : 12) * 3_600_000;
        if (r.last_detail_at && now - Date.parse(r.last_detail_at) < maxAge && !r.missing_count) continue;
        this.upsertJob('refetch', `refetch:${this.connector.id}:${r.id}`, { procurementId: r.id }, r.watched || r.missing_count ? 1 : 2, true);
        n++;
      }
    });
    return n;
  }

  /** Enriquecimento seletivo (itens → anexos) para candidatos legislativos genéricos e aderentes. */
  planEnrichment(): number {
    const rows = this.db.all<Row>(
      `SELECT p.id FROM procurements p JOIN classifications c ON c.procurement_id=p.id
       WHERE p.not_found_at IS NULL AND (
          (c.needs_enrichment=1 AND p.items_fetched_at IS NULL)
          OR (p.relevance IN ('alta','revisar') AND p.docs_fetched_at IS NULL)
          OR (p.id IN (SELECT procurement_id FROM watchlist) AND p.docs_fetched_at IS NULL))
       ORDER BY (p.derived_state='Recebendo propostas') DESC, p.relevance_score DESC LIMIT 200`);
    this.db.tx(() => { for (const r of rows) this.upsertJob('enrich', `enrich:${this.connector.id}:${r.id}`, { procurementId: r.id }, 3, false); });
    return rows.length;
  }

  /** Fila separada para anexos prioritários (edital/TR) e revalidação periódica de hash. */
  planDocs(): number {
    if (!this.docs) return 0;
    // Edital/TR de todo candidato; retificações, ETP e anexos de quem é relevante, acompanhado ou alvo do Ágil.
    // Anexos que o PNCP respondeu como inexistentes voltam à fila no prazo de revalidação (até MAX_DOC_ATTEMPTS).
    const now = this.nowIso();
    const rows = this.db.all<Row>(
      `SELECT d.id FROM documents d JOIN procurements p ON p.id=d.procurement_id
       LEFT JOIN agil_fit f ON f.procurement_id=p.id
       LEFT JOIN watchlist w ON w.procurement_id=p.id AND w.status!='descartada'
       WHERE d.ativo=1
         AND (p.relevance IN ('alta','revisar','pendente') OR w.procurement_id IS NOT NULL OR f.aderencia IN ('nucleo','plenario','compilacao','complemento','condicionada'))
         AND d.priority >= CASE WHEN p.relevance IN ('alta','revisar') OR w.procurement_id IS NOT NULL OR f.aderencia IN ('nucleo','plenario','compilacao') THEN 60 ELSE 90 END
         AND (d.status='pendente'
              OR (d.status='erro' AND d.attempts < ${MAX_DOC_ATTEMPTS} AND d.revalidate_at IS NOT NULL AND d.revalidate_at < ?)
              OR (d.status='baixado' AND d.revalidate_at IS NOT NULL AND d.revalidate_at < ? AND p.derived_state IN ('Abertura futura','Recebendo propostas')))
       ORDER BY (p.derived_state IN ('Abertura futura','Recebendo propostas')) DESC, (w.procurement_id IS NOT NULL) DESC, d.priority DESC, p.relevance_score DESC
       LIMIT 150`, now, now);
    this.db.tx(() => { for (const r of rows) this.upsertJob('doc', `doc:${this.connector.id}:${r.id}`, { documentId: r.id }, 4, true); });
    return rows.length;
  }

  // ---------- execução ----------
  cancel(): void { this.ctl?.abort(); }

  recoverStale(): number {
    return this.db.run("UPDATE sync_jobs SET status='pendente', updated_at=? WHERE status='executando'", this.nowIso()).changes;
  }

  /** Há jobs prontos para executar (retomada após erro transitório, orçamento de tempo ou nova janela)? */
  hasDueWork(): boolean {
    const paused = !!this.store.settings.getRaw('historical_paused');
    return !!this.db.get(
      `SELECT 1 FROM sync_jobs WHERE status IN ('pendente','erro') AND (next_run_at IS NULL OR next_run_at <= ?) ${paused ? 'AND priority < 5' : ''} LIMIT 1`, this.nowIso());
  }

  getProgress(): SyncProgress { return { ...this.progress }; }
  private emit(message?: string): void {
    const c = this.db.get<{ pend: number; done: number }>(
      "SELECT SUM(status IN ('pendente','erro','executando')) AS pend, SUM(status='concluido') AS done FROM sync_jobs");
    this.progress = { ...this.progress, jobsPending: Number(c?.pend ?? 0), jobsDone: this.stats.jobsDone, message: message ?? this.progress.message };
    this.deps.emit?.({ ...this.progress });
  }

  async runCycle(trigger: string, opts: { continuation?: boolean } = {}): Promise<RunStats> {
    if (this.running) return this.stats;
    this.running = true;
    this.ctl = new AbortController();
    this.stats = this.emptyStats();
    this.docsThisRun = 0;
    const s = this.store.getSettings();
    this.deadline = this.nowMs() + s.orcamentoMinutos * 60_000;
    this.silent = !this.store.settings.getRaw('initial_done');
    this.progress = { ...this.progress, running: true, trigger, message: 'Planejando janelas…' };
    this.runId = this.db.run('INSERT INTO sync_runs (trigger, started_at) VALUES (?,?)', trigger, this.nowIso()).lastId;
    this.progress.runId = this.runId;
    let status = 'concluido';
    let error: string | null = null;
    try {
      this.recoverStale();
      this.planWindows(!opts.continuation);
      this.log('info', `Execução iniciada (${trigger}). Modalidades: ${this.enabledModalidades().join(', ')}.`);
      this.emit();
      await this.drain();
      // reconciliação concluída -> marca ausências (sem fechar nada) e agenda reconsulta
      this.finalizeReconcile();
      this.planRefetch();
      this.planEnrichment();
      this.planDocs();
      await this.drain();
      this.finishCoverage();
      this.maintenance();
    } catch (e) {
      if (e instanceof CancelledError) { status = 'cancelado'; }
      else { status = 'erro'; error = e instanceof Error ? e.message : String(e); this.log('error', `Falha na execução: ${error}`); }
    } finally {
      this.db.run('UPDATE sync_runs SET finished_at=?, status=?, stats=?, error=? WHERE id=?', this.nowIso(), status, JSON.stringify(this.stats), error, this.runId);
      this.running = false;
      this.progress = { ...this.progress, running: false, current: null, page: null, totalPages: null };
      this.emit(status === 'concluido' ? 'Concluído' : status === 'cancelado' ? 'Cancelado' : 'Falha: ' + error);
      this.ctl = null;
    }
    return this.stats;
  }

  private claimNext(): Row | undefined {
    const paused = !!this.store.settings.getRaw('historical_paused');
    const job = this.db.get<Row>(
      `SELECT * FROM sync_jobs WHERE status IN ('pendente','erro') AND (next_run_at IS NULL OR next_run_at <= ?) ${paused ? 'AND priority < 5' : ''}
       ORDER BY priority, id LIMIT 1`, this.nowIso());
    if (!job) return undefined;
    this.db.run("UPDATE sync_jobs SET status='executando', updated_at=? WHERE id=?", this.nowIso(), job.id);
    return job;
  }

  private async drain(): Promise<void> {
    const n = this.store.getSettings().concorrencia;
    const loop = async () => {
      for (;;) {
        if (this.ctl?.signal.aborted) throw new CancelledError();
        if (this.nowMs() > this.deadline) { this.stats.budgetExhausted = true; return; }
        const job = this.claimNext();
        if (!job) return;
        await this.runJob(job);
      }
    };
    await Promise.all(Array.from({ length: n }, loop));
  }

  private async runJob(job: Row): Promise<void> {
    const params = JSON.parse(job.params);
    const label = job.partition_key as string;
    this.progress = { ...this.progress, current: label, page: null, totalPages: null };
    this.emit(`Executando ${label}`);
    try {
      switch (job.kind as JobKind) {
        case 'discover': case 'update': await this.runWindow(job, params, job.kind === 'discover' ? 'publicacao' : 'atualizacao'); break;
        case 'reconcile': await this.runWindow(job, params, 'proposta'); break;
        case 'refetch': await this.runRefetch(job, params); break;
        case 'enrich': await this.runEnrich(job, params); break;
        case 'doc': await this.runDoc(job, params); break;
      }
    } catch (e) {
      if (e instanceof CancelledError) {
        this.db.run("UPDATE sync_jobs SET status='pendente', updated_at=? WHERE id=?", this.nowIso(), job.id);
        throw e;
      }
      this.failJob(job, e);
    }
  }

  private failJob(job: Row, e: unknown): void {
    const permanent = e instanceof SchemaError || (e instanceof HttpError && e.permanent);
    const msg = e instanceof Error ? e.message : String(e);
    const attempts = (job.attempts as number) + 1;
    this.stats.jobsFailed++;
    if (permanent) {
      // erro permanente: diagnóstico, sem repetição em loop (até o usuário reprocessar)
      this.db.run("UPDATE sync_jobs SET status='erro_permanente', attempts=?, last_error=?, updated_at=? WHERE id=?", attempts, msg.slice(0, 1000), this.nowIso(), job.id);
      this.log('error', `Erro permanente em ${job.partition_key}: ${msg}`, { window: job.partition_key, route: e instanceof SchemaError ? e.route : undefined, detail: msg });
    } else {
      const wait = Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** Math.min(attempts, 8));
      this.db.run("UPDATE sync_jobs SET status='erro', attempts=?, last_error=?, next_run_at=?, updated_at=? WHERE id=?",
        attempts, msg.slice(0, 1000), new Date(this.nowMs() + wait).toISOString(), this.nowIso(), job.id);
      this.log('warn', `Falha transitória em ${job.partition_key} (tentativa ${attempts}): ${msg}`, { window: job.partition_key, attempt: attempts });
    }
  }

  private async runWindow(job: Row, params: any, route: ListRoute): Promise<void> {
    const s = this.store.getSettings();
    const cp = JSON.parse(job.checkpoint || '{}') as { page?: number; total?: number; totalPages?: number; drift?: boolean };
    let page = cp.page ?? 1;
    let totalPages = cp.totalPages ?? 0;
    let total = cp.total;
    let drift = !!cp.drift;
    const mkQuery = (p: number): ListQuery => route === 'proposta'
      ? { route, dataFinal: params.dataFinal, modalidade: params.modalidade, uf: params.uf ?? undefined, pagina: p, tamanhoPagina: s.tamanhoPagina }
      : { route, dataInicial: params.day, dataFinal: params.day, modalidade: params.modalidade, uf: params.uf ?? undefined, pagina: p, tamanhoPagina: s.tamanhoPagina };
    const ctxRoute = route === 'proposta' ? 'lista-proposta' : 'lista';
    const persist = (records: any[], p: number, tp: number, tr: number) => {
      // página e checkpoint na MESMA transação
      this.db.tx(() => {
        for (const rec of records) {
          const r = this.store.upsertProcurement(rec, { silent: this.silent, level: 0, route: ctxRoute });
          this.stats.records++;
          if (this.store.recordMarket(rec)) this.stats.software++;
          if (r.discarded) this.stats.discarded++;
          if (r.created) this.stats.created++;
          if (r.changed.length) this.stats.changed++;
          if (route === 'proposta') this.db.run('INSERT OR IGNORE INTO reconcile_seen (run_key, control_id) VALUES (?,?)', params.runKey, rec.controlId);
        }
        this.db.run('UPDATE sync_jobs SET checkpoint=?, updated_at=?, status=\'executando\' WHERE id=?',
          JSON.stringify({ page: p + 1, total: tr, totalPages: tp, drift }), this.nowIso(), job.id);
      });
    };

    for (;;) {
      if (this.ctl?.signal.aborted) throw new CancelledError();
      if (this.nowMs() > this.deadline) {
        // orçamento de tempo: retoma depois sem perder o checkpoint
        this.stats.budgetExhausted = true;
        this.db.run("UPDATE sync_jobs SET status='pendente', updated_at=? WHERE id=?", this.nowIso(), job.id);
        return;
      }
      const res = await this.connector.listWindow(mkQuery(page), this.ctl?.signal);
      this.stats.pages++;
      this.stats.rejected += res.rejected.length;
      for (const rj of res.rejected.slice(0, 3)) this.log('warn', `Registro rejeitado: ${rj.reason}`, { route, window: job.partition_key });
      if (page === 1 || total === undefined) total = res.totalRegistros;
      else if (res.totalRegistros !== total) { drift = true; total = res.totalRegistros; }
      totalPages = res.totalPaginas;
      this.progress = { ...this.progress, page, totalPages };
      this.emit();

      // janela grande demais: divide por UF (somente quando necessário)
      if (page === 1 && !params.uf && totalPages > s.maxPaginasJanela && route !== 'proposta') {
        this.db.tx(() => {
          for (const uf of UFS) this.upsertJob(job.kind, `${job.partition_key.replace(/:BR$/, '')}:${uf}`, { ...params, uf }, job.priority, true);
          this.db.run("UPDATE sync_jobs SET status='dividido', finished_at=?, updated_at=? WHERE id=?", this.nowIso(), this.nowIso(), job.id);
        });
        this.log('warn', `Janela ${job.partition_key} com ${totalPages} páginas dividida por UF.`, { window: job.partition_key });
        return;
      }

      persist(res.records, page, totalPages, total ?? 0);
      if (res.empty || page >= totalPages) break;
      page++;
    }

    // Reprocessa as pontas quando a paginação variou durante a leitura.
    if (drift && totalPages > 0) {
      for (const p of new Set([1, totalPages])) {
        const res = await this.connector.listWindow(mkQuery(p), this.ctl?.signal);
        this.stats.pages++;
        persist(res.records, p, totalPages, res.totalRegistros);
      }
      this.log('info', `Paginação instável em ${job.partition_key}: pontas reprocessadas.`, { window: job.partition_key });
    }
    // só marca concluído quando a janela está completa
    this.db.run("UPDATE sync_jobs SET status='concluido', finished_at=?, updated_at=?, last_error=NULL, attempts=0 WHERE id=?", this.nowIso(), this.nowIso(), job.id);
    this.stats.jobsDone++;
  }

  private async runRefetch(job: Row, params: any): Promise<void> {
    const p = this.db.get<Row>('SELECT * FROM procurements WHERE id=?', params.procurementId);
    if (!p) { this.db.run("UPDATE sync_jobs SET status='concluido', finished_at=? WHERE id=?", this.nowIso(), job.id); return; }
    try {
      const n = await this.connector.fetchDetail({ cnpj: p.cnpj, ano: p.ano, sequencial: p.sequencial }, this.ctl?.signal);
      const r = this.store.upsertProcurement(n, { silent: false, level: 1, route: 'detalhe' });
      if (r.changed.length) this.stats.changed++;
    } catch (e) {
      if (e instanceof NotFoundError) {
        // 404 é registrado separadamente; NÃO altera a situação da oportunidade
        this.db.run('UPDATE procurements SET not_found_at=? WHERE id=?', this.nowIso(), p.id);
        this.log('warn', `Detalhe de ${p.control_id} retornou 404 (situação mantida).`, { route: 'detalhe' });
      } else throw e;
    }
    this.db.run("UPDATE sync_jobs SET status='concluido', finished_at=?, updated_at=? WHERE id=?", this.nowIso(), this.nowIso(), job.id);
    this.stats.jobsDone++;
  }

  private async runEnrich(job: Row, params: any): Promise<void> {
    const p = this.db.get<Row>('SELECT * FROM procurements WHERE id=?', params.procurementId);
    if (p) {
      const ref = { cnpj: p.cnpj, ano: p.ano, sequencial: p.sequencial };
      const items = await this.connector.fetchItems(ref, this.ctl?.signal);
      this.store.saveItems(p.id, items);
      this.store.reclassify(p.id, false);
      const after = this.db.get<Row>('SELECT relevance FROM procurements WHERE id=?', p.id);
      // se ainda for candidato legislativo (ou aderente), lista anexos; o download entra na fila separada
      if (after && after.relevance !== 'fora') {
        const docs = await this.connector.fetchDocuments(ref, this.ctl?.signal);
        this.store.saveDocuments(p.id, docs);
      } else {
        this.db.run('UPDATE procurements SET docs_fetched_at=? WHERE id=?', this.nowIso(), p.id);
      }
    }
    this.db.run("UPDATE sync_jobs SET status='concluido', finished_at=?, updated_at=? WHERE id=?", this.nowIso(), this.nowIso(), job.id);
    this.stats.jobsDone++;
  }

  private async runDoc(job: Row, params: any): Promise<void> {
    if (!this.docs) { this.db.run("UPDATE sync_jobs SET status='concluido', finished_at=? WHERE id=?", this.nowIso(), job.id); return; }
    if (this.docsThisRun >= this.store.getSettings().maxDocsPorExecucao) {
      // limite de anexos por execução: fica na fila para a próxima
      this.db.run("UPDATE sync_jobs SET status='pendente', next_run_at=?, updated_at=? WHERE id=?", new Date(this.nowMs() + 30 * 60_000).toISOString(), this.nowIso(), job.id);
      return;
    }
    this.docsThisRun++;
    await this.docs.process(params.documentId, this.ctl?.signal);
    this.stats.docs++;
    this.db.run("UPDATE sync_jobs SET status='concluido', finished_at=?, updated_at=? WHERE id=?", this.nowIso(), this.nowIso(), job.id);
    this.stats.jobsDone++;
  }

  /** Ausência na reconciliação é dado inconclusivo: só agenda reconsulta do detalhe. */
  finalizeReconcile(): number {
    const today = ymd(this.clock());
    const jobs = this.db.all<Row>("SELECT status FROM sync_jobs WHERE kind='reconcile' AND partition_key LIKE ?", `reconcile:${this.connector.id}:%:${today}`);
    if (!jobs.length || jobs.some((j) => j.status !== 'concluido')) return 0;
    if (this.store.settings.getRaw(`reconcile_final:${today}`)) return 0;
    const s = this.store.getSettings();
    const horizonIso = new Date(this.nowMs() + s.horizonteDias * 86_400_000).toISOString();
    const missing = this.db.all<Row>(
      `SELECT id FROM procurements WHERE source=? AND derived_state IN ('Abertura futura','Recebendo propostas')
         AND encerramento_utc IS NOT NULL AND encerramento_utc > ? AND encerramento_utc <= ?
         AND modalidade_id IN (${this.enabledModalidades().join(',')})
         AND control_id NOT IN (SELECT control_id FROM reconcile_seen WHERE run_key=?)`,
      this.connector.id, this.nowIso(), horizonIso, today);
    this.db.tx(() => {
      for (const m of missing) {
        this.db.run('UPDATE procurements SET missing_count=missing_count+1, last_missing_at=? WHERE id=?', this.nowIso(), m.id);
        this.upsertJob('refetch', `refetch:${this.connector.id}:${m.id}`, { procurementId: m.id }, 1, true);
      }
      this.store.settings.setRaw(`reconcile_final:${today}`, true);
      this.db.run('DELETE FROM reconcile_seen WHERE run_key < ?', addDaysYmd(today, -3));
    });
    if (missing.length) this.log('info', `Reconciliação: ${missing.length} contratações ausentes do feed de propostas serão reconsultadas (situação mantida).`);
    return missing.length;
  }

  private finishCoverage(): void {
    const today = ymd(this.clock());
    const pend = this.db.get<{ c: number }>(
      "SELECT COUNT(*) AS c FROM sync_jobs WHERE kind IN ('discover','update') AND priority<5 AND status NOT IN ('concluido','dividido')")!.c;
    if (pend === 0) {
      this.store.settings.setRaw('covered_through', today);
      this.store.settings.setRaw('last_full_sync_at', this.nowIso());
      if (!this.store.settings.getRaw('initial_done')) {
        this.store.settings.setRaw('initial_done', true);
        const n = this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM procurements WHERE relevance IN ('alta','revisar')")!.c;
        // um resumo no lugar de avisos individuais retroativos
        this.db.run(
          `INSERT OR IGNORE INTO notifications (kind, dedupe_key, title, body, fire_at, status, created_at) VALUES ('resumo','resumo-inicial',?,?,?,'agendada',?)`,
          'Importação inicial concluída', `${n} oportunidades aderentes ou para revisar foram encontradas. Abra o painel para ver o histórico.`, this.nowIso(), this.nowIso());
      }
    }
    this.store.settings.setRaw('last_contact_at', this.nowIso());
  }

  maintenance(): void {
    const s = this.store.getSettings();
    this.db.run('DELETE FROM sync_log WHERE ts < ?', new Date(this.nowMs() - s.retencaoLogDias * 86_400_000).toISOString());
    this.db.run("DELETE FROM sync_jobs WHERE status IN ('concluido','dividido') AND kind IN ('discover','update','reconcile') AND finished_at < ?", new Date(this.nowMs() - 60 * 86_400_000).toISOString());
    this.docs?.purge(s.retencaoAnexosDias);
    // só sai do acervo o que nunca foi candidato do nicho (guardado com "guardar fora do perfil")
    const purged = this.store.purgeOutOfProfile();
    if (purged) this.log('info', `${purged} contratações que nunca foram do nicho removidas do acervo.`);
    try {
      const b = dailyBackup(this.db, s.backupsManter, this.clock());
      if (b) this.log('info', `Cópia diária do banco gravada (${b.split(/[\\/]/).pop()}).`);
    } catch (e) { this.log('warn', `Cópia diária do banco falhou: ${(e as Error).message}`); }
  }

  /**
   * Reabre as janelas de publicação dos últimos `days` dias (prioridade acima da carga histórica) para que contratações
   * apagadas por versões antigas, ou descartadas por regras antigas, voltem ao acervo.
   */
  replanRecent(days: number): number {
    const s = this.store.getSettings();
    const today = ymd(this.clock());
    const ufs = s.ufColeta.length ? s.ufColeta : [null];
    let n = 0;
    this.db.tx(() => {
      for (const day of eachDay(addDaysYmd(today, -days), today)) {
        for (const mod of this.enabledModalidades()) {
          for (const uf of ufs) {
            this.upsertJob('discover', `discover:${this.connector.id}:${mod}:${day}:${uf ?? 'BR'}`, { day, modalidade: mod, uf }, 4, true);
            n++;
          }
        }
      }
    });
    return n;
  }

  /** Reenfileira jobs com erro permanente (ação explícita do usuário). */
  resetFailedJobs(): number {
    return this.db.run("UPDATE sync_jobs SET status='pendente', attempts=0, next_run_at=NULL, last_error=NULL WHERE status IN ('erro','erro_permanente')").changes;
  }
}
