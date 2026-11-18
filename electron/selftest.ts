import * as fs from 'node:fs';
import * as path from 'node:path';
import { Notification, Tray, nativeImage } from 'electron';
import { createServices } from './services.ts';
import { normalizeProcurement } from './pncp.ts';
import { listOpportunities } from './query.ts';
import { extractPdfText } from './docs.ts';
import { buildPdf } from './testpdf.ts';

/**
 * Autoverificação do build empacotado: SQLite/FTS5, migração, busca, extração de PDF em worker, bandeja e notificação.
 * Uso: "Monitor de Licitações Legislativas.exe" --selftest --selftest-out=resultado.json
 */
export async function selfTest(dataDir: string, outFile?: string): Promise<number> {
  const result: Record<string, unknown> = { startedAt: new Date().toISOString(), electron: process.versions.electron, node: process.versions.node, versao: process.env['MONITOR_APP_VERSION'] ?? null, pasta: process.env['MONITOR_APP_DIR'] ?? null };
  let ok = true;
  const step = async (name: string, fn: () => unknown | Promise<unknown>) => {
    try { result[name] = await fn(); } catch (e) { ok = false; result[name] = { erro: e instanceof Error ? e.message : String(e) }; }
  };
  let svc: ReturnType<typeof createServices> | undefined;
  await step('banco', () => {
    svc = createServices(dataDir);
    const c = svc.db.selfCheck();
    if (!c.fts5 || c.integrity !== 'ok') throw new Error('FTS5/integridade falhou: ' + JSON.stringify(c));
    return { ...c, migracoes: svc.db.get('SELECT MAX(version) AS v FROM schema_migrations') };
  });
  await step('busca', () => {
    const n = normalizeProcurement({
      numeroControlePNCP: '12ABC34501DE35-1-000001/2026', anoCompra: 2026, sequencialCompra: 1,
      orgaoEntidade: { cnpj: '12.ABC.345/01DE-35', razaoSocial: 'CÂMARA MUNICIPAL DE TESTE', poderId: 'L' },
      unidadeOrgao: { ufSigla: 'ES', municipioNome: 'Rio Novo do Sul' }, modalidadeId: 6, modalidadeNome: 'Pregão - Eletrônico',
      objetoCompra: 'Locação de software de processo legislativo', situacaoCompraId: 1, situacaoCompraNome: 'Divulgada no PNCP',
      dataEncerramentoProposta: '2099-01-01T09:00:00', dataAtualizacaoGlobal: '2026-11-17T10:00:00',
    }, 'selftest');
    svc!.store.upsertProcurement(n, { silent: true, level: 0, route: 'lista' });
    const r = listOpportunities(svc!.store, { text: 'camara legislativo' });
    if (r.total !== 1) throw new Error('busca FTS não retornou o registro');
    const row = svc!.db.get<{ cnpj: string }>('SELECT cnpj FROM procurements')!;
    if (row.cnpj !== '12ABC34501DE35') throw new Error('CNPJ alfanumérico não preservado');
    return { total: r.total, cnpj: row.cnpj, relevancia: r.rows[0]?.relevance };
  });
  await step('pdf', async () => {
    const ex = await extractPdfText(buildPdf(['Sistema de gestao do processo legislativo para camaras municipais', 'Segunda pagina com votacao eletronica e painel de plenario']), { maxPages: 10, timeoutMs: 30_000 });
    if (ex.textStatus === 'erro' || !/processo legislativo/.test(ex.pages[0]?.text ?? '')) throw new Error('extração falhou: ' + JSON.stringify(ex).slice(0, 200));
    return { paginas: ex.totalPages, status: ex.textStatus };
  });
  await step('bandeja', () => {
    const icon = path.join(__dirname, '..', 'build', 'icon.png');
    const t = new Tray(fs.existsSync(icon) ? nativeImage.createFromPath(icon).resize({ width: 16, height: 16 }) : nativeImage.createEmpty());
    t.setToolTip('selftest');
    t.destroy();
    return { criada: true, icone: fs.existsSync(icon) };
  });
  await step('notificacao', () => ({ suportada: Notification.isSupported() }));
  svc?.db.close();
  result['ok'] = ok;
  const text = JSON.stringify(result, null, 2);
  if (outFile) fs.writeFileSync(outFile, text);
  process.stdout.write(text + '\n');
  return ok ? 0 : 1;
}
