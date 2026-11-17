import type {
  ListPage, ListQuery, NormalizedDocument, NormalizedItem, NormalizedProcurement, ProcurementRef, SourceConnector,
} from './connector.ts';
import { HttpClient, HttpError, SchemaError } from './http.ts';
import { parseInstant } from './time.ts';

export const PNCP_HOST = 'https://pncp.gov.br';
export const CONSULTA = `${PNCP_HOST}/api/consulta/v1`;
export const PNCP_API = `${PNCP_HOST}/api/pncp/v1`;

export const MODALIDADES_PADRAO: Record<number, string> = {
  4: 'Concorrência - Eletrônica', 5: 'Concorrência - Presencial', 6: 'Pregão - Eletrônico',
  7: 'Pregão - Presencial', 8: 'Dispensa', 9: 'Inexigibilidade',
};

/** Remove apenas separadores de apresentação; mantém letras e zeros à esquerda. */
export function normalizeCnpj(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).toUpperCase().replace(/[.\/\-\s]/g, '');
  return /^[0-9A-Z]{12}[0-9]{2}$/.test(s) ? s : null;
}

export function toCents(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

export function safeHttpsUrl(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u.toString();
  } catch { return null; }
}

export function pncpEditalUrl(ref: ProcurementRef): string {
  return `${PNCP_HOST}/app/editais/${ref.cnpj}/${ref.ano}/${ref.sequencial}`;
}

export function buildControlId(ref: ProcurementRef): string {
  return `${ref.cnpj}-1-${String(ref.sequencial).padStart(6, '0')}/${ref.ano}`;
}

const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

function sigiloso(r: any): boolean | null {
  const code = num(r.orcamentoSigilosoCodigo);
  const desc = String(r.orcamentoSigilosoDescricao ?? '').toLowerCase();
  if (code === 2 || (desc.includes('sigilo') && !desc.includes('sem sigilo'))) return true;
  if (code === 1 || desc.includes('sem sigilo')) return false;
  return null;
}

/** Normaliza um registro de contratação. Lança SchemaError se faltarem campos de identidade. */
export function normalizeProcurement(r: any, route: string): NormalizedProcurement {
  if (!r || typeof r !== 'object') throw new SchemaError('Registro não é objeto', route);
  const cnpj = normalizeCnpj(r.orgaoEntidade?.cnpj);
  const ano = num(r.anoCompra);
  const sequencial = num(r.sequencialCompra);
  if (!cnpj) throw new SchemaError(`orgaoEntidade.cnpj ausente ou inválido (${JSON.stringify(r.orgaoEntidade?.cnpj)})`, route);
  if (ano === null || sequencial === null) throw new SchemaError('anoCompra/sequencialCompra ausentes', route);
  const ref = { cnpj, ano, sequencial };
  const controlId = str(r.numeroControlePNCP) ?? buildControlId(ref);
  const ab = parseInstant(r.dataAberturaProposta);
  const enc = parseInstant(r.dataEncerramentoProposta);
  const upd = parseInstant(r.dataAtualizacaoGlobal ?? r.dataAtualizacao);
  const u = r.unidadeOrgao ?? {};
  return {
    ...ref,
    controlId,
    source: 'pncp',
    numeroCompra: str(r.numeroCompra),
    processo: str(r.processo),
    orgaoNome: str(r.orgaoEntidade?.razaoSocial),
    poder: str(r.orgaoEntidade?.poderId),
    esfera: str(r.orgaoEntidade?.esferaId),
    unidadeNome: str(u.nomeUnidade),
    codigoUnidade: str(u.codigoUnidade),
    uf: str(u.ufSigla),
    municipio: str(u.municipioNome),
    codigoIbge: str(u.codigoIbge),
    orgaoSubrogado: r.orgaoSubRogado ? JSON.stringify(r.orgaoSubRogado) : null,
    unidadeSubrogada: r.unidadeSubRogada ? JSON.stringify(r.unidadeSubRogada) : null,
    modalidadeId: num(r.modalidadeId),
    modalidadeNome: str(r.modalidadeNome),
    objeto: str(r.objetoCompra),
    infoComplementar: str(r.informacaoComplementar),
    situacaoId: num(r.situacaoCompraId),
    situacaoNome: str(r.situacaoCompraNome),
    valorEstimadoCents: sigiloso(r) ? null : toCents(r.valorTotalEstimado),
    valorHomologadoCents: toCents(r.valorTotalHomologado),
    orcamentoSigiloso: sigiloso(r),
    dataPublicacao: parseInstant(r.dataPublicacaoPncp)?.utc ?? null,
    aberturaRaw: ab?.raw ?? null,
    aberturaUtc: ab?.utc ?? null,
    encerramentoRaw: enc?.raw ?? null,
    encerramentoUtc: enc?.utc ?? null,
    prazoOrigem: enc?.origin ?? ab?.origin ?? null,
    linkPncp: pncpEditalUrl(ref),
    linkOrigem: safeHttpsUrl(r.linkSistemaOrigem),
    linkProcesso: safeHttpsUrl(r.linkProcessoEletronico),
    sourceUpdatedUtc: upd?.utc ?? null,
    raw: r,
  };
}

