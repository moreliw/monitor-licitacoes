/**
 * Cópias diárias do banco (VACUUM INTO): consistentes mesmo com o app gravando, sem parar a coleta.
 * Ficam em dados/backups/monitor-AAAAMMDD.sqlite; as mais antigas além do limite são apagadas.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Db } from './db.ts';
import { ymd } from './time.ts';

const NAME = /^monitor-(\d{8})\.sqlite$/;

export function backupDir(dbFile: string): string {
  return path.join(path.dirname(dbFile), 'backups');
}

export function listBackups(dbFile: string): string[] {
  const dir = backupDir(dbFile);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => NAME.test(f)).sort().reverse().map((f) => path.join(dir, f));
}

export function latestBackup(dbFile: string): string | null {
  return listBackups(dbFile)[0] ?? null;
}

/** Faz a cópia do dia se ainda não existir. Devolve o caminho criado ou null. */
export function dailyBackup(db: Db, keep: number, now: Date = new Date()): string | null {
  if (db.file === ':memory:') return null;
  const dir = backupDir(db.file);
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `monitor-${ymd(now)}.sqlite`);
  if (fs.existsSync(target)) return null;
  const tmp = target + '.tmp';
  fs.rmSync(tmp, { force: true });
  db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  fs.renameSync(tmp, target);
  for (const old of listBackups(db.file).slice(Math.max(1, keep))) fs.rmSync(old, { force: true });
  return target;
}
