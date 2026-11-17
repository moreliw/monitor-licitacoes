import { DatabaseSync, type StatementSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Row = Record<string, any>;

/** Migrações versionadas. Nunca edite uma migração já publicada: adicione outra. */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: 'base',
    sql: `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE procurements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  control_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL DEFAULT 'pncp',
  cnpj TEXT, ano INTEGER, sequencial INTEGER,
  numero_compra TEXT, processo TEXT,
  orgao_nome TEXT, poder TEXT, esfera TEXT,
  unidade_nome TEXT, codigo_unidade TEXT,
  uf TEXT, municipio TEXT, codigo_ibge TEXT,
  orgao_subrogado TEXT, unidade_subrogada TEXT,
  modalidade_id INTEGER, modalidade_nome TEXT,
  objeto TEXT, info_complementar TEXT,
  situacao_id INTEGER, situacao_nome TEXT,
  valor_estimado_cents INTEGER, valor_homologado_cents INTEGER,
  orcamento_sigiloso INTEGER,
  data_publicacao TEXT,
  abertura_raw TEXT, abertura_utc TEXT,
  encerramento_raw TEXT, encerramento_utc TEXT,
  prazo_origem TEXT,
  link_pncp TEXT, link_origem TEXT, link_processo TEXT,
  source_updated_utc TEXT,
  detail_level INTEGER NOT NULL DEFAULT 0,
  derived_state TEXT,
  relevance TEXT NOT NULL DEFAULT 'pendente',
  relevance_score REAL NOT NULL DEFAULT 0,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_detail_at TEXT,
  missing_count INTEGER NOT NULL DEFAULT 0,
  last_missing_at TEXT,
  not_found_at TEXT,
  items_fetched_at TEXT,
  docs_fetched_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX ix_proc_state ON procurements(derived_state);
CREATE INDEX ix_proc_uf ON procurements(uf);
CREATE INDEX ix_proc_source ON procurements(source);
CREATE INDEX ix_proc_enc ON procurements(encerramento_utc);
CREATE INDEX ix_proc_rel ON procurements(relevance);
CREATE INDEX ix_proc_pub ON procurements(data_publicacao);
CREATE INDEX ix_proc_mod ON procurements(modalidade_id);

CREATE TABLE source_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  procurement_id INTEGER NOT NULL REFERENCES procurements(id) ON DELETE CASCADE,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  route TEXT NOT NULL,
  payload TEXT NOT NULL,
  source_updated_utc TEXT,
  fetched_at TEXT NOT NULL,
  UNIQUE(procurement_id, source, route)
);

CREATE TABLE items (
  procurement_id INTEGER NOT NULL REFERENCES procurements(id) ON DELETE CASCADE,
  numero_item INTEGER NOT NULL,
  descricao TEXT,
  material_ou_servico TEXT,
  quantidade TEXT,
  unidade_medida TEXT,
  valor_unitario TEXT,
  valor_total_cents INTEGER,
  sigiloso INTEGER,
  situacao TEXT,
  categoria TEXT,
  info_complementar TEXT,
  fetched_at TEXT NOT NULL,
  PRIMARY KEY (procurement_id, numero_item)
);

CREATE TABLE documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  procurement_id INTEGER NOT NULL REFERENCES procurements(id) ON DELETE CASCADE,
  sequencial INTEGER NOT NULL,
  titulo TEXT, tipo_id INTEGER, tipo_nome TEXT,
  url TEXT, data_publicacao TEXT, ativo INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pendente',
  error TEXT,
  sha256 TEXT, bytes INTEGER, version INTEGER NOT NULL DEFAULT 0,
  local_path TEXT,
  text_status TEXT NOT NULL DEFAULT 'nenhum',
  pages INTEGER,
  fetched_at TEXT, revalidate_at TEXT,
  UNIQUE(procurement_id, sequencial)
);
CREATE INDEX ix_doc_status ON documents(status);

CREATE TABLE doc_pages (
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (document_id, page)
);

CREATE TABLE snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  procurement_id INTEGER NOT NULL REFERENCES procurements(id) ON DELETE CASCADE,
  captured_at TEXT NOT NULL,
  source TEXT NOT NULL,
  fields TEXT NOT NULL
);
CREATE INDEX ix_snap_proc ON snapshots(procurement_id, id);

CREATE TABLE classifications (
  procurement_id INTEGER PRIMARY KEY REFERENCES procurements(id) ON DELETE CASCADE,
  rules_version TEXT NOT NULL,
  score REAL NOT NULL,
  label_auto TEXT NOT NULL,
  label_manual TEXT,
  evidences TEXT NOT NULL,
  needs_enrichment INTEGER NOT NULL DEFAULT 0,
  computed_at TEXT NOT NULL
);

CREATE TABLE watchlist (
  procurement_id INTEGER PRIMARY KEY REFERENCES procurements(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'triagem',
  favorito INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT '',
  checklist TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  procurement_id INTEGER NOT NULL REFERENCES procurements(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  event_key TEXT NOT NULL UNIQUE,
  payload TEXT NOT NULL,
  silent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_ev_proc ON events(procurement_id, id);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  procurement_id INTEGER REFERENCES procurements(id) ON DELETE CASCADE,
  event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  fire_at TEXT NOT NULL,
  deadline_utc TEXT,
  status TEXT NOT NULL DEFAULT 'agendada',
  fired_at TEXT, read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX ix_notif_status ON notifications(status, fire_at);

CREATE TABLE sync_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  partition_key TEXT NOT NULL UNIQUE,
  params TEXT NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'pendente',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_run_at TEXT,
  last_error TEXT,
  checkpoint TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
CREATE INDEX ix_job_status ON sync_jobs(status, priority);

CREATE TABLE sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trigger TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'executando',
  stats TEXT NOT NULL DEFAULT '{}',
  error TEXT
);

CREATE TABLE sync_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER, ts TEXT NOT NULL, level TEXT NOT NULL,
  source TEXT, route TEXT, window TEXT, attempt INTEGER,
  message TEXT NOT NULL, detail TEXT
);
CREATE INDEX ix_log_ts ON sync_log(ts);

CREATE TABLE divergences (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  procurement_id INTEGER NOT NULL REFERENCES procurements(id) ON DELETE CASCADE,
  field TEXT NOT NULL,
  source_a TEXT, value_a TEXT, link_a TEXT,
  source_b TEXT, value_b TEXT, link_b TEXT,
  basis TEXT, detected_at TEXT NOT NULL, resolved INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE reconcile_seen (
  run_key TEXT NOT NULL, control_id TEXT NOT NULL,
  PRIMARY KEY (run_key, control_id)
);

CREATE TABLE saved_filters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE, filter TEXT NOT NULL, created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE search_fts USING fts5(
  control_id UNINDEXED, orgao, municipio, objeto, itens, documentos,
  tokenize = 'unicode61 remove_diacritics 2'
);
`,
  },
  {
    version: 2,
    name: 'fts-por-rowid-e-indices-de-cascata',
    // A busca passa a usar rowid = procurements.id (exclusão/atualização indexadas, sem varrer a FTS).
    sql: `
CREATE INDEX IF NOT EXISTS ix_notif_proc ON notifications(procurement_id);
CREATE INDEX IF NOT EXISTS ix_div_proc ON divergences(procurement_id);
DELETE FROM search_fts;
INSERT INTO search_fts (rowid, control_id, orgao, municipio, objeto, itens, documentos)
SELECT p.id, p.control_id,
  COALESCE(p.orgao_nome, '') || ' ' || COALESCE(p.unidade_nome, ''),
  COALESCE(p.municipio, ''),
  COALESCE(p.objeto, '') || ' ' || COALESCE(p.info_complementar, ''),
  COALESCE((SELECT group_concat(i.descricao, char(10)) FROM items i WHERE i.procurement_id = p.id), ''),
  COALESCE((SELECT substr(group_concat(dp.text, char(10)), 1, 400000) FROM doc_pages dp JOIN documents d ON d.id = dp.document_id WHERE d.procurement_id = p.id), '')
FROM procurements p;
`,
  },
  {
    version: 3,
    name: 'mercado-de-software',
    // Registro compacto de TODA contratação de software vista na coleta (qualquer órgão), para inteligência de mercado.
    sql: `
CREATE TABLE market_items (
  control_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  data_publicacao TEXT,
  orgao_nome TEXT, cnpj TEXT, esfera TEXT, poder TEXT,
  uf TEXT, municipio TEXT,
  modalidade_id INTEGER, modalidade_nome TEXT,
  objeto TEXT,
  valor_estimado_cents INTEGER,
  orcamento_sigiloso INTEGER,
  encerramento_utc TEXT,
  situacao_id INTEGER,
  derived_state TEXT,
  primary_category TEXT NOT NULL,
  categories TEXT NOT NULL,
  link_pncp TEXT,
  source_updated_utc TEXT,
  rules_version TEXT NOT NULL,
  busca TEXT NOT NULL DEFAULT '',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX ix_mkt_cat ON market_items(primary_category);
CREATE INDEX ix_mkt_pub ON market_items(data_publicacao);
CREATE INDEX ix_mkt_uf ON market_items(uf);
CREATE INDEX ix_mkt_state ON market_items(derived_state);
`,
  },
];

