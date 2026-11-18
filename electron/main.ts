import { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, net, powerMonitor, protocol, session, shell, type IpcMainInvokeEvent } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Row } from './db.ts';
import { createServices, type Services } from './services.ts';
import { getOpportunity, exportCsv, listAlerts, listJobs, listLogs, listOpportunities, listRuns, searchDocumentExcerpts, sourcesOverview, marketOverview, marketList, marketCsv, opportunityStats, type OppFilter, type MarketFilter } from './query.ts';
import { resolveSafeUrl, safeJoin } from './links.ts';
import { sanitizeSettings } from './settings.ts';
import { ymd } from './time.ts';
import { selfTest } from './selftest.ts';
import { Updater } from './updater.ts';

const APP_ORIGIN = 'app://local/';
const UI_DIR = path.join(__dirname, '..', 'dist', 'monitor-licitacoes', 'browser');
const ICON = path.join(__dirname, '..', 'build', 'icon.png');
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

const isSelfTest = process.argv.includes('--selftest');
const startHidden = process.argv.includes('--hidden');
const argOf = (name: string) => process.argv.find((a) => a.startsWith(name + '='))?.slice(name.length + 1);
// Opções de verificação/diagnóstico: pasta de dados isolada e captura de tela da janela.
if (argOf('--data-dir')) app.setPath('userData', argOf('--data-dir')!);
if (isSelfTest) app.setPath('userData', path.join(app.getPath('temp'), `monitor-selftest-${process.pid}`));

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let svc: Services;
let quitting = false;
let updater: Updater;
let lastCycleAt = 0;

const gotLock = isSelfTest || app.requestSingleInstanceLock();
if (!gotLock) app.quit();

/**
 * Visualizador de PDF em janela própria (leitor nativo do Chromium).
 * Só abre arquivos locais já validados como PDF; navegação bloqueada; links externos passam pela validação de URL.
 */
function openPdfViewer(file: string, title: string): BrowserWindow {
  const v = new BrowserWindow({
    width: 1120, height: 900, title, icon: fs.existsSync(ICON) ? ICON : undefined, backgroundColor: '#3c3c3c', autoHideMenuBar: true,
    webPreferences: { plugins: true, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false },
  });
  v.removeMenu();
  const target = pathToFileURL(file).toString();
  v.webContents.setWindowOpenHandler(({ url }) => {
    void resolveSafeUrl(url, (u, i) => net.fetch(u as string, i as any)).then((safe) => { if (safe) void shell.openExternal(safe); });
    return { action: 'deny' };
  });
  v.webContents.on('will-navigate', (e, url) => { if (url !== target) e.preventDefault(); });
  v.on('page-title-updated', (e) => { e.preventDefault(); v.setTitle(title); });
  void v.loadURL(target);
  return v;
}

function showWindow(route?: string): void {
  if (!win) createWindow();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  if (route) win.webContents.send('navigate', route);
}

app.on('second-instance', () => showWindow());

function createWindow(): void {
  win = new BrowserWindow({
    width: 1360, height: 860, minWidth: 980, minHeight: 600, show: false,
    title: 'Monitor de Licitações Legislativas',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    backgroundColor: '#f6f7f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true,
      allowRunningInsecureContent: false, spellcheck: false,
    },
  });
  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(APP_ORIGIN)) e.preventDefault(); });
  win.webContents.on('will-attach-webview', (e) => e.preventDefault());
  win.once('ready-to-show', () => { if (!startHidden || !svc.settings.get().fecharParaBandeja) win?.show(); });
  win.on('close', (e) => {
    if (!quitting && svc.settings.get().fecharParaBandeja) { e.preventDefault(); win?.hide(); }
  });
  win.on('closed', () => { win = null; });
  void win.loadURL(`${APP_ORIGIN}index.html`);
  const shot = argOf('--screenshot');
  if (shot) {
    win.webContents.on('console-message', (e: any) => console.log('[renderer]', e.level ?? '', e.message ?? ''));
    const routes = (argOf('--routes') ?? '/oportunidades').split(',');
    const wait = Number(argOf('--wait') ?? '8000');
    const size = argOf('--size')?.split('x').map(Number);
    if (size?.length === 2 && size.every((n) => n > 0)) win.setContentSize(size[0], size[1]);
    const theme = argOf('--theme');
    win.webContents.once('did-finish-load', () => {
      if (theme === 'dark' || theme === 'light') void win?.webContents.executeJavaScript(`localStorage.setItem('tema','${theme}');document.documentElement.setAttribute('data-theme','${theme}')`);
      setTimeout(async () => {
        for (const [i, r] of routes.entries()) {
          win?.webContents.send('navigate', r);
          await new Promise((res) => setTimeout(res, 4000));
          win?.webContents.invalidate();
          await win!.webContents.capturePage(); // descarta o quadro antigo
          await new Promise((res) => setTimeout(res, 800));
          const img = await win!.webContents.capturePage();
          fs.writeFileSync(shot.replace('.png', `-${i}.png`), img.toPNG());
        }
        quitting = true;
        app.quit();
      }, wait);
    });
  }
}

