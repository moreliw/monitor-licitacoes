import { Injectable, NgZone, signal } from '@angular/core';
import { Router } from '@angular/router';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Row = Record<string, any>;

declare global {
  interface Window {
    api?: any;
  }
}

export const LABEL_TEXT: Record<string, string> = {
  alta: 'Alta relevância', revisar: 'Revisar', fora: 'Fora do perfil', pendente: 'Evidência pendente',
};
export const WATCH_TEXT: Record<string, string> = { triagem: 'Triagem', analise: 'Em análise', descartada: 'Descartada' };
/** Aderência ao Ágil (catálogo em electron/agil.ts). */
export const AGIL_TEXT: Record<string, string> = {
  nucleo: 'Ágil: processo legislativo', plenario: 'Ágil: plenário', compilacao: 'Ágil: compilação',
  complemento: 'Ágil: complemento', condicionada: 'Ágil: condicionada', fora: 'Fora do Ágil',
};
export const AGIL_CHIP: Record<string, string> = {
  nucleo: 'Processo legislativo', plenario: 'Plenário', compilacao: 'Compilação', complemento: 'Complemento', condicionada: 'Condicionada', fora: 'Fora do Ágil',
};
export const SITUACAO_TEXT: Record<string, string> = { pronto: 'Entregue', parcial: 'Em andamento', falta: 'A desenvolver', fora: 'Fora do produto' };
export function agilTone(a: string | null | undefined): string {
  return a === 'nucleo' || a === 'plenario' || a === 'compilacao' ? 'b-ok' : a === 'complemento' ? 'b-info' : a === 'condicionada' ? 'b-warn' : 'b-neutral';
}
export const STATES = ['Abertura futura', 'Recebendo propostas', 'Prazo encerrado', 'Sem prazo confirmado', 'Suspensa', 'Revogada', 'Anulada'];
export const UFS = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SP', 'SE', 'TO'];
export const MODALIDADES: Record<number, string> = { 4: 'Concorrência eletrônica', 5: 'Concorrência presencial', 6: 'Pregão eletrônico', 7: 'Pregão presencial', 8: 'Dispensa', 9: 'Inexigibilidade' };

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}
export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short' }).format(new Date(iso));
}
export function fmtMoney(cents: number | null | undefined, sigiloso?: number | null): string {
  if (sigiloso === 1) return 'Sigiloso';
  if (cents === null || cents === undefined) return 'Não publicado';
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.parse(iso) - Date.now();
  const abs = Math.abs(ms);
  const h = Math.floor(abs / 3_600_000);
  const d = Math.floor(h / 24);
  const txt = d >= 1 ? `${d} d ${h % 24} h` : h >= 1 ? `${h} h ${Math.floor((abs % 3_600_000) / 60_000)} min` : `${Math.floor(abs / 60_000)} min`;
  return ms >= 0 ? `em ${txt}` : `há ${txt}`;
}

function readTheme(): 'auto' | 'light' | 'dark' {
  try { const t = localStorage.getItem('tema'); return t === 'light' || t === 'dark' ? t : 'auto'; } catch { return 'auto'; }
}
function applyTheme(t: 'auto' | 'light' | 'dark'): void {
  if (typeof document === 'undefined') return;
  if (t === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

export function fmtCompactMoney(cents: number | null | undefined): string {
  if (!cents) return 'R$ 0';
  const v = cents / 100;
  if (v >= 1e9) return `R$ ${(v / 1e9).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} bi`;
  if (v >= 1e6) return `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (v >= 1e3) return `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
export function fmtInt(n: number | null | undefined): string { return (n ?? 0).toLocaleString('pt-BR'); }

/** Urgência do prazo: usada para cor + texto (nunca só cor). */
export function deadlineTone(iso: string | null | undefined, state: string): 'bad' | 'warn' | 'ok' | 'neutral' {
  if (!iso || state !== 'Recebendo propostas') return 'neutral';
  const h = (Date.parse(iso) - Date.now()) / 3_600_000;
  return h < 0 ? 'neutral' : h <= 72 ? 'bad' : h <= 168 ? 'warn' : 'ok';
}
export function stateTone(s: string): string {
  return s === 'Recebendo propostas' ? 'b-ok' : s === 'Abertura futura' ? 'b-info' : ['Suspensa', 'Revogada', 'Anulada'].includes(s) ? 'b-bad' : s === 'Sem prazo confirmado' ? 'b-warn' : 'b-neutral';
}

@Injectable({ providedIn: 'root' })
export class Api {
  readonly available = typeof window !== 'undefined' && !!window.api;
  readonly progress = signal<Row | null>(null);
  readonly alertsVersion = signal(0);
  readonly online = signal(typeof navigator === 'undefined' ? true : navigator.onLine);
  readonly status = signal<Row | null>(null);
  readonly stats = signal<Row | null>(null);
  readonly update = signal<Row | null>(null);
  readonly theme = signal<'auto' | 'light' | 'dark'>(readTheme());

  constructor(private zone: NgZone, private router: Router) {
    applyTheme(this.theme());
    if (!this.available) return;
    window.api.on('sync:progress', (p: Row) => this.zone.run(() => { this.progress.set(p); if (!p['running']) { void this.refreshStatus(); void this.refreshStats(); } }));
    window.api.on('alerts:changed', () => this.zone.run(() => { this.alertsVersion.update((v) => v + 1); void this.refreshStats(); }));
    window.api.on('navigate', (route: string) => this.zone.run(() => void this.router.navigateByUrl(route)));
    window.api.on('update:state', (s: Row) => this.zone.run(() => this.update.set(s)));
    window.addEventListener('online', () => this.online.set(true));
    window.addEventListener('offline', () => this.online.set(false));
    void this.refreshStatus();
    void this.refreshStats();
    void window.api.update.state().then((s: Row) => this.update.set(s));
  }

  async refreshStatus(): Promise<void> {
    if (!this.available) return;
    this.status.set(await window.api.sync.status());
    const ov = await window.api.sources.overview();
    this.status.update((s) => ({ ...s, overview: ov }));
  }

  async refreshStats(): Promise<void> {
    if (this.available) this.stats.set(await window.api.opps.stats());
  }

  setTheme(t: 'auto' | 'light' | 'dark'): void {
    this.theme.set(t);
    try { localStorage.setItem('tema', t); } catch { /* preferência só desta máquina */ }
    applyTheme(t);
  }

  get raw(): any { return window.api; }
}
