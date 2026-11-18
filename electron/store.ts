import type { Db, Row } from './db.ts';
import type { NormalizedDocument, NormalizedItem, NormalizedProcurement } from './connector.ts';
import { classify, normalizeText, DEFAULT_RULES, validateRuleSet, type Classification, type Label, type RuleSet } from './classify.ts';
import { ACTIVE_STATES, deriveState, type DerivedState } from './states.ts';
import { SettingsStore, type Settings } from './settings.ts';
import { fmtBrasilia } from './time.ts';
import { classifyMarket, MARKET_VERSION } from './market.ts';

export interface UpsertContext {
  /** Importação inicial: histórico visível, sem avisos retroativos. */
  silent: boolean;
  level: 0 | 1;
  route: string;
}

export interface UpsertResult {
  id: number;
  created: boolean;
  stale: boolean;
  changed: string[];
  /** Contratação nova fora do perfil: analisada e não guardada. */
  discarded?: boolean;
}

type Clock = () => Date;

const TRACKED: [string, string][] = [
  ['encerramento_utc', 'Encerramento de propostas'],
  ['abertura_utc', 'Abertura de propostas'],
  ['situacao_id', 'Situação'],
  ['objeto', 'Objeto'],
  ['valor_estimado_cents', 'Valor estimado'],
  ['modalidade_id', 'Modalidade'],
];

const FINAL_STATES: DerivedState[] = ['Suspensa', 'Revogada', 'Anulada'];

export class Store {
  private rulesCache: RuleSet | null = null;
  constructor(readonly db: Db, readonly settings: SettingsStore, private clock: Clock = () => new Date()) {}

  now(): string { return this.clock().toISOString(); }

  // ---------- regras ----------
  getRules(): RuleSet {
    if (!this.rulesCache) {
      const raw = this.settings.getRaw('rules');
      // Regras salvas idênticas a uma versão padrão anterior são atualizadas para o padrão vigente.
      const outdatedDefault = raw && ['2026.11.1', '2026.11.2', '2026.11.3'].includes(raw.version);
      try { this.rulesCache = raw && !outdatedDefault ? validateRuleSet(raw) : DEFAULT_RULES; } catch { this.rulesCache = DEFAULT_RULES; }
    }
    return this.rulesCache;
  }
  setRules(rs: unknown): RuleSet {
    const valid = validateRuleSet(rs);
    this.settings.setRaw('rules', valid);
    this.rulesCache = valid;
    return valid;
  }
  resetRules(): RuleSet {
    this.db.run('DELETE FROM settings WHERE key=?', 'rules');
    this.rulesCache = null;
    return this.getRules();
  }

