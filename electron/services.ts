import * as fs from 'node:fs';
import * as path from 'node:path';
import { Db, openDb } from './db.ts';
import { SettingsStore } from './settings.ts';
import { Store } from './store.ts';
import { HttpClient } from './http.ts';
import { PncpConnector } from './pncp.ts';
import { SyncEngine, type SyncProgress } from './sync.ts';
import { DocPipeline } from './docs.ts';
import { dailyBackup, latestBackup } from './backup.ts';
import { AGIL_VERSION } from './agil.ts';

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

/**
 * Abre o banco; se estiver corrompido, preserva o arquivo antigo e restaura a cópia diária mais recente
 * (ou recomeça vazio quando não há cópia).
 */
export function openDbWithRecovery(file: string): { db: Db; recovered: string | null; restoredFrom: string | null } {
  try {
    const db = openDb(file);
    const check = db.selfCheck();
    if (check.integrity !== 'ok') throw new Error('integrity_check: ' + check.integrity);
    return { db, recovered: null, restoredFrom: null };
  } catch (e) {
    if (file === ':memory:' || !fs.existsSync(file)) throw e;
    const backup = `${file}.corrompido-${Date.now()}`;
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.renameSync(file + suffix, backup + suffix); } catch { /* ignora */ }
    }
    const copy = latestBackup(file);
    if (copy) {
      try {
        fs.copyFileSync(copy, file);
        const db = openDb(file);
        if (db.selfCheck().integrity === 'ok') return { db, recovered: backup, restoredFrom: copy };
        db.close();
        fs.rmSync(file, { force: true });
      } catch { fs.rmSync(file, { force: true }); }
    }
    return { db: openDb(file), recovered: backup, restoredFrom: null };
  }
}

export function createServices(dataDir: string, emit?: (p: SyncProgress) => void): Services {
  const { db, recovered, restoredFrom } = openDbWithRecovery(path.join(dataDir, 'dados', 'monitor.sqlite'));
  const settings = new SettingsStore(db);
  // cópia do dia ANTES de qualquer reclassificação ou limpeza da abertura
  let backupError: string | null = null;
  try { dailyBackup(db, settings.get().backupsManter); } catch (e) { backupError = (e as Error).message; }
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
  if (recovered) {
    engine.log('error', restoredFrom
      ? `Banco corrompido: arquivo preservado em ${path.basename(recovered)} e cópia ${path.basename(restoredFrom)} restaurada.`
      : `Banco corrompido: arquivo preservado em ${path.basename(recovered)} e novo banco criado (sem cópia diária disponível).`);
  }
  if (backupError) engine.log('warn', `Cópia diária do banco não foi feita: ${backupError}`);
  upgradeClassification(store, engine);
  rescueDeletedRecords(store, engine);
  return { db, settings, store, http, connector, engine, docs, recovered };
}

/**
 * Versões até a 1.3.4 apagavam do acervo contratações reclassificadas como fora do perfil depois da leitura do edital
 * (ex.: Santa Isabel/SP). Uma vez por instalação, as janelas de publicação recentes são relidas com as regras atuais
 * para trazer de volta o que ainda está no PNCP.
 */
export function rescueDeletedRecords(store: Store, engine: SyncEngine, days = 30): number {
  if (store.settings.getRaw('resgate_v1')) return 0;
  const n = engine.replanRecent(days);
  store.settings.setRaw('resgate_v1', true);
  if (n) engine.log('info', `Resgate do acervo: ${n} janelas de publicação dos últimos ${days} dias serão relidas com as regras atuais.`);
  return n;
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
  const fits = store.refreshAgilFits();
  if (fits) engine.log('info', `Aderência ao Ágil recalculada em ${fits} contratações (catálogo ${AGIL_VERSION}).`);
  store.recomputeDocPriorities();
  const mk = store.reclassifyMarket();
  if (mk.updated + mk.removed > 0) engine.log('info', `Mercado: ${mk.updated} contratações recategorizadas, ${mk.removed} removidas (não eram software).`);
  if (purgedBefore + purgedAfter > 500) {
    try { store.db.exec('VACUUM'); } catch { /* compacta na próxima oportunidade */ }
  }
  if (purgedBefore + purgedAfter + reclassified > 0) {
    engine.log('info', `Regras ${version}: ${reclassified} reclassificadas, ${purgedBefore + purgedAfter} contratações fora do perfil removidas do acervo.`);
  }
}