export function normalizeItem(r: any): NormalizedItem {
  const n = num(r?.numeroItem);
  if (n === null) throw new SchemaError('numeroItem ausente', 'itens');
  const sig = r.orcamentoSiloso ?? r.orcamentoSigiloso;
  return {
    numeroItem: n,
    descricao: str(r.descricao),
    materialOuServico: str(r.materialOuServicoNome ?? r.materialOuServico),
    quantidade: r.quantidade === null || r.quantidade === undefined ? null : String(r.quantidade),
    unidadeMedida: str(r.unidadeMedida),
    valorUnitario: r.valorUnitarioEstimado === null || r.valorUnitarioEstimado === undefined ? null : String(r.valorUnitarioEstimado),
    valorTotalCents: sig === true ? null : toCents(r.valorTotal),
    sigiloso: typeof sig === 'boolean' ? sig : null,
    situacao: str(r.situacaoCompraItemNome),
    categoria: str(r.itemCategoriaNome),
    infoComplementar: str(r.informacaoComplementar),
  };
}

export function normalizeDocument(r: any): NormalizedDocument {
  const seq = num(r?.sequencialDocumento);
  if (seq === null) throw new SchemaError('sequencialDocumento ausente', 'arquivos');
  return {
    sequencial: seq,
    titulo: str(r.titulo),
    tipoId: num(r.tipoDocumentoId),
    tipoNome: str(r.tipoDocumentoNome),
    url: safeHttpsUrl(r.url ?? r.uri),
    dataPublicacao: parseInstant(r.dataPublicacaoPncp)?.utc ?? null,
    ativo: r.statusAtivo !== false,
  };
}

const ALLOWED_DOC_HOSTS = (h: string) => h === 'pncp.gov.br' || h.endsWith('.pncp.gov.br');

