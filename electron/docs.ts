import { fork, type ChildProcess } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SourceConnector } from './connector.ts';
import type { Store } from './store.ts';
import { sniffFileType } from './pncp.ts';
import { HttpError } from './http.ts';

export interface Extraction {
  pages: { page: number; text: string }[];
  totalPages: number;
  textStatus: 'ok' | 'imagem' | 'parcial' | 'erro';
  error?: string;
}
export type Extractor = (bytes: Uint8Array, limits: { maxPages: number; timeoutMs: number }) => Promise<Extraction>;

function workerPath(): string {
  const p = path.join(__dirname, 'pdfworker.js');
  const unpacked = p.replace('app.asar', 'app.asar.unpacked');
  return fs.existsSync(unpacked) ? unpacked : p;
}

/**
 * Extrai texto de PDF em PROCESSO FILHO isolado, com limite de páginas e de tempo.
 * (worker_threads foi descartado: o leitor de PDF provocou falhas nativas que derrubariam o processo principal.)
 * No Electron, ELECTRON_RUN_AS_NODE faz o executável do app atuar como Node sem abrir janela.
 */
export const extractPdfText: Extractor = (bytes, limits) =>
  new Promise((resolve) => {
    let settled = false;
    const fail = (error: string) => done({ pages: [], totalPages: 0, textStatus: 'erro', error });
    const done = (e: Extraction) => { if (!settled) { settled = true; clearTimeout(timer); resolve(e); } };
    let child: ChildProcess;
    try {
      child = fork(workerPath(), [], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        serialization: 'advanced',
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        windowsHide: true,
      });
    } catch (e) { return resolve({ pages: [], totalPages: 0, textStatus: 'erro', error: `Falha ao iniciar extração: ${(e as Error).message}` }); }
    const timer = setTimeout(() => { child.kill(); fail('Tempo limite de extração excedido'); }, limits.timeoutMs);
    child.once('message', (m: any) => {
      if (!m?.ok) return fail(String(m?.error ?? 'Falha na extração'));
      done({ pages: m.pages, totalPages: m.totalPages, textStatus: assessText(m.pages, m.truncated) });
    });
    child.once('error', (e) => fail(e.message));
    child.once('exit', (code, signal) => { if (!settled) fail(`Processo de extração encerrou (${signal ?? 'código ' + code})`); });
    child.send({ bytes, maxPages: limits.maxPages });
  });

/** Texto só de imagem (sem camada de texto) ou incompleto é sinalizado; o app oferece abrir o original. */
export function assessText(pages: { text: string }[], truncated: boolean): 'ok' | 'imagem' | 'parcial' {
  if (pages.length === 0) return 'imagem';
  const withText = pages.filter((p) => p.text.replace(/\s/g, '').length >= 40).length;
  if (withText === 0) return 'imagem';
  if (truncated || withText / pages.length < 0.5) return 'parcial';
  return 'ok';
}

