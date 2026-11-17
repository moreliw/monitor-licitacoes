export class HttpError extends Error {
  constructor(message: string, readonly status: number, readonly url: string, readonly permanent: boolean) {
    super(message);
  }
}
export class NotFoundError extends HttpError {
  constructor(url: string) { super(`HTTP 404 ${url}`, 404, url, true); }
}
export class SchemaError extends Error {
  constructor(message: string, readonly route: string) { super(message); }
}
export class CancelledError extends Error {
  constructor() { super('Operação cancelada'); }
}

export interface HttpOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  random?: () => number;
  now?: () => number;
  maxConcurrent?: number;
  maxPerMinute?: number;
  /** Intervalo mínimo entre inícios de requisição no mesmo host (cortesia com a API pública). */
  minIntervalMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  userAgent?: string;
  onAttempt?: (info: { url: string; attempt: number; status?: number; error?: string; waitMs?: number }) => void;
}

export interface HttpResult<T = unknown> {
  status: number;
  body: T | null; // null em 204
  headers: Headers;
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new CancelledError());
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new CancelledError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

export function parseRetryAfter(v: string | null, nowMs: number): number | null {
  if (!v) return null;
  const secs = Number(v);
  if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : Math.max(0, t - nowMs);
}

/** Cliente HTTP com limite por host, timeout, cancelamento, backoff exponencial com jitter e Retry-After. */
export class HttpClient {
  private active = new Map<string, number>();
  private waiters = new Map<string, (() => void)[]>();
  private stamps = new Map<string, number[]>();
  private penaltyUntil = new Map<string, number>();
  private lastStart = new Map<string, number>();
  private o: Required<Omit<HttpOptions, 'onAttempt'>> & Pick<HttpOptions, 'onAttempt'>;

  constructor(opts: HttpOptions = {}) {
    this.o = {
      fetchImpl: opts.fetchImpl ?? ((...a) => fetch(...a)),
      sleep: opts.sleep ?? defaultSleep,
      random: opts.random ?? Math.random,
      now: opts.now ?? Date.now,
      maxConcurrent: opts.maxConcurrent ?? 2,
      maxPerMinute: opts.maxPerMinute ?? 120,
      minIntervalMs: opts.minIntervalMs ?? 0,
      timeoutMs: opts.timeoutMs ?? 30_000,
      maxRetries: opts.maxRetries ?? 4,
      baseBackoffMs: opts.baseBackoffMs ?? 1000,
      maxBackoffMs: opts.maxBackoffMs ?? 60_000,
      userAgent: opts.userAgent ?? 'MonitorLicitacoesLegislativas/1.0',
      onAttempt: opts.onAttempt,
    };
  }

  configure(p: { maxConcurrent?: number; maxPerMinute?: number; minIntervalMs?: number }): void {
    if (p.minIntervalMs !== undefined) this.o.minIntervalMs = p.minIntervalMs;
    if (p.maxConcurrent) this.o.maxConcurrent = p.maxConcurrent;
    if (p.maxPerMinute) this.o.maxPerMinute = p.maxPerMinute;
  }

  private async acquire(host: string, signal?: AbortSignal): Promise<void> {
    while ((this.active.get(host) ?? 0) >= this.o.maxConcurrent) {
      await new Promise<void>((res, rej) => {
        if (signal?.aborted) return rej(new CancelledError());
        const q = this.waiters.get(host) ?? [];
        q.push(res);
        this.waiters.set(host, q);
      });
      if (signal?.aborted) throw new CancelledError();
    }
    this.active.set(host, (this.active.get(host) ?? 0) + 1);
    try {
      // Penalidade compartilhada: após 429/503 todas as requisições ao host respeitam a espera.
      const pen = (this.penaltyUntil.get(host) ?? 0) - this.o.now();
      if (pen > 0) await this.o.sleep(pen, signal);
      // Espaçamento mínimo entre inícios de requisição.
      if (this.o.minIntervalMs > 0) {
        const t = this.o.now();
        const startAt = Math.max(t, (this.lastStart.get(host) ?? 0) + this.o.minIntervalMs);
        this.lastStart.set(host, startAt);
        if (startAt > t) await this.o.sleep(startAt - t, signal);
      }
    } catch (e) { this.release(host); throw e; }
    // limite de taxa: janela deslizante de 60 s
    for (;;) {
      const now = this.o.now();
      const st = (this.stamps.get(host) ?? []).filter((t) => now - t < 60_000);
      this.stamps.set(host, st);
      if (st.length < this.o.maxPerMinute) { st.push(now); break; }
      try { await this.o.sleep(Math.max(50, 60_000 - (now - st[0])), signal); }
      catch (e) { this.release(host); throw e; }
    }
  }
  private release(host: string): void {
    this.active.set(host, Math.max(0, (this.active.get(host) ?? 1) - 1));
    this.waiters.get(host)?.shift()?.();
  }

