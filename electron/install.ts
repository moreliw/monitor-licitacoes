/**
 * Instalação sem instalador .exe (compatível com o Controle Inteligente de Aplicativos):
 * o próprio app, rodando a partir do .zip extraído, se copia para %LOCALAPPDATA%\Programs\Monitor Legislativo,
 * cria os atalhos e se registra em "Aplicativos instalados". Só usa ferramentas do Windows (reg.exe, cmd.exe,
 * powershell.exe), todas assinadas pela Microsoft.
 */
import { app, dialog, shell } from 'electron';
import { execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { APP_ID, EXE_NAME, PRODUCT_NAME, SHORTCUT_NAME, appVersion, versionsDir } from './version.ts';

const UNINSTALL_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\MonitorLegislativo';
const sys32 = (exe: string) => path.join(process.env['SystemRoot'] || 'C:\\Windows', 'System32', exe);

export const isPortableRun = () => process.env['MONITOR_PORTABLE'] === '1' && app.isPackaged;
export const installDir = () => path.join(process.env['LOCALAPPDATA'] || app.getPath('appData'), 'Programs', 'Monitor Legislativo');
const oldNsisDir = () => path.join(process.env['LOCALAPPDATA'] || app.getPath('appData'), 'Programs', 'monitor-licitacoes');
const exeDir = () => path.dirname(process.execPath);
const same = (a: string, b: string) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
export const isInstalled = () => same(exeDir(), installDir());
const startMenuLink = () => path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', `${SHORTCUT_NAME}.lnk`);
const desktopLink = () => path.join(app.getPath('desktop'), `${SHORTCUT_NAME}.lnk`);
const choiceFile = () => path.join(app.getPath('userData'), 'instalacao.json');

/** Ícone num local fixo, copiado da versão em uso: atalhos e registro apontam para ele e acompanham as atualizações. */
const stableIcon = () => path.join(process.env['LOCALAPPDATA'] || app.getPath('appData'), 'monitor-licitacoes', 'icone.ico');

function iconFor(dir: string): string {
  if (fs.existsSync(stableIcon())) return stableIcon();
  const ico = path.join(dir, 'resources', 'app', 'icon.ico');
  return fs.existsSync(ico) ? ico : path.join(dir, EXE_NAME);
}

/** Copia o ícone da versão carregada para o local fixo. Retorna true se o ícone mudou. */
function syncStableIcon(): boolean {
  const appDir = process.env['MONITOR_APP_DIR'];
  const candidates = [appDir && path.join(appDir, 'build', 'icon.ico'), path.join(exeDir(), 'resources', 'app', 'icon.ico')].filter(Boolean) as string[];
  const src = candidates.find((p) => fs.existsSync(p));
  if (!src) return false;
  const dest = stableIcon();
  const next = fs.readFileSync(src);
  if (fs.existsSync(dest) && fs.readFileSync(dest).equals(next)) return false;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, next);
  return true;
}

function shortcut(link: string, dir: string): void {
  fs.mkdirSync(path.dirname(link), { recursive: true });
  shell.writeShortcutLink(link, 'create', {
    target: path.join(dir, EXE_NAME), cwd: dir, icon: iconFor(dir), iconIndex: 0,
    description: PRODUCT_NAME, appUserModelId: APP_ID,
  });
}

function reg(args: string[]): void { execFileSync(sys32('reg.exe'), args, { windowsHide: true, stdio: 'ignore' }); }

function dirSizeKb(dir: string): number {
  let total = 0;
  const walk = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else total += fs.statSync(p).size; } };
  try { walk(dir); } catch { /* aproximado */ }
  return Math.round(total / 1024);
}

/** Registra/atualiza a entrada em "Aplicativos instalados". */
export function registerUninstall(dir = installDir()): void {
  const exe = path.join(dir, EXE_NAME);
  const values: [string, string, string][] = [
    ['DisplayName', 'REG_SZ', PRODUCT_NAME],
    ['DisplayVersion', 'REG_SZ', appVersion()],
    ['Publisher', 'REG_SZ', 'Moreli.Dev'],
    ['DisplayIcon', 'REG_SZ', iconFor(dir)],
    ['InstallLocation', 'REG_SZ', dir],
    ['UninstallString', 'REG_SZ', `"${exe}" --desinstalar`],
    ['URLInfoAbout', 'REG_SZ', 'https://github.com/moreliw/monitor-licitacoes'],
    ['NoModify', 'REG_DWORD', '1'],
    ['NoRepair', 'REG_DWORD', '1'],
    ['EstimatedSize', 'REG_DWORD', String(dirSizeKb(dir))],
  ];
  for (const [name, type, data] of values) reg(['add', UNINSTALL_KEY, '/v', name, '/t', type, '/d', data, '/f']);
}

