/** Validação de links externos antes de abrir no navegador padrão. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (h.includes(':')) return true; // IPv6 literal: não aceita
  return !h.includes('.');
}

export function validateExternalUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (isPrivateHost(u.hostname)) return null;
  return u;
}

/**
 * Segue até 3 redirecionamentos validando cada salto (HTTPS e host público).
 * Se a rede estiver indisponível, mantém o URL original já validado.
 */
export async function resolveSafeUrl(raw: unknown, fetchImpl: typeof fetch = fetch, timeoutMs = 5000): Promise<string | null> {
  let u = validateExternalUrl(raw);
  if (!u) return null;
  for (let hop = 0; hop < 4; hop++) {
    let res: Response;
    try {
      res = await fetchImpl(u.toString(), { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(timeoutMs) });
    } catch { return u.toString(); }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) return u.toString();
      const next = validateExternalUrl(new URL(loc, u).toString());
      if (!next) return null; // redirecionamento para destino inválido
      u = next;
      continue;
    }
    return u.toString();
  }
  return null; // redirecionamentos demais
}

/** Caminho do app protegido contra travessia de diretório. */
export function safeJoin(root: string, requested: string, join: (...p: string[]) => string, sep: string): string | null {
  const decoded = decodeURIComponent(requested.split('?')[0].split('#')[0]);
  if (decoded.includes('\0') || decoded.split(/[\\/]/).includes('..')) return null;
  const full = join(root, decoded);
  return full.startsWith(root + sep) || full === root ? full : null;
}
