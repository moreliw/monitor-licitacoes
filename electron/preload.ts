import { contextBridge, ipcRenderer } from 'electron';

const call = (channel: string) => (arg?: unknown) => ipcRenderer.invoke(channel, arg);
const EVENTS = ['sync:progress', 'alerts:changed', 'navigate', 'update:state'] as const;

/** API mínima e tipada exposta ao renderer: só métodos específicos, nunca o ipcRenderer. */
const api = {
  opps: { stats: call('opps:stats'), list: call('opps:list'), get: call('opps:get'), excerpts: call('opps:excerpts'), label: call('opps:label'), export: call('opps:export') },
  watch: { set: call('watch:set') },
  filters: { list: call('filters:list'), save: call('filters:save'), delete: call('filters:delete') },
  sync: {
    status: call('sync:status'), run: call('sync:run'), cancel: call('sync:cancel'), historical: call('sync:historical'),
    pauseHistorical: call('sync:pauseHistorical'), resetFailed: call('sync:resetFailed'), reclassify: call('sync:reclassify'),
  },
  sources: { overview: call('sources:overview'), runs: call('sources:runs'), logs: call('sources:logs'), jobs: call('sources:jobs') },
  settings: { get: call('settings:get'), set: call('settings:set') },
  rules: { get: call('rules:get'), set: call('rules:set'), reset: call('rules:reset') },
  alerts: { list: call('alerts:list'), read: call('alerts:read'), test: call('alerts:test') },
  docs: { refresh: call('docs:refresh'), view: call('docs:view'), save: call('docs:save'), saveAll: call('docs:saveAll') },
  update: { state: call('update:state'), check: call('update:check'), install: call('update:install'), openRelease: call('update:openRelease') },
  market: { overview: call('market:overview'), list: call('market:list'), export: call('market:export'), backfill: call('market:backfill') },
  open: call('shell:open'),
  info: call('app:info'),
  on(event: (typeof EVENTS)[number], cb: (payload: unknown) => void): () => void {
    if (!EVENTS.includes(event)) throw new Error('Evento não permitido');
    const h = (_e: unknown, p: unknown) => cb(p);
    ipcRenderer.on(event, h);
    return () => ipcRenderer.removeListener(event, h);
  },
};

contextBridge.exposeInMainWorld('api', api);