/** Remove a instalação antiga feita pelo instalador NSIS (até a 1.2.x), preservando os dados do usuário. */
function removeOldNsisInstall(): boolean {
  const old = oldNsisDir();
  if (!fs.existsSync(old)) return false;
  try {
    execFileSync(sys32('WindowsPowerShell\\v1.0\\powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command',
      "Get-ChildItem 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall' | Where-Object { (Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue).InstallLocation -like '*\\Programs\\monitor-licitacoes' } | Remove-Item -Recurse -Force"],
    { windowsHide: true, stdio: 'ignore' });
  } catch { /* entrada antiga pode não existir */ }
  fs.rmSync(old, { recursive: true, force: true });
  return true;
}

/** Na primeira execução a partir do .zip: oferece instalar. Retorna true se o processo deve encerrar. */
export async function offerInstall(): Promise<boolean> {
  if (!isPortableRun() || isInstalled()) return false;
  try { if (JSON.parse(fs.readFileSync(choiceFile(), 'utf8')).portatil) return false; } catch { /* sem escolha salva */ }
  const hasOld = fs.existsSync(oldNsisDir());
  const r = await dialog.showMessageBox({
    type: 'question', title: PRODUCT_NAME, noLink: true, defaultId: 0, cancelId: 2,
    message: 'Instalar o Monitor de Licitações neste computador?',
    detail: `Ele será copiado para ${installDir()} e aparecerá no Menu Iniciar e em "Aplicativos instalados".`
      + (hasOld ? '\n\nA versão anterior (instalador antigo) será substituída. Seus dados, acompanhamentos e alertas são mantidos.' : '')
      + '\n\nVocê também pode usar sem instalar, direto desta pasta.',
    buttons: ['Instalar', 'Usar sem instalar', 'Cancelar'],
    checkboxLabel: 'Criar atalho na área de trabalho', checkboxChecked: true,
  });
  if (r.response === 2) return true;
  if (r.response === 1) {
    fs.mkdirSync(path.dirname(choiceFile()), { recursive: true });
    fs.writeFileSync(choiceFile(), JSON.stringify({ portatil: true }));
    return false;
  }
  try {
    if (hasOld) removeOldNsisInstall();
    const dest = installDir();
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(exeDir(), dest, { recursive: true, force: true });
    syncStableIcon();
    shortcut(startMenuLink(), dest);
    if (r.checkboxChecked) shortcut(desktopLink(), dest);
    registerUninstall(dest);
    app.relaunch({ execPath: path.join(dest, EXE_NAME), args: [] });
    app.exit(0);
    return true;
  } catch (e) {
    dialog.showErrorBox(PRODUCT_NAME, `Não foi possível instalar: ${(e as Error).message}\n\nVocê pode continuar usando direto desta pasta.`);
    return false;
  }
}

/** Mantém atalhos e registro em dia (versão exibida, ícone novo após atualização). */
export function refreshInstallation(): void {
  if (!isPortableRun() || !isInstalled()) return;
  try {
    const iconChanged = syncStableIcon();
    if (iconChanged || !fs.existsSync(startMenuLink())) shortcut(startMenuLink(), installDir());
    if (iconChanged && fs.existsSync(desktopLink())) shortcut(desktopLink(), installDir());
    registerUninstall();
    // pede ao Windows para atualizar o cache de ícones (ferramenta do sistema, assinada pela Microsoft)
    if (iconChanged) spawn(sys32('ie4uinit.exe'), ['-show'], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  } catch { /* não impede o uso */ }
}

/** Desinstalação ("Aplicativos instalados" chama o exe com --desinstalar). */
export async function runUninstall(): Promise<void> {
  const r = await dialog.showMessageBox({
    type: 'warning', title: PRODUCT_NAME, noLink: true, defaultId: 1, cancelId: 1,
    message: 'Desinstalar o Monitor de Licitações?',
    detail: 'Remove o programa, os atalhos e a entrada em "Aplicativos instalados".',
    buttons: ['Desinstalar', 'Cancelar'],
    checkboxLabel: 'Apagar também meus dados (oportunidades, acompanhamentos e editais baixados)', checkboxChecked: false,
  });
  if (r.response !== 0) { app.exit(0); return; }
  try { app.setLoginItemSettings({ openAtLogin: false }); } catch { /* ignora */ }
  for (const l of [startMenuLink(), desktopLink()]) fs.rmSync(l, { force: true });
  try { reg(['delete', UNINSTALL_KEY, '/f']); } catch { /* já removida */ }
  fs.rmSync(path.dirname(versionsDir()), { recursive: true, force: true }); // versões baixadas e ícone
  // a pasta do programa (e os dados, se pedido) só podem ser apagados depois que este processo terminar
  const targets = [exeDir()];
  if (r.checkboxChecked) targets.push(app.getPath('userData'));
  const del = targets.map((t) => `rmdir /s /q "${t}"`).join(' & ');
  spawn(sys32('cmd.exe'), ['/d', '/c', `ping -n 3 127.0.0.1 >nul & ${del}`], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  app.exit(0);
}
