import { app, net } from 'electron';
import { execFile } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { REPO, appVersion, compareVersions, versionsDir } from './version.ts';

export type UpdateStatus = 'desativado' | 'ocioso' | 'verificando' | 'disponivel' | 'baixando' | 'pronto' | 'instalando' | 'atualizado' | 'manual' | 'erro';

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  version: string | null;
  releaseDate: string | null;
  notes: string | null;
  percent: number | null;
  error: string | null;
  checkedAt: string | null;
  releaseUrl: string | null;
}

/** Manifesto publicado em cada Release (app-latest.json). */
export interface UpdateManifest {
  version: string;
  runtime: string;   // versão do Electron exigida pelo pacote
  file: string;      // nome do asset .tar.gz
  sha512: string;    // base64
  size: number;
  notes?: string;
}

const ALLOWED_HOSTS = ['github.com', 'api.github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com', 'github-releases.githubusercontent.com'];

export function validateManifest(m: any, currentRuntime: string): UpdateManifest {
  if (!m || typeof m !== 'object') throw new Error('Manifesto inválido');
  if (!/^\d+\.\d+\.\d+$/.test(m.version)) throw new Error('Versão inválida no manifesto');
  if (typeof m.file !== 'string' || !/^app-\d+\.\d+\.\d+\.tar\.gz$/.test(m.file)) throw new Error('Arquivo inválido no manifesto');
  if (typeof m.sha512 !== 'string' || !/^[A-Za-z0-9+/=]{80,100}$/.test(m.sha512)) throw new Error('Hash inválido no manifesto');
  if (!Number.isInteger(m.size) || m.size <= 0 || m.size > 400 * 1024 * 1024) throw new Error('Tamanho inválido no manifesto');
  if (typeof m.runtime !== 'string') throw new Error('Runtime ausente no manifesto');
  void currentRuntime;
  return { version: m.version, runtime: m.runtime, file: m.file, sha512: m.sha512, size: m.size, notes: typeof m.notes === 'string' ? m.notes.slice(0, 2000) : undefined };
}

function checkHost(url: string): void {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.includes(u.hostname)) throw new Error(`Origem de atualização não permitida: ${u.hostname}`);
}

/** Extrai .tar.gz com o tar.exe do próprio Windows (System32, assinado pela Microsoft). */
export function extractTarGz(file: string, dest: string): Promise<void> {
  const tar = path.join(process.env['SystemRoot'] || 'C:\\Windows', 'System32', 'tar.exe');
  fs.mkdirSync(dest, { recursive: true });
  return new Promise((resolve, reject) => execFile(tar, ['-xzf', file, '-C', dest], { windowsHide: true }, (e, _o, stderr) => (e ? reject(new Error(`Falha ao extrair: ${stderr || e.message}`)) : resolve())));
}

export function sha512File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha512');
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('base64')));
  });
}

/**
 * Atualização sem instalador: baixa só o pacote do app (JavaScript, interface e módulos), confere o SHA-512,
 * extrai em %LOCALAPPDATA%\monitor-licitacoes\versoes\<versão> e reinicia. O executável do Electron não muda,
 * por isso o Controle Inteligente de Aplicativos do Windows não tem nada novo para bloquear.
 */
