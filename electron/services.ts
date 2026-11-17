import * as fs from 'node:fs';
import * as path from 'node:path';
import { Db, openDb } from './db.ts';
import { SettingsStore } from './settings.ts';
import { Store } from './store.ts';
import { HttpClient } from './http.ts';
import { PncpConnector } from './pncp.ts';
import { SyncEngine, type SyncProgress } from './sync.ts';
import { DocPipeline } from './docs.ts';

export interface Services {
  db: Db;
  settings: SettingsStore;
  store: Store;
  http: HttpClient;
  connector: PncpConnector;
  engine: SyncEngine;
  docs: DocPipeline;
  recovered: string | null;
}

/** Abre o banco; se estiver corrompido, preserva o arquivo antigo e recomeça (recuperação após falha). */
export function openDbWithRecovery(file: string): { db: Db; recovered: string | null } {
  try {
    const db = openDb(file);
    const check = db.selfCheck();
    if (check.integrity !== 'ok') throw new Error('integrity_check: ' + check.integrity);
    return { db, recovered: null };
  } catch (e) {
    if (file === ':memory:' || !fs.existsSync(file)) throw e;
    const backup = `${file}.corrompido-${Date.now()}`;
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.renameSync(file + suffix, backup + suffix); } catch { /* ignora */ }
    }
    return { db: openDb(file), recovered: backup };
  }
}

export function createServices(dataDir: string, emit?: (p: SyncProgress) => void): Services {
  const { db, recovered } = openDbWithRecovery(path.join(dataDir, 'dados', 'monitor.sqlite'));
  const settings = new SettingsStore(db);
  const store = new Store(db, settings);
  const s = settings.get();
  let engine: SyncEngine;
  const http = new HttpClient({
    maxConcurrent: s.concorrencia,
    maxPerMinute: s.maxRequisicoesPorMinuto,
    minIntervalMs: 400,
    baseBackoffMs: 2000,
    maxRetries: 5,
    onAttempt: (i) => engine?.logHttp(i),
  });
  const connector = new PncpConnector(http);
  const docs = new DocPipeline(store, connector, path.join(dataDir, 'anexos'));
  engine = new SyncEngine({ store, connector, docs, emit });
  engine.recoverStale();
  // execuções interrompidas pelo fechamento do app não ficam presas como "executando"
  db.run("UPDATE sync_runs SET status='interrompido', finished_at=COALESCE(finished_at, started_at) WHERE status='executando'");
  if (recovered) engine.log('error', `Banco corrompido: arquivo preservado em ${path.basename(recovered)} e novo banco criado.`);
  upgradeClassification(store, engine);
  return { db, settings, store, http, connector, engine, docs, recovered };
}

/**
 * Na abertura: se as regras mudaram de versão, remove o que já era "fora do perfil", reclassifica o restante
 * com as regras novas e remove o que deixou de ser do nicho. Acompanhadas e decisões manuais são preservadas.
 */
export function upgradeClassification(store: Store, engine: SyncEngine): void {
  const version = store.getRules().version;
  const outdated = store.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM classifications WHERE rules_version != ?', version)!.c;
  const purgedBefore = store.purgeOutOfProfile();
  let reclassified = 0;
  if (outdated > 0) {
    const ids = store.db.all<{ procurement_id: number }>('SELECT procurement_id FROM classifications WHERE rules_version != ?', version);
    for (const r of ids) store.reclassify(r.procurement_id, true);
    reclassified = ids.length;
  }
  const purgedAfter = store.purgeOutOfProfile();
  const mk = store.reclassifyMarket();
  if (mk.updated + mk.removed > 0) engine.log('info', `Mercado: ${mk.updated} contratações recategorizadas, ${mk.removed} removidas (não eram software).`);
  if (purgedBefore + purgedAfter > 500) {
    try { store.db.exec('VACUUM'); } catch { /* compacta na próxima oportunidade */ }
  }
  if (purgedBefore + purgedAfter + reclassified > 0) {
    engine.log('info', `Regras ${version}: ${reclassified} reclassificadas, ${purgedBefore + purgedAfter} contratações fora do perfil removidas do acervo.`);
  }
}