export class Db {
  readonly raw: DatabaseSync;
  private cache = new Map<string, StatementSync>();
  private depth = 0;

  constructor(readonly file: string) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  }

  private stmt(sql: string): StatementSync {
    let s = this.cache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.cache.set(sql, s);
    }
    return s;
  }

  run(sql: string, ...params: SqlValue[]): { changes: number; lastId: number } {
    const r = this.stmt(sql).run(...params);
    return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
  }
  get<T = Row>(sql: string, ...params: SqlValue[]): T | undefined {
    const r = this.stmt(sql).get(...params);
    return r ? ({ ...r } as T) : undefined;
  }
  all<T = Row>(sql: string, ...params: SqlValue[]): T[] {
    return this.stmt(sql).all(...params).map((r) => ({ ...r }) as T);
  }
  exec(sql: string): void {
    this.raw.exec(sql);
  }

  /** Transação com suporte a aninhamento (savepoints). */
  tx<T>(fn: () => T): T {
    if (this.depth > 0) {
      const name = `sp${this.depth}`;
      this.raw.exec(`SAVEPOINT ${name}`);
      this.depth++;
      try {
        const v = fn();
        this.raw.exec(`RELEASE ${name}`);
        return v;
      } catch (e) {
        this.raw.exec(`ROLLBACK TO ${name}; RELEASE ${name}`);
        throw e;
      } finally {
        this.depth--;
      }
    }
    this.raw.exec('BEGIN IMMEDIATE');
    this.depth = 1;
    try {
      const v = fn();
      this.raw.exec('COMMIT');
      return v;
    } catch (e) {
      try { this.raw.exec('ROLLBACK'); } catch { /* ignora */ }
      throw e;
    } finally {
      this.depth = 0;
    }
  }

  migrate(): number {
    this.raw.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT, applied_at TEXT)');
    const done = new Set(this.all<{ version: number }>('SELECT version FROM schema_migrations').map((r) => r.version));
    let applied = 0;
    for (const m of MIGRATIONS) {
      if (done.has(m.version)) continue;
      this.tx(() => {
        this.raw.exec(m.sql);
        this.run('INSERT INTO schema_migrations(version,name,applied_at) VALUES (?,?,?)', m.version, m.name, new Date().toISOString());
      });
      applied++;
    }
    return applied;
  }

  /** Verifica integridade e a presença efetiva do FTS5. */
  selfCheck(): { sqlite: string; fts5: boolean; integrity: string; foreignKeys: boolean } {
    const sqlite = this.get<{ v: string }>('SELECT sqlite_version() AS v')!.v;
    let fts5 = false;
    try {
      this.raw.exec("CREATE VIRTUAL TABLE temp.fts_probe USING fts5(a, tokenize='unicode61 remove_diacritics 2')");
      this.run("INSERT INTO temp.fts_probe(a) VALUES ('Câmara Municipal')");
      fts5 = (this.get<{ c: number }>("SELECT count(*) AS c FROM temp.fts_probe WHERE fts_probe MATCH 'camara'")?.c ?? 0) === 1;
      this.raw.exec('DROP TABLE temp.fts_probe');
    } catch { fts5 = false; }
    const integrity = this.get<{ integrity_check: string }>('PRAGMA integrity_check')?.integrity_check ?? '?';
    const foreignKeys = (this.get<{ foreign_keys: number }>('PRAGMA foreign_keys')?.foreign_keys ?? 0) === 1;
    return { sqlite, fts5, integrity, foreignKeys };
  }

  close(): void {
    this.cache.clear();
    this.raw.close();
  }
}

export function openDb(file: string): Db {
  const db = new Db(file);
  db.migrate();
  return db;
}

/** Converte a entrada do usuário em consulta FTS5 segura (prefixos, AND implícito). */
export function toFtsQuery(input: string): string | null {
  const terms = input
    .normalize('NFD').replace(/\p{M}/gu, '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 0)
    .slice(0, 12);
  if (!terms.length) return null;
  return terms.map((t) => `"${t.replace(/"/g, '')}"*`).join(' ');
}