export function safeFileName(name: string | null | undefined, fallback: string): string {
  const base = (name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').slice(0, 120).trim();
  return base || fallback;
}

export class PncpConnector implements SourceConnector {
  readonly id = 'pncp';
  readonly label = 'PNCP — Portal Nacional de Contratações Públicas';
  constructor(private http: HttpClient) {}

  coverage(modalidades: number[], ufs: string[]): string {
    const mods = modalidades.map((m) => `${m} ${MODALIDADES_PADRAO[m] ?? ''}`.trim()).join(', ');
    return `${ufs.length ? 'UFs: ' + ufs.join(', ') : 'Nacional (todas as UFs)'} · modalidades: ${mods}`;
  }

  async listWindow(q: ListQuery, signal?: AbortSignal): Promise<ListPage> {
    const p = new URLSearchParams();
    if (q.route !== 'proposta') p.set('dataInicial', q.dataInicial ?? q.dataFinal);
    p.set('dataFinal', q.dataFinal);
    if (q.modalidade !== undefined) p.set('codigoModalidadeContratacao', String(q.modalidade));
    if (q.uf) p.set('uf', q.uf);
    p.set('pagina', String(q.pagina));
    p.set('tamanhoPagina', String(Math.min(50, Math.max(10, q.tamanhoPagina))));
    const route = `/contratacoes/${q.route}`;
    const res = await this.http.getJson<any>(`${CONSULTA}${route}?${p}`, signal);
    if (res.status === 204 || res.body === null) {
      return { records: [], rejected: [], totalRegistros: 0, totalPaginas: 0, numeroPagina: q.pagina, empty: true };
    }
    const b = res.body;
    if (typeof b !== 'object' || !Array.isArray(b.data)) {
      throw new SchemaError(`Envelope inesperado em ${route}: faltam "data" (array). Chaves: ${Object.keys(b ?? {}).join(',')}`, route);
    }
    const records: NormalizedProcurement[] = [];
    const rejected: { index: number; reason: string }[] = [];
    b.data.forEach((r: unknown, i: number) => {
      try { records.push(normalizeProcurement(r, route)); }
      catch (e) { rejected.push({ index: i, reason: e instanceof Error ? e.message : String(e) }); }
    });
    if (b.data.length > 0 && records.length === 0) {
      throw new SchemaError(`Nenhum registro válido em ${route}: ${rejected[0]?.reason}`, route);
    }
    return {
      records, rejected,
      totalRegistros: num(b.totalRegistros) ?? b.data.length,
      totalPaginas: num(b.totalPaginas) ?? 1,
      numeroPagina: num(b.numeroPagina) ?? q.pagina,
      empty: Boolean(b.empty) || b.data.length === 0,
    };
  }

  async fetchDetail(ref: ProcurementRef, signal?: AbortSignal): Promise<NormalizedProcurement> {
    const url = `${CONSULTA}/orgaos/${ref.cnpj}/compras/${ref.ano}/${ref.sequencial}`;
    const res = await this.http.getJson<any>(url, signal);
    if (!res.body) throw new SchemaError('Detalhe vazio', url);
    return normalizeProcurement(res.body, `detalhe`);
  }

  async fetchItems(ref: ProcurementRef, signal?: AbortSignal): Promise<NormalizedItem[]> {
    const size = 50;
    const out: NormalizedItem[] = [];
    for (let page = 1; page <= 40; page++) {
      const url = `${PNCP_API}/orgaos/${ref.cnpj}/compras/${ref.ano}/${ref.sequencial}/itens?pagina=${page}&tamanhoPagina=${size}`;
      const res = await this.http.getJson<any>(url, signal);
      const arr = res.body === null ? [] : Array.isArray(res.body) ? res.body : Array.isArray(res.body?.data) ? res.body.data : null;
      if (arr === null) throw new SchemaError('Resposta de itens não é lista', url);
      for (const r of arr) out.push(normalizeItem(r));
      if (arr.length < size) break;
    }
    return out;
  }

  async fetchDocuments(ref: ProcurementRef, signal?: AbortSignal): Promise<NormalizedDocument[]> {
    const url = `${PNCP_API}/orgaos/${ref.cnpj}/compras/${ref.ano}/${ref.sequencial}/arquivos`;
    const res = await this.http.getJson<any>(url, signal);
    const arr = res.body === null ? [] : Array.isArray(res.body) ? res.body : Array.isArray(res.body?.data) ? res.body.data : null;
    if (arr === null) throw new SchemaError('Resposta de arquivos não é lista', url);
    return arr.map(normalizeDocument);
  }

  async fetchModalidades(signal?: AbortSignal) {
    const res = await this.http.getJson<any[]>(`${PNCP_API}/modalidades`, signal);
    if (!Array.isArray(res.body)) throw new SchemaError('Catálogo de modalidades inválido', 'modalidades');
    return res.body.map((m) => ({ id: Number(m.id), nome: String(m.nome), ativo: m.statusAtivo !== false }));
  }

  async downloadDocument(ref: ProcurementRef, doc: NormalizedDocument, opts: { maxBytes: number; timeoutMs: number; signal?: AbortSignal }) {
    let url: string = `${PNCP_API}/orgaos/${ref.cnpj}/compras/${ref.ano}/${ref.sequencial}/arquivos/${doc.sequencial}`;
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    opts.signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs);
    try {
      for (let hop = 0; hop < 4; hop++) {
        const u = new URL(url);
        if (u.protocol !== 'https:' || !ALLOWED_DOC_HOSTS(u.hostname)) throw new HttpError(`Origem de anexo não permitida: ${u.host}`, 0, url, true);
        const res = await this.http.getRaw(url, ctl.signal);
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers.get('location');
          if (!loc) throw new HttpError('Redirecionamento sem destino', res.status, url, true);
          url = new URL(loc, url).toString();
          continue;
        }
        if (res.status === 404) throw new HttpError('Anexo não encontrado', 404, url, true);
        if (!res.ok) throw new HttpError(`HTTP ${res.status} ao baixar anexo`, res.status, url, res.status < 500 && res.status !== 429);
        const declared = Number(res.headers.get('content-length') ?? '0');
        if (declared > opts.maxBytes) throw new HttpError(`Anexo excede o limite (${declared} bytes)`, 0, url, true);
        const chunks: Uint8Array[] = [];
        let total = 0;
        const reader = res.body!.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > opts.maxBytes) { await reader.cancel(); throw new HttpError('Anexo excede o limite de bytes', 0, url, true); }
          chunks.push(value);
        }
        const bytes = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) { bytes.set(c, off); off += c.byteLength; }
        const contentType = (res.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
        return { bytes, contentType, fileName: safeFileName(doc.titulo, `anexo-${doc.sequencial}`) };
      }
      throw new HttpError('Redirecionamentos demais', 0, url, true);
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }
}

/** Tipo de arquivo pela assinatura (não confia apenas em extensão/cabeçalho). */
export function sniffFileType(b: Uint8Array): 'pdf' | 'zip' | 'html' | 'outro' {
  const head = Buffer.from(b.subarray(0, 8)).toString('latin1');
  if (head.startsWith('%PDF')) return 'pdf';
  if (head.startsWith('PK')) return 'zip';
  const t = Buffer.from(b.subarray(0, 64)).toString('latin1').trimStart().toLowerCase();
  if (t.startsWith('<!doctype html') || t.startsWith('<html')) return 'html';
  return 'outro';
}