export class Updater {
  private state: UpdateState;
  private installWhenReady = false;
  private busy = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private onChange: (s: UpdateState) => void,
    private log: (level: 'info' | 'warn' | 'error', msg: string) => void,
    private beforeQuit: () => void,
    private fetchImpl: (url: string) => Promise<Response> = (url) => net.fetch(url, { headers: { 'User-Agent': 'MonitorLicitacoes', Accept: 'application/vnd.github+json' } }),
  ) {
    const enabled = app.isPackaged;
    this.state = {
      status: enabled ? 'ocioso' : 'desativado', currentVersion: appVersion(), version: null, releaseDate: null, notes: null,
      percent: null, error: enabled ? null : 'Atualizações só funcionam no app instalado.', checkedAt: null, releaseUrl: null,
    };
  }

  get(): UpdateState { return { ...this.state }; }
  private set(p: Partial<UpdateState>): void { this.state = { ...this.state, ...p }; this.onChange(this.get()); }

  start(): void {
    if (!app.isPackaged) return;
    this.cleanup();
    setTimeout(() => void this.check(), 20_000);
    this.timer = setInterval(() => void this.check(), 4 * 3_600_000);
  }

  async check(): Promise<UpdateState> {
    if (!app.isPackaged || this.busy || ['baixando', 'pronto', 'instalando'].includes(this.state.status)) return this.get();
    this.busy = true;
    this.set({ status: 'verificando', error: null });
    try {
      const rel = await this.json(`https://api.github.com/repos/${REPO}/releases/latest`);
      const asset = (name: string) => (rel.assets ?? []).find((a: any) => a.name === name);
      const mAsset = asset('app-latest.json');
      if (!mAsset) throw new Error('Nenhuma versão publicada com atualização automática.');
      const manifest = validateManifest(await this.json(mAsset.browser_download_url), process.versions.electron);
      const base = { checkedAt: new Date().toISOString(), releaseUrl: rel.html_url ?? null, releaseDate: rel.published_at ?? null, notes: manifest.notes ?? null };
      if (compareVersions(manifest.version, appVersion()) <= 0) { this.set({ ...base, status: 'atualizado', version: manifest.version }); return this.get(); }
      if (manifest.runtime !== process.versions.electron) {
        // mudou o Electron: precisa do pacote completo (zip) uma vez
        this.set({ ...base, status: 'manual', version: manifest.version });
        return this.get();
      }
      const file = asset(manifest.file);
      if (!file) throw new Error(`Pacote ${manifest.file} ausente no Release.`);
      this.set({ ...base, status: 'baixando', version: manifest.version, percent: 0 });
      await this.download(file.browser_download_url, manifest);
      this.set({ status: 'pronto', percent: 100 });
      this.log('info', `Versão ${manifest.version} baixada e verificada; pronta para reiniciar.`);
      if (this.installWhenReady) this.install();
    } catch (e) {
      const msg = friendly(e as Error);
      this.set({ status: 'erro', error: msg, percent: null });
      this.log('warn', `Atualização: ${(e as Error).message.slice(0, 300)}`);
    } finally {
      this.busy = false;
    }
    return this.get();
  }

  /** Um clique: se já baixou, reinicia na nova versão; senão baixa e reinicia ao terminar. */
  async updateNow(): Promise<UpdateState> {
    if (!app.isPackaged) return this.get();
    this.installWhenReady = true;
    if (this.state.status === 'pronto') { this.install(); return this.get(); }
    if (!this.busy) await this.check();
    return this.get();
  }

  private install(): void {
    this.set({ status: 'instalando' });
    this.log('info', `Reiniciando na versão ${this.state.version}.`);
    this.beforeQuit();
    if (this.timer) clearInterval(this.timer);
    setTimeout(() => { app.relaunch(); app.exit(0); }, 300);
  }

  private async json(url: string): Promise<any> {
    checkHost(url);
    const r = await this.fetchImpl(url);
    if (!r.ok) throw new Error(`HTTP ${r.status} em ${new URL(url).pathname}`);
    return r.json();
  }

  private async download(url: string, m: UpdateManifest): Promise<void> {
    checkHost(url);
    const dir = versionsDir();
    fs.mkdirSync(dir, { recursive: true });
    const part = path.join(dir, `${m.version}.tar.gz.part`);
    const r = await this.fetchImpl(url);
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} ao baixar a atualização`);
    const out = fs.createWriteStream(part);
    let got = 0;
    const reader = r.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.byteLength;
        if (got > m.size) throw new Error('Pacote maior que o informado no manifesto.');
        if (!out.write(value)) await new Promise<void>((res) => out.once('drain', () => res()));
        this.set({ percent: Math.min(99, Math.round((got / m.size) * 100)) });
      }
    } finally {
      await new Promise<void>((res) => out.end(res));
    }
    if (got !== m.size) throw new Error('Download incompleto.');
    const sha = await sha512File(part);
    if (sha !== m.sha512) { fs.rmSync(part, { force: true }); throw new Error('O pacote baixado não confere com o hash publicado.'); }
    const tmp = path.join(dir, `${m.version}.tmp`);
    const final = path.join(dir, m.version);
    fs.rmSync(tmp, { recursive: true, force: true });
    await extractTarGz(part, tmp);
    const pkg = JSON.parse(fs.readFileSync(path.join(tmp, 'package.json'), 'utf8'));
    if (pkg.version !== m.version || !fs.existsSync(path.join(tmp, pkg.main))) throw new Error('Pacote extraído não corresponde à versão anunciada.');
    fs.rmSync(final, { recursive: true, force: true });
    fs.renameSync(tmp, final);
    fs.rmSync(part, { force: true });
    fs.writeFileSync(path.join(dir, 'current.json'), JSON.stringify({ version: m.version, installedAt: new Date().toISOString() }));
  }

  /** Mantém só a versão atual e a anterior. */
  private cleanup(): void {
    try {
      const dir = versionsDir();
      if (!fs.existsSync(dir)) return;
      const keep = new Set([appVersion()]);
      const vers = fs.readdirSync(dir).filter((n) => /^\d+\.\d+\.\d+$/.test(n)).sort(compareVersions).reverse();
      for (const v of vers.slice(0, 2)) keep.add(v);
      for (const n of fs.readdirSync(dir)) {
        if (n === 'current.json' || n === 'boot.json' || keep.has(n)) continue;
        fs.rmSync(path.join(dir, n), { recursive: true, force: true });
      }
    } catch { /* limpeza é oportunista */ }
  }
}

function friendly(e: Error): string {
  const m = e.message ?? String(e);
  if (/net::|ENOTFOUND|ETIMEDOUT|ECONNRESET|getaddrinfo|fetch failed/i.test(m)) return 'Sem conexão para verificar atualizações.';
  if (/HTTP 404/.test(m)) return 'Nenhuma versão publicada encontrada.';
  if (/HTTP 403/.test(m)) return 'Limite de consultas do GitHub atingido; tente mais tarde.';
  return m.slice(0, 200);
}