  /** Executa GET. Lança HttpError(permanent) em 4xx (exceto 408/429), NotFoundError em 404. */
  async getJson<T = unknown>(url: string, signal?: AbortSignal): Promise<HttpResult<T>> {
    const r = await this.request(url, signal, true);
    return r as HttpResult<T>;
  }
  async getRaw(url: string, signal?: AbortSignal): Promise<Response> {
    return (await this.request(url, signal, false, true)) as unknown as Response;
  }

  private async request(url: string, signal: AbortSignal | undefined, parseJson: boolean, rawResponse = false): Promise<HttpResult | Response> {
    const host = new URL(url).host;
    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.o.maxRetries + 1; attempt++) {
      if (signal?.aborted) throw new CancelledError();
      await this.acquire(host, signal);
      const ctl = new AbortController();
      const onAbort = () => ctl.abort();
      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => ctl.abort(), this.o.timeoutMs);
      let waitMs = 0;
      let lastStatus: number | undefined;
      let lastMsg: string | undefined;
      try {
        const res = await this.o.fetchImpl(url, {
          method: 'GET', signal: ctl.signal, redirect: rawResponse ? 'manual' : 'follow',
          headers: { Accept: parseJson ? 'application/json' : '*/*', 'User-Agent': this.o.userAgent },
        });
        if (rawResponse) return res; // chamador valida status/redirecionamento; o timer é limpo no finally
        if (res.status === 204) return { status: 204, body: null, headers: res.headers };
        if (res.status === 404) throw new NotFoundError(url);
        lastStatus = res.status;
        if (res.status === 429 || res.status >= 500 || res.status === 408) {
          waitMs = parseRetryAfter(res.headers.get('retry-after'), this.o.now()) ?? this.backoff(attempt);
          if (res.status === 429 || res.status === 503) this.penaltyUntil.set(host, this.o.now() + waitMs);
          lastErr = new HttpError(`HTTP ${res.status} ${url}`, res.status, url, false);
        } else if (res.status >= 400) {
          let detail = '';
          try { detail = (await res.text()).slice(0, 300); } catch { /* ignora */ }
          throw new HttpError(`HTTP ${res.status} ${url} ${detail}`.trim(), res.status, url, true);
        } else {
          const text = await res.text();
          if (!text.trim()) return { status: res.status, body: null, headers: res.headers };
          try { return { status: res.status, body: JSON.parse(text), headers: res.headers }; }
          catch { throw new SchemaError(`Resposta não é JSON válido (${url})`, url); }
        }
      } catch (e) {
        if (e instanceof HttpError && e.permanent) throw e;
        if (e instanceof SchemaError) throw e;
        if (signal?.aborted) throw new CancelledError();
        lastErr = e;
        waitMs = this.backoff(attempt);
        lastMsg = e instanceof Error ? (e.cause instanceof Error ? `${e.message} (${e.cause.message})` : e.message) : String(e);
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.release(host);
      }
      if (attempt > this.o.maxRetries) { this.o.onAttempt?.({ url, attempt, status: lastStatus, error: lastMsg }); break; }
      this.o.onAttempt?.({ url, attempt, status: lastStatus, error: lastMsg, waitMs });
      await this.o.sleep(waitMs, signal);
    }
    if (lastErr instanceof HttpError) throw lastErr;
    throw new HttpError(`Falha de rede após ${this.o.maxRetries + 1} tentativas: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`, 0, url, false);
  }

  private backoff(attempt: number): number {
    const exp = Math.min(this.o.maxBackoffMs, this.o.baseBackoffMs * 2 ** (attempt - 1));
    return Math.round(exp / 2 + this.o.random() * (exp / 2)); // jitter
  }
}
