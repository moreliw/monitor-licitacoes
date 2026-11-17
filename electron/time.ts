/** Utilitários de data/hora. O PNCP documenta Brasília (UTC-3, sem horário de verão desde 2019) para datas sem offset. */
export const SOURCE_TZ = 'America/Sao_Paulo';
export const BRASILIA_OFFSET = '-03:00';

export interface ParsedInstant {
  raw: string;
  utc: string;
  origin: 'offset-explicito' | 'pncp-brasilia';
}

const RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/;

function offsetMinutes(offset: string): number {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!m) return 0;
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/** Retorna null para valor ausente ou inválido (nunca assume meia-noite para data inexistente). */
export function parseInstant(value: unknown, defaultOffset = BRASILIA_OFFSET): ParsedInstant | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const s = value.trim();
  const m = RE.exec(s);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss, off] = m;
  if (hh === undefined) return null; // somente data: horário desconhecido
  const month = Number(mo), day = Number(d), hour = Number(hh), min = Number(mi), sec = Number(ss ?? '0');
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || min > 59 || sec > 59) return null;
  let offset = off ?? defaultOffset;
  if (offset === 'Z') offset = '+00:00';
  if (/^[+-]\d{4}$/.test(offset)) offset = offset.slice(0, 3) + ':' + offset.slice(3);
  const iso = `${y}-${mo}-${d}T${hh}:${mi}:${String(sec).padStart(2, '0')}${offset}`;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  // rejeita datas que "rolam" (ex.: 31 de fevereiro)
  const probe = new Date(t + offsetMinutes(offset) * 60_000);
  if (probe.getUTCDate() !== day || probe.getUTCMonth() + 1 !== month) return null;
  return { raw: s, utc: new Date(t).toISOString(), origin: off ? 'offset-explicito' : 'pncp-brasilia' };
}

/** YYYYMMDD do calendário de Brasília. */
export function ymd(d: Date): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: SOURCE_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  return p.replace(/-/g, '');
}

export function addDaysYmd(day: string, n: number): string {
  const d = new Date(Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8)) + n));
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
}

export function daysBetween(a: string, b: string): number {
  const f = (s: string) => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));
  return Math.round((f(b) - f(a)) / 86_400_000);
}

export function* eachDay(from: string, to: string): Generator<string> {
  for (let d = from; d <= to; d = addDaysYmd(d, 1)) yield d;
}

export function fmtBrasilia(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: SOURCE_TZ, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}