const SAFE_EXT = ['pdf', 'zip', 'rar', '7z', 'doc', 'docx', 'xls', 'xlsx', 'odt', 'ods', 'txt', 'csv', 'rtf', 'jpg', 'jpeg', 'png'];
function safeExt(title: string | null): string {
  const e = /\.([a-z0-9]{2,4})$/i.exec(title ?? '')?.[1]?.toLowerCase();
  return e && SAFE_EXT.includes(e) ? e : 'bin';
}
/** Nome de arquivo para salvar: título sanitizado + extensão real do conteúdo. */
export function downloadName(title: string | null, seq: number, ext: string): string {
  // só remove extensões conhecidas: "EDITAL PR11.2026" mantém o ".2026"
  const base = (title ?? '').replace(new RegExp(`\\.(${SAFE_EXT.join('|')})$`, 'i'), '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 100);
  return `${base || 'documento-' + seq}.${ext}`;
}

/**
 * Documento + dados da compra. `documents.sequencial` (nº do arquivo) e `procurements.sequencial` (nº da compra)
 * têm o mesmo nome: a compra vem como `compra_sequencial` para não sobrescrever o do arquivo
 * (antes a URL saía …/compras/<ano>/25/arquivos/25 e o PNCP respondia 404).
 */
const DOC_WITH_PROCUREMENT =
  'SELECT d.*, p.cnpj, p.ano, p.sequencial AS compra_sequencial, p.id AS pid FROM documents d JOIN procurements p ON p.id=d.procurement_id';

export class DocPipeline {
  constructor(
    private store: Store,
    private connector: SourceConnector,
    private dir: string,
    private extract: Extractor = extractPdfText,
  ) {
    fs.mkdirSync(dir, { recursive: true });
  }

  /** Baixa, valida e extrai um anexo. Documentos e metadados externos são tratados apenas como dados. */
  async process(docId: number, signal?: AbortSignal): Promise<{ status: string }> {
    const db = this.store.db;
    const settings = this.store.getSettings();
    const d = db.get<any>(
      `${DOC_WITH_PROCUREMENT} WHERE d.id=?`, docId);
    if (!d) return { status: 'inexistente' };
    try {
      const file = await this.connector.downloadDocument(
        { cnpj: d.cnpj, ano: d.ano, sequencial: d.compra_sequencial },
        { sequencial: d.sequencial, titulo: d.titulo, tipoId: d.tipo_id, tipoNome: d.tipo_nome, url: d.url, dataPublicacao: d.data_publicacao, ativo: !!d.ativo },
        { maxBytes: settings.maxDocBytes, timeoutMs: settings.docTimeoutMs, signal },
      );
      const kind = sniffFileType(file.bytes);
      const sha256 = crypto.createHash('sha256').update(file.bytes).digest('hex');
      if (kind !== 'pdf') {
        db.run("UPDATE documents SET status='ignorado', error=?, sha256=?, bytes=?, fetched_at=? WHERE id=?",
          `Tipo não suportado para extração (${kind}); abra o documento original.`, sha256, file.bytes.byteLength, this.store.now(), docId);
        return { status: 'ignorado' };
      }
      const localPath = path.join(this.dir, `${sha256}.pdf`);
      if (!fs.existsSync(localPath)) fs.writeFileSync(localPath, file.bytes);
      const ex = await this.extract(file.bytes, { maxPages: settings.maxDocPaginas, timeoutMs: settings.docTimeoutMs });
      if (ex.textStatus === 'erro') {
        db.run("UPDATE documents SET status='erro', error=?, sha256=?, bytes=?, local_path=?, text_status='erro', fetched_at=? WHERE id=?",
          ex.error ?? 'Falha na extração', sha256, file.bytes.byteLength, localPath, this.store.now(), docId);
        return { status: 'erro' };
      }
      const { contentChanged } = this.store.saveDocumentText(docId, {
        sha256, bytes: file.bytes.byteLength, localPath, pages: ex.pages, textStatus: ex.textStatus, totalPages: ex.totalPages,
      });
      if (contentChanged) {
        this.store.addEvent(d.pid, 'documento_alterado', `doc:${d.pid}:${docId}:${sha256}`, { documento: d.titulo, sha256 }, false);
      }
      this.store.reclassify(d.pid);
      return { status: ex.textStatus };
    } catch (e) {
      if (e instanceof HttpError && e.permanent) {
        db.run("UPDATE documents SET status='erro', error=?, fetched_at=? WHERE id=?", e.message.slice(0, 300), this.store.now(), docId);
        return { status: 'erro' };
      }
      throw e;
    }
  }

  /**
   * Garante uma cópia local do anexo (para visualizar/baixar), reaproveitando a já baixada.
   * O arquivo é guardado pelo hash; a extensão vem da assinatura do conteúdo, nunca do nome externo.
   */
  async ensureLocal(docId: number, signal?: AbortSignal): Promise<{ path: string; kind: string; ext: string; fileName: string }> {
    const db = this.store.db;
    const d = db.get<any>(`${DOC_WITH_PROCUREMENT} WHERE d.id=?`, docId);
    if (!d) throw new Error('Documento não encontrado.');
    if (d.local_path && fs.existsSync(d.local_path)) {
      const ext = path.extname(d.local_path).slice(1) || 'bin';
      return { path: d.local_path, kind: ext === 'pdf' ? 'pdf' : 'outro', ext, fileName: downloadName(d.titulo, d.sequencial, ext) };
    }
    const s = this.store.getSettings();
    const file = await this.connector.downloadDocument(
      { cnpj: d.cnpj, ano: d.ano, sequencial: d.compra_sequencial },
      { sequencial: d.sequencial, titulo: d.titulo, tipoId: d.tipo_id, tipoNome: d.tipo_nome, url: d.url, dataPublicacao: d.data_publicacao, ativo: !!d.ativo },
      // pedido do usuário: fila própria, sem esperar a coleta (que pode estar em espera por HTTP 429)
      { maxBytes: Math.max(s.maxDocBytes, 150 * 1024 * 1024), timeoutMs: Math.max(s.docTimeoutMs, 120_000), signal, interactive: true },
    );
    const kind = sniffFileType(file.bytes);
    const ext = kind === 'pdf' ? 'pdf' : kind === 'zip' ? (/\.(docx|xlsx|odt|ods)$/i.exec(d.titulo ?? '')?.[1]?.toLowerCase() ?? 'zip') : safeExt(d.titulo);
    if (kind === 'html') throw new Error('A fonte devolveu uma página HTML em vez do arquivo. Abra o documento no PNCP.');
    const sha256 = crypto.createHash('sha256').update(file.bytes).digest('hex');
    const localPath = path.join(this.dir, `${sha256}.${ext}`);
    if (!fs.existsSync(localPath)) fs.writeFileSync(localPath, file.bytes);
    db.run('UPDATE documents SET local_path=?, sha256=COALESCE(sha256, ?), bytes=?, fetched_at=COALESCE(fetched_at, ?) WHERE id=?',
      localPath, sha256, file.bytes.byteLength, this.store.now(), docId);
    return { path: localPath, kind: kind === 'pdf' ? 'pdf' : 'outro', ext, fileName: downloadName(d.titulo, d.sequencial, ext) };
  }

  /** Remove arquivos locais antigos (retenção) sem apagar o texto já extraído. */
  purge(retentionDays: number): number {
    let n = 0;
    const limit = Date.now() - retentionDays * 86_400_000;
    for (const f of fs.readdirSync(this.dir)) {
      const full = path.join(this.dir, f);
      try {
        if (fs.statSync(full).mtimeMs < limit) { fs.unlinkSync(full); n++; this.store.db.run('UPDATE documents SET local_path=NULL WHERE local_path=?', full); }
      } catch { /* ignora */ }
    }
    return n;
  }
}
