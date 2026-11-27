/**
 * Leitura mínima de ZIP (e de DOCX/ODT, que são ZIP) sem dependências externas.
 * Suporta os métodos "stored" (0) e "deflate" (8). ZIP64, criptografia e arquivos multivolume são recusados.
 * Limites de quantidade e de tamanho descompactado protegem contra arquivos-bomba.
 */
import * as zlib from 'node:zlib';

export interface ZipEntry { name: string; method: number; compressedSize: number; size: number; localOffset: number; flags: number }
export class ZipError extends Error {}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + b[o + 3] * 0x1000000;

function decodeName(raw: Uint8Array, utf8: boolean): string {
  return Buffer.from(raw).toString(utf8 ? 'utf8' : 'latin1');
}

export function listZip(buf: Uint8Array, maxEntries = 500): ZipEntry[] {
  if (buf.length < 22) throw new ZipError('Arquivo ZIP truncado');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (u32(buf, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new ZipError('Fim do diretório ZIP não encontrado');
  const total = u16(buf, eocd + 10);
  const cdSize = u32(buf, eocd + 12);
  const cdOffset = u32(buf, eocd + 16);
  if (total === 0xffff || cdOffset === 0xffffffff) throw new ZipError('ZIP64 não suportado');
  if (cdOffset + cdSize > buf.length) throw new ZipError('Diretório ZIP fora do arquivo');
  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let n = 0; n < total; n++) {
    if (n >= maxEntries) throw new ZipError(`ZIP com mais de ${maxEntries} arquivos`);
    if (u32(buf, p) !== 0x02014b50) throw new ZipError('Entrada do diretório ZIP inválida');
    const flags = u16(buf, p + 8);
    const method = u16(buf, p + 10);
    const compressedSize = u32(buf, p + 20);
    const size = u32(buf, p + 24);
    const nameLen = u16(buf, p + 28), extraLen = u16(buf, p + 30), commentLen = u16(buf, p + 32);
    const localOffset = u32(buf, p + 42);
    const name = decodeName(buf.subarray(p + 46, p + 46 + nameLen), (flags & 0x800) !== 0);
    out.push({ name, method, compressedSize, size, localOffset, flags });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function readEntry(buf: Uint8Array, e: ZipEntry, maxBytes: number): Uint8Array {
  if (e.flags & 0x1) throw new ZipError(`Arquivo protegido por senha: ${e.name}`);
  if (e.size > maxBytes) throw new ZipError(`Arquivo grande demais dentro do ZIP: ${e.name}`);
  const o = e.localOffset;
  if (u32(buf, o) !== 0x04034b50) throw new ZipError(`Cabeçalho local inválido: ${e.name}`);
  const start = o + 30 + u16(buf, o + 26) + u16(buf, o + 28);
  const data = buf.subarray(start, start + e.compressedSize);
  if (e.method === 0) return data;
  if (e.method === 8) {
    const r = zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, Math.min(maxBytes, e.size || maxBytes)) });
    return new Uint8Array(r.buffer, r.byteOffset, r.byteLength);
  }
  throw new ZipError(`Compressão não suportada (${e.method}) em ${e.name}`);
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decodeXmlText(xml: string): string {
  return xml.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') { const c = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(c) ? String.fromCodePoint(c) : m; }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Texto de um DOCX (word/document.xml) ou ODT (content.xml); null se o ZIP não for um desses. */
export function officeText(buf: Uint8Array, maxBytes: number): string | null {
  const entries = listZip(buf);
  const docx = entries.find((e) => e.name === 'word/document.xml');
  const odt = entries.find((e) => e.name === 'content.xml') && entries.some((e) => e.name === 'mimetype');
  const target = docx ?? (odt ? entries.find((e) => e.name === 'content.xml') : undefined);
  if (!target) return null;
  const xml = Buffer.from(readEntry(buf, target, maxBytes)).toString('utf8');
  const text = xml
    .replace(/<w:tab\/>|<text:tab\/>/g, '\t')
    .replace(/<\/w:p>|<w:br\/>|<\/text:p>|<\/text:h>|<text:line-break\/>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeXmlText(text).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Divide texto corrido em "páginas" de tamanho estável para a busca e as evidências. */
export function paginate(text: string, size = 3500): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('\n', size);
    if (cut < size * 0.5) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest.trim()) out.push(rest);
  return out;
}
