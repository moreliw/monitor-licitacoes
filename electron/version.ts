import { app } from 'electron';
import * as path from 'node:path';

/** Repositório público de onde vêm as atualizações. */
export const REPO = 'moreliw/monitor-licitacoes';
export const APP_ID = 'dev.moreli.monitor-licitacoes';
export const PRODUCT_NAME = 'Monitor de Licitações Legislativas';
export const SHORTCUT_NAME = 'Monitor de Licitações';
export const EXE_NAME = 'Monitor Legislativo.exe';

/** Versão em execução: a do pacote carregado pelo bootstrap (atualização baixada) ou a do app instalado. */
export function appVersion(): string {
  return process.env['MONITOR_APP_VERSION'] || app.getVersion();
}

/** Pasta local (não sincronizada) com as versões baixadas pelo atualizador. */
export function versionsDir(): string {
  return path.join(process.env['LOCALAPPDATA'] || app.getPath('appData'), 'monitor-licitacoes', 'versoes');
}

/** Compara versões x.y.z (positivo se a > b). */
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(/[.+-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}