  // ---------- upsert ----------
  upsertProcurement(n: NormalizedProcurement, ctx: UpsertContext): UpsertResult {
    return this.db.tx(() => {
      const now = this.now();
      const existing = this.db.get<Row>('SELECT * FROM procurements WHERE control_id=?', n.controlId);
      const state = deriveState(
        { situacao_id: n.situacaoId, situacao_nome: n.situacaoNome, modalidade_id: n.modalidadeId, abertura_utc: n.aberturaUtc, encerramento_utc: n.encerramentoUtc },
        this.clock(),
      );

      if (!existing) {
        // Só o nicho é guardado: a classificação barata por metadados decide antes da gravação.
        if (!this.settings.get().guardarForaDoPerfil && !this.isInProfile(n)) {
          return { id: 0, created: false, stale: false, changed: [], discarded: true };
        }
        const r = this.db.run(
          `INSERT INTO procurements (control_id, source, cnpj, ano, sequencial, numero_compra, processo, orgao_nome, poder, esfera,
             unidade_nome, codigo_unidade, uf, municipio, codigo_ibge, orgao_subrogado, unidade_subrogada, modalidade_id, modalidade_nome,
             objeto, info_complementar, situacao_id, situacao_nome, valor_estimado_cents, valor_homologado_cents, orcamento_sigiloso,
             data_publicacao, abertura_raw, abertura_utc, encerramento_raw, encerramento_utc, prazo_origem, link_pncp, link_origem, link_processo,
             source_updated_utc, detail_level, derived_state, first_seen_at, last_seen_at, last_detail_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          n.controlId, n.source, n.cnpj, n.ano, n.sequencial, n.numeroCompra, n.processo, n.orgaoNome, n.poder, n.esfera,
          n.unidadeNome, n.codigoUnidade, n.uf, n.municipio, n.codigoIbge, n.orgaoSubrogado, n.unidadeSubrogada, n.modalidadeId, n.modalidadeNome,
          n.objeto, n.infoComplementar, n.situacaoId, n.situacaoNome, n.valorEstimadoCents, n.valorHomologadoCents,
          n.orcamentoSigiloso === null ? null : n.orcamentoSigiloso ? 1 : 0,
          n.dataPublicacao, n.aberturaRaw, n.aberturaUtc, n.encerramentoRaw, n.encerramentoUtc, n.prazoOrigem, n.linkPncp, n.linkOrigem, n.linkProcesso,
          n.sourceUpdatedUtc, ctx.level, state, now, now, ctx.level === 1 ? now : null, now,
        );
        const id = r.lastId;
        this.saveSourceRecord(id, n, ctx.route);
        this.snapshot(id, n.source, this.fieldsOf(this.db.get<Row>('SELECT * FROM procurements WHERE id=?', id)!));
        this.reclassify(id, ctx.silent);
        this.syncReminders(id);
        return { id, created: true, stale: false, changed: [] };
      }

      const id = existing.id as number;
      const incomingNewer = !n.sourceUpdatedUtc || !existing.source_updated_utc || n.sourceUpdatedUtc >= existing.source_updated_utc;
      const strictlyOlder = !!n.sourceUpdatedUtc && !!existing.source_updated_utc && n.sourceUpdatedUtc < existing.source_updated_utc;
      const sameButShallower = n.sourceUpdatedUtc === existing.source_updated_utc && ctx.level < (existing.detail_level as number);
      if (strictlyOlder || !incomingNewer || sameButShallower) {
        // Listagem antiga não sobrescreve dado mais novo ou detalhado.
        this.db.run('UPDATE procurements SET last_seen_at=?, missing_count=0 WHERE id=?', now, id);
        return { id, created: false, stale: true, changed: [] };
      }

      const next: Row = {
        cnpj: n.cnpj, ano: n.ano, sequencial: n.sequencial, numero_compra: n.numeroCompra, processo: n.processo,
        orgao_nome: n.orgaoNome, poder: n.poder, esfera: n.esfera, unidade_nome: n.unidadeNome, codigo_unidade: n.codigoUnidade,
        uf: n.uf, municipio: n.municipio, codigo_ibge: n.codigoIbge, orgao_subrogado: n.orgaoSubrogado, unidade_subrogada: n.unidadeSubrogada,
        modalidade_id: n.modalidadeId, modalidade_nome: n.modalidadeNome, objeto: n.objeto, info_complementar: n.infoComplementar,
        situacao_id: n.situacaoId, situacao_nome: n.situacaoNome, valor_estimado_cents: n.valorEstimadoCents,
        valor_homologado_cents: n.valorHomologadoCents,
        orcamento_sigiloso: n.orcamentoSigiloso === null ? null : n.orcamentoSigiloso ? 1 : 0,
        data_publicacao: n.dataPublicacao, abertura_raw: n.aberturaRaw, abertura_utc: n.aberturaUtc,
        encerramento_raw: n.encerramentoRaw, encerramento_utc: n.encerramentoUtc, prazo_origem: n.prazoOrigem,
        link_pncp: n.linkPncp, link_origem: n.linkOrigem, link_processo: n.linkProcesso, source_updated_utc: n.sourceUpdatedUtc,
        detail_level: Math.max(ctx.level, existing.detail_level as number), derived_state: state,
      };
      const changed: string[] = [];
      for (const [col] of TRACKED) if ((existing[col] ?? null) !== (next[col] ?? null)) changed.push(col);

      const cols = Object.keys(next);
      this.db.run(
        `UPDATE procurements SET ${cols.map((c) => `${c}=?`).join(',')}, last_seen_at=?, missing_count=0, not_found_at=NULL,
           last_detail_at=${ctx.level === 1 ? '?' : 'last_detail_at'}, updated_at=? WHERE id=?`,
        ...(cols.map((c) => next[c] ?? null) as any[]), now, ...(ctx.level === 1 ? [now] : []), now, id,
      );
      this.saveSourceRecord(id, n, ctx.route);

      if (changed.length) {
        this.snapshot(id, n.source, this.fieldsOf(this.db.get<Row>('SELECT * FROM procurements WHERE id=?', id)!));
        this.emitChangeEvents(id, existing, next, changed, ctx.silent);
      }
      if (changed.includes('objeto')) this.reclassify(id, ctx.silent);
      this.syncReminders(id);
      return { id, created: false, stale: false, changed };
    });
  }

  private saveSourceRecord(id: number, n: NormalizedProcurement, route: string): void {
    this.db.run(
      `INSERT INTO source_records (procurement_id, source, external_id, route, payload, source_updated_utc, fetched_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(procurement_id, source, route) DO UPDATE SET payload=excluded.payload, source_updated_utc=excluded.source_updated_utc, fetched_at=excluded.fetched_at`,
      id, n.source, n.controlId, route === 'detalhe' ? 'detalhe' : 'lista', JSON.stringify(n.raw), n.sourceUpdatedUtc, this.now(),
    );
  }

  private fieldsOf(row: Row): Row {
    const o: Row = {};
    for (const [c] of TRACKED) o[c] = row[c] ?? null;
    o['derived_state'] = row.derived_state;
    return o;
  }

  private snapshot(id: number, source: string, fields: Row): void {
    this.db.run('INSERT INTO snapshots (procurement_id, captured_at, source, fields) VALUES (?,?,?,?)', id, this.now(), source, JSON.stringify(fields));
  }

  // ---------- eventos ----------
  private emitChangeEvents(id: number, before: Row, after: Row, changed: string[], silent: boolean): void {
    const upd = String(after.source_updated_utc ?? '');
    if (changed.includes('situacao_id')) {
      const was = before.situacao_id, is = after.situacao_id;
      let type: string | null = null;
      if (is === 4) type = 'suspensao';
      else if (is === 2) type = 'revogacao';
      else if (is === 3) type = 'anulacao';
      else if (was === 4 && is === 1) type = 'reabertura';
      if (type) this.addEvent(id, type, `sit:${id}:${is}:${upd}`, { before: { situacao: before.situacao_nome }, after: { situacao: after.situacao_nome } }, silent);
    }
    if (changed.includes('encerramento_utc') && before.encerramento_utc) {
      const later = after.encerramento_utc && String(after.encerramento_utc) > String(before.encerramento_utc);
      this.addEvent(id, later ? 'prorrogacao' : 'retificacao', `prazo:${id}:${after.encerramento_utc ?? 'null'}:${upd}`,
        { before: { encerramento: before.encerramento_utc }, after: { encerramento: after.encerramento_utc } }, silent);
    }
    if (changed.includes('objeto') || changed.includes('valor_estimado_cents') || changed.includes('abertura_utc')) {
      this.addEvent(id, 'retificacao', `ret:${id}:${changed.filter((c) => c !== 'encerramento_utc').join('+')}:${upd}`,
        { before: { objeto: before.objeto, abertura: before.abertura_utc, valor: before.valor_estimado_cents }, after: { objeto: after.objeto, abertura: after.abertura_utc, valor: after.valor_estimado_cents } }, silent);
    }
  }

  readonly EVENT_TEXT: Record<string, string> = {
    nova_publicacao: 'Nova publicação aderente', prorrogacao: 'Prazo prorrogado', retificacao: 'Edital retificado',
    suspensao: 'Contratação suspensa', reabertura: 'Contratação reaberta', revogacao: 'Contratação revogada',
    anulacao: 'Contratação anulada', documento_alterado: 'Documento alterado',
  };

  /** Grava evento (idempotente pela chave) e, na mesma transação, o aviso correspondente. */
  addEvent(procId: number, type: string, key: string, payload: unknown, silent: boolean): number | null {
    const r = this.db.run(
      'INSERT OR IGNORE INTO events (procurement_id, type, event_key, payload, silent, created_at) VALUES (?,?,?,?,?,?)',
      procId, type, key, JSON.stringify(payload), silent ? 1 : 0, this.now(),
    );
    if (r.changes === 0) return null;
    if (!silent && this.settings.get().notificacoes !== undefined) this.notifyEvent(procId, type, r.lastId);
    return r.lastId;
  }

  private notifyEvent(procId: number, type: string, eventId: number): void {
    const p = this.db.get<Row>('SELECT * FROM procurements WHERE id=?', procId);
    if (!p) return;
    const watched = !!this.db.get('SELECT 1 FROM watchlist WHERE procurement_id=? AND status!=\'descartada\'', procId);
    const label = p.relevance as Label;
    const relevant = label === 'alta' || label === 'revisar';
    if (type === 'nova_publicacao' ? !relevant : !(watched || label === 'alta')) return;
    const where = [p.municipio, p.uf].filter(Boolean).join('/');
    const body = `${p.orgao_nome ?? ''}${where ? ' · ' + where : ''}\n${String(p.objeto ?? '').slice(0, 160)}` +
      (p.encerramento_utc && type !== 'nova_publicacao' ? `\nPrazo: ${fmtBrasilia(p.encerramento_utc)}` : p.encerramento_utc ? `\nPropostas até ${fmtBrasilia(p.encerramento_utc)}` : '');
    this.db.run(
      `INSERT OR IGNORE INTO notifications (procurement_id, event_id, kind, dedupe_key, title, body, fire_at, deadline_utc, status, created_at)
       VALUES (?,?,?,?,?,?,?,?, 'agendada', ?)`,
      procId, eventId, type, `evt:${eventId}`, this.EVENT_TEXT[type] ?? type, body, this.now(), p.encerramento_utc, this.now(),
    );
  }

  // ---------- lembretes ----------
  /** Recalcula os lembretes de prazo de acompanhadas; cancela os de prazos substituídos, encerrados ou suspensos. */
  syncReminders(procId: number): void {
    const p = this.db.get<Row>('SELECT * FROM procurements WHERE id=?', procId);
    if (!p) return;
    const watched = !!this.db.get("SELECT 1 FROM watchlist WHERE procurement_id=? AND status!='descartada'", procId);
    const nowMs = this.clock().getTime();
    const enc = p.encerramento_utc as string | null;
    const live = watched && ACTIVE_STATES.includes(p.derived_state) && !!enc && Date.parse(enc) > nowMs;
    const hours = this.settings.get().lembretesHoras;
    const wanted = new Set<string>();
    if (live) {
      for (const h of hours) {
        const fire = Date.parse(enc!) - h * 3_600_000;
        if (fire <= nowMs) continue; // evita avisos atrasados
        const key = `lem:${procId}:${enc}:${h}`;
        wanted.add(key);
        this.db.run(
          `INSERT INTO notifications (procurement_id, kind, dedupe_key, title, body, fire_at, deadline_utc, status, created_at)
           VALUES (?, 'lembrete', ?, ?, ?, ?, ?, 'agendada', ?)
           ON CONFLICT(dedupe_key) DO UPDATE SET status='agendada', fire_at=excluded.fire_at WHERE status='cancelada'`,
          procId, key, `Propostas encerram em ${h} h`,
          `${p.orgao_nome ?? ''} · ${[p.municipio, p.uf].filter(Boolean).join('/')}\nPrazo: ${fmtBrasilia(enc)} (Brasília) · ${String(p.objeto ?? '').slice(0, 120)}`,
          new Date(fire).toISOString(), enc, this.now(),
        );
      }
    }
    const pending = this.db.all<{ id: number; dedupe_key: string }>(
      "SELECT id, dedupe_key FROM notifications WHERE procurement_id=? AND kind='lembrete' AND status='agendada'", procId);
    for (const n of pending) {
      if (!wanted.has(n.dedupe_key)) this.db.run("UPDATE notifications SET status='cancelada' WHERE id=?", n.id);
    }
  }

  /** Recalcula o estado derivado de registros ainda em aberto e cancela lembretes de quem encerrou. */
  refreshStates(): number {
    const rows = this.db.all<Row>(
      "SELECT * FROM procurements WHERE derived_state IN ('Abertura futura','Recebendo propostas','Sem prazo confirmado')");
    let n = 0;
    for (const p of rows) {
      const st = deriveState(p as any, this.clock());
      if (st !== p.derived_state) {
        this.db.run('UPDATE procurements SET derived_state=?, updated_at=? WHERE id=?', st, this.now(), p.id);
        this.syncReminders(p.id);
        n++;
      }
    }
    return n;
  }

  /** Notificações vencidas a disparar (e cancela as obsoletas). */
  dueNotifications(): Row[] {
    const now = this.now();
    this.db.run(
      `UPDATE notifications SET status='cancelada'
       WHERE status='agendada' AND kind='lembrete' AND deadline_utc IS NOT NULL AND deadline_utc <= ?`, now);
    return this.db.all<Row>("SELECT * FROM notifications WHERE status='agendada' AND fire_at <= ? ORDER BY fire_at LIMIT 50", now);
  }
  markFired(id: number): void {
    this.db.run("UPDATE notifications SET status='disparada', fired_at=? WHERE id=? AND status='agendada'", this.now(), id);
  }

  // ---------- itens e documentos ----------
  saveItems(procId: number, items: NormalizedItem[]): void {
    this.db.tx(() => {
      const now = this.now();
      this.db.run('DELETE FROM items WHERE procurement_id=?', procId);
      for (const it of items) {
        this.db.run(
          `INSERT OR REPLACE INTO items (procurement_id, numero_item, descricao, material_ou_servico, quantidade, unidade_medida, valor_unitario,
             valor_total_cents, sigiloso, situacao, categoria, info_complementar, fetched_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          procId, it.numeroItem, it.descricao, it.materialOuServico, it.quantidade, it.unidadeMedida, it.valorUnitario, it.valorTotalCents,
          it.sigiloso === null ? null : it.sigiloso ? 1 : 0, it.situacao, it.categoria, it.infoComplementar, now,
        );
      }
      this.db.run('UPDATE procurements SET items_fetched_at=? WHERE id=?', now, procId);
    });
  }

  private docPriority(d: NormalizedDocument): number {
    const t = `${d.titulo ?? ''} ${d.tipoNome ?? ''}`.toLowerCase();
    if (/termo de refer|projeto b[aá]sico|anexo i\b/.test(t)) return 90;
    if (/edital|aviso de contrata/.test(t)) return 100;
    return 10;
  }

  saveDocuments(procId: number, docs: NormalizedDocument[]): void {
    this.db.tx(() => {
      const now = this.now();
      for (const d of docs) {
        this.db.run(
          `INSERT INTO documents (procurement_id, sequencial, titulo, tipo_id, tipo_nome, url, data_publicacao, ativo, priority)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT(procurement_id, sequencial) DO UPDATE SET titulo=excluded.titulo, tipo_id=excluded.tipo_id, tipo_nome=excluded.tipo_nome,
             url=excluded.url, data_publicacao=excluded.data_publicacao, ativo=excluded.ativo, priority=excluded.priority`,
          procId, d.sequencial, d.titulo, d.tipoId, d.tipoNome, d.url, d.dataPublicacao, d.ativo ? 1 : 0, this.docPriority(d),
        );
      }
      this.db.run('UPDATE procurements SET docs_fetched_at=? WHERE id=?', now, procId);
    });
  }

  saveDocumentText(docId: number, info: { sha256: string; bytes: number; localPath: string | null; pages: { page: number; text: string }[]; textStatus: string; totalPages: number }): { contentChanged: boolean } {
    return this.db.tx(() => {
      const prev = this.db.get<Row>('SELECT * FROM documents WHERE id=?', docId);
      const changed = !!prev?.sha256 && prev.sha256 !== info.sha256;
      this.db.run(
        `UPDATE documents SET status='baixado', error=NULL, sha256=?, bytes=?, local_path=?, text_status=?, pages=?, fetched_at=?, version=version+?,
           revalidate_at=? WHERE id=?`,
        info.sha256, info.bytes, info.localPath, info.textStatus, info.totalPages, this.now(), changed ? 1 : (prev?.version ? 0 : 1),
        new Date(this.clock().getTime() + 7 * 86_400_000).toISOString(), docId,
      );
      this.db.run('DELETE FROM doc_pages WHERE document_id=?', docId);
      for (const p of info.pages) this.db.run('INSERT INTO doc_pages (document_id, page, text) VALUES (?,?,?)', docId, p.page, p.text);
      return { contentChanged: changed };
    });
  }

  // ---------- classificação ----------
  reclassify(procId: number, silent = false): Classification | null {
    const p = this.db.get<Row>('SELECT * FROM procurements WHERE id=?', procId);
    if (!p) return null;
    const items = this.db.all<Row>('SELECT numero_item, descricao, info_complementar FROM items WHERE procurement_id=? ORDER BY numero_item', procId);
    const docs = this.db.all<Row>(
      `SELECT dp.document_id, d.titulo, dp.page, dp.text FROM doc_pages dp JOIN documents d ON d.id=dp.document_id
       WHERE d.procurement_id=? ORDER BY d.priority DESC, dp.page LIMIT 400`, procId);
    const result = classify({
      cnpj: p.cnpj, orgaoNome: p.orgao_nome, unidadeNome: p.unidade_nome, poder: p.poder, objeto: p.objeto, info: p.info_complementar,
      items: items.map((i) => ({ numero: i.numero_item, descricao: i.descricao, info: i.info_complementar })),
      docs: docs.map((d) => ({ documentId: d.document_id, titulo: d.titulo, page: d.page, text: d.text })),
      enriched: !!p.items_fetched_at || docs.length > 0,
      extraCnpjs: this.settings.get().cnpjsLegislativos,
    }, this.getRules());

    this.db.tx(() => {
      const prev = this.db.get<Row>('SELECT label_manual FROM classifications WHERE procurement_id=?', procId);
      const manual = (prev?.label_manual as Label | null) ?? null;
      this.db.run(
        `INSERT INTO classifications (procurement_id, rules_version, score, label_auto, label_manual, evidences, needs_enrichment, computed_at)
         VALUES (?,?,?,?,?,?,?,?)
         ON CONFLICT(procurement_id) DO UPDATE SET rules_version=excluded.rules_version, score=excluded.score, label_auto=excluded.label_auto,
           evidences=excluded.evidences, needs_enrichment=excluded.needs_enrichment, computed_at=excluded.computed_at`,
        procId, result.rulesVersion, result.score, result.label, manual, JSON.stringify(result.evidences), result.needsEnrichment ? 1 : 0, this.now(),
      );
      const effective = manual ?? result.label; // decisões manuais são preservadas
      this.db.run('UPDATE procurements SET relevance=?, relevance_score=? WHERE id=?', effective, result.score, procId);
      this.refreshFts(procId);
      if (effective === 'alta' || effective === 'revisar') {
        this.addEvent(procId, 'nova_publicacao', `nova:${procId}`, { relevancia: effective, score: result.score }, silent);
      }
    });
    return result;
  }

  /**
   * Inteligência de mercado: registra (ou atualiza) qualquer contratação de software vista na coleta,
   * independentemente do nicho. Idempotente por número de controle; dado mais antigo não sobrescreve o novo.
   */
  recordMarket(n: NormalizedProcurement): boolean {
    const m = classifyMarket(n.objeto, n.infoComplementar);
    if (!m.software) return false;
    const prev = this.db.get<{ source_updated_utc: string | null }>('SELECT source_updated_utc FROM market_items WHERE control_id=?', n.controlId);
    const now = this.now();
    if (prev && prev.source_updated_utc && n.sourceUpdatedUtc && n.sourceUpdatedUtc < prev.source_updated_utc) {
      this.db.run('UPDATE market_items SET last_seen_at=? WHERE control_id=?', now, n.controlId);
      return true;
    }
    const state = deriveState({ situacao_id: n.situacaoId, situacao_nome: n.situacaoNome, modalidade_id: n.modalidadeId, abertura_utc: n.aberturaUtc, encerramento_utc: n.encerramentoUtc }, this.clock());
    this.db.run(
      `INSERT INTO market_items (control_id, source, data_publicacao, orgao_nome, cnpj, esfera, poder, uf, municipio, modalidade_id, modalidade_nome,
         objeto, valor_estimado_cents, orcamento_sigiloso, encerramento_utc, situacao_id, derived_state, primary_category, categories, link_pncp,
         source_updated_utc, rules_version, busca, first_seen_at, last_seen_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(control_id) DO UPDATE SET data_publicacao=excluded.data_publicacao, orgao_nome=excluded.orgao_nome, esfera=excluded.esfera,
         poder=excluded.poder, uf=excluded.uf, municipio=excluded.municipio, modalidade_id=excluded.modalidade_id, modalidade_nome=excluded.modalidade_nome,
         objeto=excluded.objeto, valor_estimado_cents=excluded.valor_estimado_cents, orcamento_sigiloso=excluded.orcamento_sigiloso,
         encerramento_utc=excluded.encerramento_utc, situacao_id=excluded.situacao_id, derived_state=excluded.derived_state,
         primary_category=excluded.primary_category, categories=excluded.categories, link_pncp=excluded.link_pncp,
         source_updated_utc=excluded.source_updated_utc, rules_version=excluded.rules_version, busca=excluded.busca, last_seen_at=excluded.last_seen_at`,
      n.controlId, n.source, n.dataPublicacao, n.orgaoNome, n.cnpj, n.esfera, n.poder, n.uf, n.municipio, n.modalidadeId, n.modalidadeNome,
      (n.objeto ?? '').slice(0, 1500), n.valorEstimadoCents, n.orcamentoSigiloso === null ? null : n.orcamentoSigiloso ? 1 : 0,
      n.encerramentoUtc, n.situacaoId, state, m.primary, JSON.stringify(m.categories), n.linkPncp, n.sourceUpdatedUtc, MARKET_VERSION,
      normalizeText(`${n.objeto ?? ''} ${n.orgaoNome ?? ''} ${n.municipio ?? ''}`).slice(0, 2000), now, now,
    );
    return true;
  }

  /** Regras de mercado mudaram: reclassifica pelo objeto guardado e remove o que deixou de ser software. */
  reclassifyMarket(): { updated: number; removed: number } {
    const rows = this.db.all<Row>('SELECT control_id, objeto FROM market_items WHERE rules_version != ?', MARKET_VERSION);
    let updated = 0, removed = 0;
    this.db.tx(() => {
      for (const r of rows) {
        const m = classifyMarket(r.objeto);
        if (!m.software) { this.db.run('DELETE FROM market_items WHERE control_id=?', r.control_id); removed++; continue; }
        this.db.run('UPDATE market_items SET primary_category=?, categories=?, rules_version=? WHERE control_id=?', m.primary, JSON.stringify(m.categories), MARKET_VERSION, r.control_id);
        updated++;
      }
    });
    return { updated, removed };
  }

  /** Recalcula o estado (aberta/encerrada) do mercado conforme o relógio. */
  refreshMarketStates(): void {
    const rows = this.db.all<Row>("SELECT control_id, situacao_id, modalidade_id, encerramento_utc FROM market_items WHERE derived_state IN ('Abertura futura','Recebendo propostas')");
    for (const r of rows) {
      const st = deriveState({ situacao_id: r.situacao_id, situacao_nome: null, modalidade_id: r.modalidade_id, abertura_utc: null, encerramento_utc: r.encerramento_utc }, this.clock());
      if (st === 'Prazo encerrado') this.db.run('UPDATE market_items SET derived_state=? WHERE control_id=?', st, r.control_id);
    }
  }

  /** Classificação por metadados (objeto, órgão, unidade): tudo que não é "fora do perfil" é candidato. */
  isInProfile(n: NormalizedProcurement): boolean {
    const c = classify({
      cnpj: n.cnpj, orgaoNome: n.orgaoNome, unidadeNome: n.unidadeNome, poder: n.poder, objeto: n.objeto, info: n.infoComplementar,
      enriched: false, extraCnpjs: this.settings.get().cnpjsLegislativos,
    }, this.getRules());
    return c.label !== 'fora';
  }

  /**
   * Remove do acervo o que está fora do perfil (sem acompanhamento e sem decisão manual).
   * Usado na abertura, após reprocessar regras e ao desligar "guardar fora do perfil".
   */
  purgeOutOfProfile(): number {
    if (this.settings.get().guardarForaDoPerfil) return 0;
    const target = `SELECT p.id FROM procurements p
       WHERE p.relevance='fora'
         AND NOT EXISTS (SELECT 1 FROM classifications c WHERE c.procurement_id=p.id AND c.label_manual IS NOT NULL)
         AND NOT EXISTS (SELECT 1 FROM watchlist w WHERE w.procurement_id=p.id)`;
    return this.db.tx(() => {
      // em lote: FTS por rowid e exclusões em cascata indexadas
      this.db.run(`DELETE FROM search_fts WHERE rowid IN (${target})`);
      return this.db.run(`DELETE FROM procurements WHERE id IN (${target})`).changes;
    });
  }

  reclassifyAll(): number {
    const ids = this.db.all<{ id: number }>('SELECT id FROM procurements').map((r) => r.id);
    for (const id of ids) this.reclassify(id, true);
    return ids.length;
  }

  setManualLabel(procId: number, label: Label | null): void {
    this.db.tx(() => {
      this.db.run('UPDATE classifications SET label_manual=? WHERE procurement_id=?', label, procId);
      const c = this.db.get<Row>('SELECT label_auto FROM classifications WHERE procurement_id=?', procId);
      if (c) this.db.run('UPDATE procurements SET relevance=? WHERE id=?', label ?? c.label_auto, procId);
    });
  }

  refreshFts(procId: number): void {
    const p = this.db.get<Row>('SELECT * FROM procurements WHERE id=?', procId);
    if (!p) return;
    const items = this.db.all<Row>('SELECT descricao FROM items WHERE procurement_id=?', procId).map((i) => i.descricao ?? '').join('\n');
    const docs = this.db.all<Row>(
      `SELECT dp.text FROM doc_pages dp JOIN documents d ON d.id=dp.document_id WHERE d.procurement_id=? LIMIT 400`, procId)
      .map((d) => d.text).join('\n').slice(0, 400_000);
    this.db.run('DELETE FROM search_fts WHERE rowid=?', procId);
    this.db.run(
      'INSERT INTO search_fts (rowid, control_id, orgao, municipio, objeto, itens, documentos) VALUES (?,?,?,?,?,?,?)',
      procId, p.control_id, `${p.orgao_nome ?? ''} ${p.unidade_nome ?? ''}`, p.municipio ?? '', `${p.objeto ?? ''} ${p.info_complementar ?? ''}`, items, docs,
    );
  }

  // ---------- acompanhamento ----------
  setWatch(procId: number, patch: { status?: string; favorito?: boolean; notes?: string; checklist?: Record<string, boolean> } | null): void {
    this.db.tx(() => {
      if (patch === null) {
        this.db.run('DELETE FROM watchlist WHERE procurement_id=?', procId);
      } else {
        const now = this.now();
        const cur = this.db.get<Row>('SELECT * FROM watchlist WHERE procurement_id=?', procId);
        const status = patch.status ?? cur?.status ?? 'triagem';
        if (!['triagem', 'analise', 'descartada'].includes(status)) throw new Error('Status inválido');
        this.db.run(
          `INSERT INTO watchlist (procurement_id, status, favorito, notes, checklist, created_at, updated_at) VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(procurement_id) DO UPDATE SET status=excluded.status, favorito=excluded.favorito, notes=excluded.notes, checklist=excluded.checklist, updated_at=excluded.updated_at`,
          procId, status, (patch.favorito ?? !!cur?.favorito) ? 1 : 0, (patch.notes ?? cur?.notes ?? '').slice(0, 20000),
          JSON.stringify(patch.checklist ?? (cur ? JSON.parse(cur.checklist) : {})), cur?.created_at ?? now, now,
        );
      }
      this.syncReminders(procId);
    });
  }

  resyncAllReminders(): void {
    for (const r of this.db.all<{ procurement_id: number }>('SELECT procurement_id FROM watchlist')) this.syncReminders(r.procurement_id);
  }

  // ---------- divergências ----------
  recordDivergence(procId: number, field: string, a: { source: string; value: string; link?: string }, b: { source: string; value: string; link?: string }, basis: string): void {
    const dup = this.db.get(
      'SELECT 1 FROM divergences WHERE procurement_id=? AND field=? AND value_a=? AND value_b=? AND resolved=0', procId, field, a.value, b.value);
    if (dup) return;
    this.db.run(
      `INSERT INTO divergences (procurement_id, field, source_a, value_a, link_a, source_b, value_b, link_b, basis, detected_at) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      procId, field, a.source, a.value, a.link ?? null, b.source, b.value, b.link ?? null, basis, this.now(),
    );
  }

  getSettings(): Settings { return this.settings.get(); }
}