function createTray(): void {
  const img = fs.existsSync(ICON) ? nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 }) : nativeImage.createEmpty();
  tray = new Tray(img);
  tray.setToolTip('Monitor de Licitações Legislativas');
  const menu = Menu.buildFromTemplate([
    { label: 'Abrir painel', click: () => showWindow() },
    { label: 'Sincronizar agora', click: () => void runSync('manual') },
    { type: 'separator' },
    { label: 'Encerrar', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showWindow());
}

function send(channel: string, payload?: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

let lastRunEndedAt = 0;

async function runSync(trigger: string, continuation = false): Promise<void> {
  if (svc.engine.running) return;
  if (!continuation) { lastCycleAt = Date.now(); svc.settings.setRaw('last_cycle_at', new Date().toISOString()); }
  try { await svc.engine.runCycle(trigger, { continuation }); } finally { lastRunEndedAt = Date.now(); }
  fireDueNotifications();
  send('alerts:changed');
}

function fireDueNotifications(): void {
  const s = svc.settings.get();
  const due = svc.store.dueNotifications();
  for (const n of due) {
    if (s.notificacoes && Notification.isSupported()) {
      try {
        const note = new Notification({ title: String(n.title), body: String(n.body), silent: false });
        note.on('click', () => showWindow(n.procurement_id ? `/oportunidade/${n.procurement_id}` : '/alertas'));
        note.show();
      } catch (e) { svc.engine.log('warn', `Notificação do Windows indisponível: ${(e as Error).message}`); }
    }
    svc.store.markFired(n.id); // a central de alertas mantém o registro mesmo se o Windows bloquear o aviso
  }
  if (due.length) send('alerts:changed');
}

function tick(): void {
  try {
    if (svc.store.refreshStates()) send('alerts:changed');
    if (new Date().getMinutes() % 15 === 0) svc.store.refreshMarketStates();
    fireDueNotifications();
    const interval = svc.settings.get().intervaloHoras * 3_600_000;
    if (svc.engine.running || !net.isOnline()) return;
    if (Date.now() - lastCycleAt >= interval) void runSync('agendada');
    // retomada de janelas pendentes (erro transitório, orçamento de tempo) sem reabrir a sobreposição
    else if (svc.engine.hasDueWork() && Date.now() - lastRunEndedAt > 90_000) void runSync('continuação', true);
  } catch (e) { svc.engine.log('error', `Falha no agendador: ${(e as Error).message}`); }
}

// ---------- IPC (validação de remetente e de payload) ----------
const FROM_APP = (e: IpcMainInvokeEvent) => !!e.senderFrame && e.senderFrame.url.startsWith(APP_ORIGIN) && e.sender === win?.webContents;
const isId = (x: unknown): x is number => Number.isInteger(x) && (x as number) > 0;
const str = (x: unknown, max = 500): string => { if (typeof x !== 'string' || x.length > max) throw new Error('Parâmetro inválido'); return x; };
const LABELS = ['alta', 'revisar', 'fora', 'pendente'];
const STATES = ['Abertura futura', 'Recebendo propostas', 'Prazo encerrado', 'Sem prazo confirmado', 'Suspensa', 'Revogada', 'Anulada'];

export function sanitizeFilter(x: any): OppFilter {
  const f: OppFilter = {};
  if (!x || typeof x !== 'object') return f;
  if (typeof x.text === 'string') f.text = x.text.slice(0, 200);
  if (Array.isArray(x.uf)) f.uf = x.uf.filter((u: unknown) => typeof u === 'string' && /^[A-Z]{2}$/.test(u)).slice(0, 27);
  if (Array.isArray(x.modalidade)) f.modalidade = x.modalidade.filter((m: unknown) => Number.isInteger(m)).slice(0, 20);
  if (Array.isArray(x.relevancia)) f.relevancia = x.relevancia.filter((r: unknown) => LABELS.includes(r as string));
  if (Array.isArray(x.estado)) f.estado = x.estado.filter((r: unknown) => STATES.includes(r as string));
  if (typeof x.fonte === 'string' && /^[a-z0-9_-]{1,30}$/.test(x.fonte)) f.fonte = x.fonte;
  if (Number.isInteger(x.prazoDias) && x.prazoDias > 0 && x.prazoDias <= 365) f.prazoDias = x.prazoDias;
  if (['todas', 'acompanhadas', 'favoritas', 'triagem', 'analise', 'descartada'].includes(x.watch)) f.watch = x.watch;
  if (['prazo', 'publicacao', 'relevancia', 'orgao', 'valor'].includes(x.sort)) f.sort = x.sort;
  if (x.dir === 'asc' || x.dir === 'desc') f.dir = x.dir;
  if (Number.isInteger(x.page) && x.page > 0 && x.page < 100000) f.page = x.page;
  if (Number.isInteger(x.pageSize)) f.pageSize = x.pageSize;
  return f;
}

function handle(channel: string, fn: (arg: any) => unknown | Promise<unknown>): void {
  ipcMain.handle(channel, async (e, arg) => {
    if (!FROM_APP(e)) throw new Error('Remetente não autorizado');
    return fn(arg);
  });
}

function registerIpc(): void {
  const { store, engine, settings, db } = svc;
  handle('opps:list', (a) => listOpportunities(store, sanitizeFilter(a)));
  handle('opps:stats', () => opportunityStats(store));
  handle('opps:get', (id) => { if (!isId(id)) throw new Error('id inválido'); return getOpportunity(store, id); });
  handle('opps:excerpts', (a) => searchDocumentExcerpts(store, a.id, str(a.q, 100)));

  // ---------- editais: listar, visualizar e baixar ----------
  handle('docs:refresh', async (id) => {
    if (!isId(id)) throw new Error('id inválido');
    const p = db.get<Row>('SELECT cnpj, ano, sequencial FROM procurements WHERE id=?', id);
    if (!p) throw new Error('Oportunidade não encontrada');
    const docs = await svc.connector.fetchDocuments({ cnpj: p.cnpj, ano: p.ano, sequencial: p.sequencial });
    store.saveDocuments(id, docs);
    return docs.length;
  });
  handle('docs:view', async (docId) => {
    if (!isId(docId)) throw new Error('id inválido');
    const f = await svc.docs.ensureLocal(docId);
    if (f.kind !== 'pdf') return { ok: false, reason: `Este arquivo é ${f.ext.toUpperCase()}, não PDF. Use “Baixar”.` };
    openPdfViewer(f.path, f.fileName);
    return { ok: true };
  });
  handle('docs:save', async (docId) => {
    if (!isId(docId)) throw new Error('id inválido');
    const f = await svc.docs.ensureLocal(docId);
    const r = await dialog.showSaveDialog(win!, { defaultPath: path.join(app.getPath('downloads'), f.fileName), filters: [{ name: f.ext.toUpperCase(), extensions: [f.ext] }] });
    if (r.canceled || !r.filePath) return { ok: false };
    fs.copyFileSync(f.path, r.filePath);
    return { ok: true, path: r.filePath };
  });
  handle('docs:saveAll', async (id) => {
    if (!isId(id)) throw new Error('id inválido');
    const p = db.get<Row>('SELECT control_id, orgao_nome, uf FROM procurements WHERE id=?', id);
    const docs = db.all<Row>('SELECT id FROM documents WHERE procurement_id=? AND ativo=1 ORDER BY sequencial', id);
    if (!p || !docs.length) return { ok: false, reason: 'Nenhum documento listado para esta oportunidade.' };
    const r = await dialog.showOpenDialog(win!, { title: 'Escolha a pasta para salvar os editais', defaultPath: app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false };
    const folderName = `${p.orgao_nome ?? 'Orgao'} (${p.uf ?? ''}) - ${String(p.control_id).replace(/\//g, '-')}`.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150);
    const dest = path.join(r.filePaths[0], folderName);
    fs.mkdirSync(dest, { recursive: true });
    let saved = 0; const failed: string[] = [];
    for (const d of docs) {
      try {
        const f = await svc.docs.ensureLocal(d.id);
        let target = path.join(dest, f.fileName);
        for (let i = 2; fs.existsSync(target); i++) target = path.join(dest, f.fileName.replace(/(\.[^.]+)$/, ` (${i})$1`));
        fs.copyFileSync(f.path, target); saved++;
      } catch (e) { failed.push((e as Error).message.slice(0, 120)); }
    }
    void shell.openPath(dest);
    return { ok: saved > 0, path: dest, saved, failed };
  });
  handle('opps:label', (a) => {
    if (!isId(a?.id) || !(a.label === null || LABELS.includes(a.label))) throw new Error('Parâmetros inválidos');
    store.setManualLabel(a.id, a.label);
    return true;
  });
  handle('opps:export', async (a) => {
    const csv = exportCsv(store, sanitizeFilter(a));
    const r = await dialog.showSaveDialog(win!, { defaultPath: `oportunidades-${ymd(new Date())}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return { ok: false };
    fs.writeFileSync(r.filePath, csv, 'utf8');
    return { ok: true, path: r.filePath };
  });
  handle('watch:set', (a) => {
    if (!isId(a?.id)) throw new Error('id inválido');
    if (a.patch === null) store.setWatch(a.id, null);
    else {
      const p = a.patch ?? {};
      const cl: Record<string, boolean> = {};
      if (p.checklist && typeof p.checklist === 'object') for (const [k, v] of Object.entries(p.checklist)) cl[String(k).slice(0, 80)] = !!v;
      store.setWatch(a.id, {
        status: p.status === undefined ? undefined : str(p.status, 20),
        favorito: p.favorito === undefined ? undefined : !!p.favorito,
        notes: p.notes === undefined ? undefined : str(p.notes, 20000),
        checklist: p.checklist === undefined ? undefined : cl,
      });
    }
    send('alerts:changed');
    return true;
  });
  handle('filters:list', () => db.all('SELECT id, name, filter FROM saved_filters ORDER BY name').map((r) => ({ ...r, filter: JSON.parse(r.filter as string) })));
  handle('filters:save', (a) => {
    const name = str(a?.name, 60).trim();
    if (!name) throw new Error('Nome obrigatório');
    db.run('INSERT INTO saved_filters (name, filter, created_at) VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET filter=excluded.filter', name, JSON.stringify(sanitizeFilter(a.filter)), new Date().toISOString());
    return true;
  });
  handle('filters:delete', (id) => { if (!isId(id)) throw new Error('id inválido'); db.run('DELETE FROM saved_filters WHERE id=?', id); return true; });

  handle('sync:status', () => ({
    progress: engine.getProgress(),
    lastCycleAt: settings.getRaw('last_cycle_at') ?? null,
    nextRunAt: new Date(Math.max(Date.now(), lastCycleAt + settings.get().intervaloHoras * 3_600_000)).toISOString(),
    online: net.isOnline(),
  }));
  handle('sync:run', () => { void runSync('manual'); return true; });
  handle('sync:cancel', () => { engine.cancel(); return true; });
  handle('sync:historical', (a) => {
    const days = Number.isInteger(a?.days) ? Math.min(1095, Math.max(1, a.days)) : settings.get().historicoDias;
    const n = engine.planHistorical(days);
    engine.setHistoricalPaused(false);
    void runSync('historico');
    return n;
  });
  handle('sync:pauseHistorical', (paused) => { engine.setHistoricalPaused(!!paused); return true; });
  handle('sync:resetFailed', () => engine.resetFailedJobs());
  handle('sync:reclassify', () => { const n = store.reclassifyAll(); store.purgeOutOfProfile(); return n; });
  handle('sources:overview', () => sourcesOverview(store, svc.connector));
  handle('sources:runs', () => listRuns(store));
  handle('sources:logs', (level) => listLogs(store, level === 'warn' || level === 'error' || level === 'info' ? level : null));
  handle('sources:jobs', () => listJobs(store));

  handle('settings:get', () => settings.get());
  handle('settings:set', (patch) => {
    if (!patch || typeof patch !== 'object') throw new Error('Parâmetros inválidos');
    const next = settings.set(sanitizeSettings(patch));
    svc.http.configure({ maxConcurrent: next.concorrencia, maxPerMinute: next.maxRequisicoesPorMinuto });
    app.setLoginItemSettings({ openAtLogin: next.iniciarComWindows, args: ['--hidden'] });
    store.resyncAllReminders();
    store.purgeOutOfProfile();
    send('alerts:changed');
    return next;
  });
  handle('rules:get', () => store.getRules());
  handle('rules:set', (rs) => { const v = store.setRules(rs); store.reclassifyAll(); store.purgeOutOfProfile(); return v; });
  handle('rules:reset', () => { const v = store.resetRules(); store.reclassifyAll(); store.purgeOutOfProfile(); return v; });

  handle('alerts:list', () => listAlerts(store));
  handle('alerts:read', (id) => {
    if (id === 'all') db.run("UPDATE notifications SET status='lida', read_at=? WHERE status='disparada'", new Date().toISOString());
    else if (isId(id)) db.run("UPDATE notifications SET status='lida', read_at=? WHERE id=? AND status IN ('disparada','agendada')", new Date().toISOString(), id);
    return true;
  });
  handle('alerts:test', () => {
    const ok = Notification.isSupported();
    if (ok) {
      const n = new Notification({ title: 'Monitor de Licitações Legislativas', body: 'Teste de notificação: clique para abrir o painel.' });
      n.on('click', () => showWindow('/alertas'));
      n.show();
    }
    return { supported: ok };
  });

  // Links: o renderer envia apenas o tipo e o id; a URL vem do banco e é validada.
  handle('shell:open', async (a) => {
    let url: string | null = null;
    if (a?.kind === 'market') {
      if (typeof a.controlId !== 'string' || a.controlId.length > 60) throw new Error('Parâmetros inválidos');
      url = db.get<{ u: string }>('SELECT link_pncp AS u FROM market_items WHERE control_id=?', a.controlId)?.u ?? null;
      const safe = await resolveSafeUrl(url, (u, i) => net.fetch(u as string, i as any));
      if (!safe) return { ok: false, reason: 'Link inválido ou não permitido.' };
      await shell.openExternal(safe);
      return { ok: true };
    }
    if (!isId(a?.id)) throw new Error('id inválido');
    if (a.kind === 'doc') url = db.get<{ url: string }>('SELECT url FROM documents WHERE id=?', a.id)?.url ?? null;
    else {
      const col = a.kind === 'pncp' ? 'link_pncp' : a.kind === 'origem' ? 'link_origem' : a.kind === 'processo' ? 'link_processo' : null;
      if (!col) throw new Error('Tipo de link inválido');
      url = db.get<Record<string, string>>(`SELECT ${col} AS u FROM procurements WHERE id=?`, a.id)?.u ?? null;
    }
    const safe = await resolveSafeUrl(url, (u, i) => net.fetch(u as string, i as any));
    if (!safe) return { ok: false, reason: 'Link inválido ou não permitido.' };
    await shell.openExternal(safe);
    return { ok: true };
  });
  const marketFilter = (x: any): MarketFilter => {
    const f: MarketFilter = {};
    if (!x || typeof x !== 'object') return f;
    if (Number.isInteger(x.dias) && x.dias >= 0 && x.dias <= 3650) f.dias = x.dias;
    if (Array.isArray(x.uf)) f.uf = x.uf.filter((u: unknown) => typeof u === 'string' && /^[A-Z]{2}$/.test(u)).slice(0, 27);
    if (Array.isArray(x.esfera)) f.esfera = x.esfera.filter((e: unknown) => typeof e === 'string' && /^[MEFDN]$/.test(e));
    if (typeof x.categoria === 'string' && /^[a-z-]{1,30}$/.test(x.categoria)) f.categoria = x.categoria;
    if (typeof x.abertas === 'boolean') f.abertas = x.abertas;
    if (typeof x.text === 'string') f.text = x.text.slice(0, 120);
    if (['valor', 'publicacao', 'prazo'].includes(x.sort)) f.sort = x.sort;
    if (Number.isInteger(x.page) && x.page > 0) f.page = x.page;
    if (Number.isInteger(x.pageSize)) f.pageSize = x.pageSize;
    return f;
  };
  handle('market:overview', (a) => marketOverview(store, marketFilter(a)));
  handle('market:list', (a) => marketList(store, marketFilter(a)));
  handle('market:export', async (a) => {
    const csv = marketCsv(store, marketFilter(a));
    const r = await dialog.showSaveDialog(win!, { defaultPath: `mercado-software-${ymd(new Date())}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (r.canceled || !r.filePath) return { ok: false };
    fs.writeFileSync(r.filePath, csv, 'utf8');
    return { ok: true, path: r.filePath };
  });
  handle('market:backfill', (a) => {
    const days = Number.isInteger(a?.days) ? Math.min(365, Math.max(1, a.days)) : 30;
    const n = engine.planHistorical(days);
    engine.setHistoricalPaused(false);
    void runSync('historico');
    return n;
  });
  handle('update:state', () => updater.get());
  handle('update:check', () => updater.check());
  handle('update:install', () => updater.updateNow());
  handle('app:info', () => ({
    version: app.getVersion(), dataDir: app.getPath('userData'), platform: process.platform, electron: process.versions.electron,
    sqlite: db.selfCheck(), recovered: svc.recovered, loginItem: app.getLoginItemSettings().openAtLogin,
  }));
}

function registerAppProtocol(): void {
  protocol.handle('app', async (req) => {
    const url = new URL(req.url);
    let rel = url.pathname === '/' ? '/index.html' : url.pathname;
    const full = safeJoin(UI_DIR, rel, path.join, path.sep);
    if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) return new Response('Não encontrado', { status: 404 });
    const res = await net.fetch(`file:///${full.replace(/\\/g, '/')}`);
    const headers = new Headers(res.headers);
    headers.set('Content-Security-Policy', CSP);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(res.body, { status: res.status, headers });
  });
}

if (gotLock) {
  app.whenReady().then(async () => {
    const testPdf = argOf('--test-pdf-viewer');
    if (testPdf) {
      const v = openPdfViewer(testPdf, 'Teste do visualizador');
      v.webContents.once('did-finish-load', () => setTimeout(async () => {
        const img = await v.webContents.capturePage();
        fs.writeFileSync(testPdf + '.png', img.toPNG());
        app.exit(0);
      }, 3500));
      return;
    }
    if (isSelfTest) {
      const code = await selfTest(app.getPath('userData'), process.argv.find((a) => a.startsWith('--selftest-out='))?.split('=')[1]);
      app.exit(code);
      return;
    }
    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    registerAppProtocol();
    svc = createServices(app.getPath('userData'), (p) => send('sync:progress', p));
    svc.engine.setHistoricalPaused(!!svc.settings.getRaw('historical_paused'));
    updater = new Updater(
      (s) => { send('update:state', s); if (s.status === 'pronto') tray?.setToolTip(`Monitor de Licitações — versão ${s.version} pronta para instalar`); },
      (level, msg) => svc.engine.log(level, msg, { source: 'atualizacao' }),
      () => { quitting = true; try { svc.engine.cancel(); } catch { /* ignora */ } },
    );
    registerIpc();
    updater.start();
    app.setLoginItemSettings({ openAtLogin: svc.settings.get().iniciarComWindows, args: ['--hidden'] });
    createTray();
    createWindow();
    const last = svc.settings.getRaw('last_cycle_at') as string | undefined;
    lastCycleAt = last ? Date.parse(last) : 0;
    setInterval(tick, 60_000);
    setTimeout(tick, 5_000); // recupera atraso na abertura
    powerMonitor.on('resume', () => { lastCycleAt = 0; setTimeout(tick, 15_000); }); // após suspensão
    app.on('activate', () => showWindow());
  });
  app.on('before-quit', () => { quitting = true; try { svc?.engine.cancel(); } catch { /* ignora */ } });
  // com a opção "fechar para a bandeja" o processo continua vivo sem janelas
  app.on('window-all-closed', () => { if (quitting) app.quit(); });
}
