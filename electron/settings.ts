import type { Db } from './db.ts';

export interface Settings {
  intervaloHoras: number;
  horizonteDias: number;
  diasIniciais: number;
  historicoDias: number;
  modalidades: number[];
  incluirInexigibilidade: boolean;
  concorrencia: number;
  tamanhoPagina: number;
  sobreposicaoDias: number;
  orcamentoMinutos: number;
  maxPaginasJanela: number;
  maxRequisicoesPorMinuto: number;
  ufColeta: string[];
  lembretesHoras: number[];
  notificacoes: boolean;
  iniciarComWindows: boolean;
  fecharParaBandeja: boolean;
  cnpjsLegislativos: string[];
  maxDocBytes: number;
  maxDocPaginas: number;
  docTimeoutMs: number;
  maxDocsPorExecucao: number;
  retencaoLogDias: number;
  retencaoAnexosDias: number;
  baseDesatualizadaHoras: number;
  /** Por padrão só contratações do nicho (processo legislativo) são guardadas; o restante é analisado e descartado. */
  guardarForaDoPerfil: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  intervaloHoras: 4,
  horizonteDias: 30,
  diasIniciais: 7,
  historicoDias: 90,
  modalidades: [6, 7, 8, 4, 5],
  incluirInexigibilidade: false,
  concorrencia: 2,
  tamanhoPagina: 50,
  sobreposicaoDias: 2,
  orcamentoMinutos: 10,
  maxPaginasJanela: 200,
  maxRequisicoesPorMinuto: 120,
  ufColeta: [],
  lembretesHoras: [72, 24, 3],
  notificacoes: true,
  iniciarComWindows: false,
  fecharParaBandeja: true,
  cnpjsLegislativos: [],
  maxDocBytes: 25 * 1024 * 1024,
  maxDocPaginas: 200,
  docTimeoutMs: 60_000,
  maxDocsPorExecucao: 20,
  retencaoLogDias: 30,
  retencaoAnexosDias: 90,
  baseDesatualizadaHoras: 24,
  guardarForaDoPerfil: false,
};

const LIMITS: Partial<Record<keyof Settings, [number, number]>> = {
  intervaloHoras: [0.25, 168], horizonteDias: [1, 365], diasIniciais: [1, 60], historicoDias: [1, 1095],
  concorrencia: [1, 4], tamanhoPagina: [10, 50], sobreposicaoDias: [0, 10], orcamentoMinutos: [1, 240],
  maxPaginasJanela: [10, 5000], maxRequisicoesPorMinuto: [10, 600], maxDocBytes: [102400, 200 * 1024 * 1024],
  maxDocPaginas: [1, 2000], docTimeoutMs: [5000, 600_000], maxDocsPorExecucao: [0, 500],
  retencaoLogDias: [1, 365], retencaoAnexosDias: [1, 3650], baseDesatualizadaHoras: [1, 720],
};

export function sanitizeSettings(input: Partial<Settings>, base: Settings = DEFAULT_SETTINGS): Settings {
  const out: Settings = { ...base };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (!(key in input)) continue;
    const v = (input as any)[key];
    const def = DEFAULT_SETTINGS[key];
    if (typeof def === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      const [lo, hi] = LIMITS[key] ?? [-Infinity, Infinity];
      (out as any)[key] = Math.min(hi, Math.max(lo, n));
    } else if (typeof def === 'boolean') {
      (out as any)[key] = Boolean(v);
    } else if (Array.isArray(def)) {
      if (!Array.isArray(v)) continue;
      if (key === 'ufColeta') {
        (out as any)[key] = v.map((x) => String(x).toUpperCase()).filter((x) => /^[A-Z]{2}$/.test(x));
      } else if (key === 'cnpjsLegislativos') {
        (out as any)[key] = v
          .map((x) => String(x).toUpperCase().replace(/[./\-\s]/g, ''))
          .filter((x) => /^[0-9A-Z]{12}[0-9]{2}$/.test(x));
      } else {
        (out as any)[key] = v.map(Number).filter((x) => Number.isFinite(x) && x > 0);
      }
    }
  }
  return out;
}

export class SettingsStore {
  constructor(private db: Db) {}
  getRaw(key: string): any | undefined {
    const r = this.db.get<{ value: string }>('SELECT value FROM settings WHERE key=?', key);
    return r ? JSON.parse(r.value) : undefined;
  }
  setRaw(key: string, value: unknown): void {
    this.db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value));
  }
  get(): Settings {
    return sanitizeSettings(this.getRaw('app') ?? {});
  }
  set(patch: Partial<Settings>): Settings {
    const next = sanitizeSettings(patch, this.get());
    this.setRaw('app', next);
    return next;
  }
}
