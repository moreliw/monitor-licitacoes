import { app } from 'electron';
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater';

export type UpdateStatus = 'desativado' | 'ocioso' | 'verificando' | 'disponivel' | 'baixando' | 'pronto' | 'instalando' | 'atualizado' | 'erro';

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  version: string | null;
  releaseDate: string | null;
  notes: string | null;
  percent: number | null;
  error: string | null;
  checkedAt: string | null;
}

/**
 * Atualização dentro do app (GitHub Releases via electron-updater).
 * A nova versão é baixada em segundo plano; o botão "Atualizar agora" instala e reinicia com um clique.
 */
export class Updater {
  private state: UpdateState;
  private installWhenReady = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private onChange: (s: UpdateState) => void,
    private log: (level: 'info' | 'warn' | 'error', msg: string) => void,
    private beforeQuit: () => void,
  ) {
    this.state = {
      status: app.isPackaged ? 'ocioso' : 'desativado', currentVersion: app.getVersion(), version: null,
      releaseDate: null, notes: null, percent: null, error: app.isPackaged ? null : 'Atualizações só funcionam no app instalado.', checkedAt: null,
    };
  }

  get(): UpdateState { return { ...this.state }; }
  private set(patch: Partial<UpdateState>): void { this.state = { ...this.state, ...patch }; this.onChange(this.get()); }

  start(): void {
    if (!app.isPackaged) return;
    autoUpdater.autoDownload = true;          // baixa em segundo plano (diferencial via blockmap)
    autoUpdater.autoInstallOnAppQuit = true;  // se o usuário não clicar, instala ao encerrar
    autoUpdater.allowPrerelease = false;
    autoUpdater.logger = null;
    autoUpdater.on('checking-for-update', () => this.set({ status: 'verificando', error: null }));
    autoUpdater.on('update-not-available', () => this.set({ status: 'atualizado', checkedAt: new Date().toISOString(), percent: null }));
    autoUpdater.on('update-available', (i: UpdateInfo) => {
      this.set({ status: 'baixando', version: i.version, releaseDate: i.releaseDate ?? null, notes: notesText(i.releaseNotes), percent: 0, checkedAt: new Date().toISOString() });
      this.log('info', `Nova versão ${i.version} disponível; baixando em segundo plano.`);
    });
    autoUpdater.on('download-progress', (p: ProgressInfo) => this.set({ status: 'baixando', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (i: UpdateInfo) => {
      this.set({ status: 'pronto', version: i.version, percent: 100 });
      if (this.installWhenReady) this.install();
    });
    autoUpdater.on('error', (e: Error) => {
      this.set({ status: 'erro', error: friendly(e), percent: null });
      this.log('warn', `Atualização: ${e.message.slice(0, 300)}`);
    });
    setTimeout(() => void this.check(), 20_000);
    this.timer = setInterval(() => void this.check(), 4 * 3_600_000);
  }

  async check(): Promise<UpdateState> {
    if (!app.isPackaged) return this.get();
    if (['baixando', 'pronto', 'instalando'].includes(this.state.status)) return this.get();
    try { await autoUpdater.checkForUpdates(); } catch (e) { this.set({ status: 'erro', error: friendly(e as Error) }); }
    return this.get();
  }

  /** Um clique: se já baixou, instala e reinicia; senão baixa e instala ao terminar. */
  async updateNow(): Promise<UpdateState> {
    if (!app.isPackaged) return this.get();
    this.installWhenReady = true;
    if (this.state.status === 'pronto') { this.install(); return this.get(); }
    if (this.state.status !== 'baixando') {
      this.set({ status: 'baixando', percent: 0 });
      try { await autoUpdater.downloadUpdate(); } catch (e) { this.set({ status: 'erro', error: friendly(e as Error) }); }
    }
    return this.get();
  }

  private install(): void {
    this.set({ status: 'instalando' });
    this.log('info', `Instalando a versão ${this.state.version} e reiniciando.`);
    this.beforeQuit();
    if (this.timer) clearInterval(this.timer);
    setImmediate(() => autoUpdater.quitAndInstall(true, true)); // silencioso e reabre o app
  }
}

function notesText(n: UpdateInfo['releaseNotes']): string | null {
  if (!n) return null;
  const raw = typeof n === 'string' ? n : n.map((x) => x.note ?? '').join('\n');
  return raw.replace(/<[^>]+>/g, '').trim().slice(0, 2000) || null; // notas exibidas como texto puro
}

function friendly(e: Error): string {
  const m = e.message ?? String(e);
  if (/net::|ENOTFOUND|ETIMEDOUT|ECONNRESET|getaddrinfo/i.test(m)) return 'Sem conexão para verificar atualizações.';
  if (/404|latest\.yml/i.test(m)) return 'Nenhuma versão publicada encontrada.';
  return m.slice(0, 200);
}
