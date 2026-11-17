/**
 * Processo filho isolado para extração de texto de PDFs paginados.
 * Roda fora do processo principal: uma falha nativa do leitor de PDF encerra só este processo.
 * Nunca executa conteúdo do documento: apenas lê texto. Recebe bytes, devolve páginas.
 */
interface Job { bytes: Uint8Array; maxPages: number }

async function run(job: Job) {
  const spec = 'pdfjs-dist/legacy/build/pdf.mjs';
  const pdfjs: any = await import(spec);
  const task = pdfjs.getDocument({
    data: new Uint8Array(job.bytes),
    useSystemFonts: false,
    isEvalSupported: false,
    disableFontFace: true,
    verbosity: 0,
  });
  const doc = await task.promise;
  const total: number = doc.numPages;
  const limit = Math.min(total, job.maxPages);
  const pages: { page: number; text: string }[] = [];
  for (let i = 1; i <= limit; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const text = content.items.map((it: any) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : '')).join('').replace(/[ \t]+/g, ' ').trim();
    pages.push({ page: i, text });
    page.cleanup();
  }
  await doc.destroy();
  return { pages, totalPages: total, truncated: total > limit };
}

process.once('message', (job: Job) => {
  run(job)
    .then((r) => process.send!({ ok: true, ...r }, () => process.exit(0)))
    .catch((e) => process.send!({ ok: false, error: e instanceof Error ? e.message : String(e) }, () => process.exit(0)));
});
