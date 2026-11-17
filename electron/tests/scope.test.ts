import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../classify.ts';
import { makeStore, rec } from './helpers.ts';
import { normalizeProcurement } from '../pncp.ts';
import { upgradeClassification } from '../services.ts';
import { SyncEngine } from '../sync.ts';
import { listOpportunities } from '../query.ts';

/** Escopo do nicho: software para processos do Legislativo (o que o Ágil oferece a Câmaras). */
const camara = { orgaoNome: 'CAMARA MUNICIPAL DE RIO NOVO DO SUL', unidadeNome: 'Câmara Municipal', poder: 'L' };
const prefeitura = { orgaoNome: 'MUNICIPIO DE MARILIA', unidadeNome: 'Secretaria de Administração', poder: 'E' };

test('nicho: Câmara contratando protocolo, tramitação, gestão documental, e-SIC ou portal com software entra na triagem', () => {
  for (const objeto of [
    'Locação de sistema web de protocolo eletrônico e tramitação de processos digitais',
    'Contratação de solução SaaS de gestão documental com e-SIC e ouvidoria',
    'Desenvolvimento de sistema de portal da transparência e protocolo',
  ]) {
    const c = classify({ ...camara, objeto });
    assert.ok(c.label === 'revisar' || c.label === 'alta', `${objeto} → ${c.label}`);
  }
  assert.equal(classify({ ...camara, objeto: 'Implantação de processo legislativo eletrônico' }).label, 'alta');
});

test('nicho: fora do Legislativo, só o sinal central de processo legislativo conta', () => {
  for (const objeto of [
    'Locação de sistema integrado de gestão documental, protocolo eletrônico e portal da transparência',
    'Licença de uso de software de gestão de atos normativos e legislação compilada',
    'Contratação de software de contabilidade pública',
  ]) assert.equal(classify({ ...prefeitura, objeto }).label, 'fora', objeto);
  // associação/consórcio de câmaras comprando o produto do nicho
  assert.equal(classify({ ...prefeitura, objeto: 'Sistema de apoio ao processo legislativo para as câmaras consorciadas' }).label, 'alta');
});

test('nicho: na Câmara, compras que não são software ficam fora (mesmo citando suporte técnico ou treinamento)', () => {
  for (const objeto of [
    'Contratação de link de internet dedicado com suporte técnico',
    'Curso de treinamento para servidores em atendimento ao público',
    'Aquisição de certificados digitais e-CNPJ',
    'Aquisição de gabinetes e armários de aço',
    'Prestação de serviços de limpeza e conservação',
  ]) assert.equal(classify({ ...camara, objeto }).label, 'fora', objeto);
});

test('coleta guarda só o nicho e conta os descartes; mudança de estado de uma guardada continua sendo acompanhada', async () => {
  const env = makeStore();
  const n1 = normalizeProcurement(rec({ sequencialCompra: 1 }), 'x');
  const n2 = normalizeProcurement(rec({ sequencialCompra: 2, objeto: 'Serviços de limpeza', orgao: 'MUNICIPIO DE X' }), 'x');
  assert.equal(env.store.upsertProcurement(n1, { silent: false, level: 0, route: 'lista' }).created, true);
  const r2 = env.store.upsertProcurement(n2, { silent: false, level: 0, route: 'lista' });
  assert.equal(r2.discarded, true);
  assert.equal(listOpportunities(env.store, {}).total, 1);
  assert.equal(env.db.get<any>('SELECT COUNT(*) c FROM search_fts').c, 1);
});

test('acervo antigo: abertura do app reclassifica com as regras novas e remove o que é fora do nicho, preservando acompanhadas e decisões manuais', () => {
  const env = makeStore();
  env.settings.set({ guardarForaDoPerfil: true });
  const put = (seq: number, objeto: string) => env.store.upsertProcurement(normalizeProcurement(rec({ sequencialCompra: seq, objeto }), 'x'), { silent: true, level: 0, route: 'lista' }).id;
  const nicho = put(1, 'Software de processo legislativo');
  const lixo = put(2, 'Aquisição de tendas sanfonadas');
  const acompanhada = put(3, 'Aquisição de café');
  const manual = put(4, 'Aquisição de água mineral');
  env.store.setWatch(acompanhada, { status: 'analise' });
  env.store.setManualLabel(manual, 'revisar');
  // simula classificação feita por versão anterior das regras
  env.db.run("UPDATE classifications SET rules_version='2026.11.1'");
  env.settings.set({ guardarForaDoPerfil: false });
  const engine = new SyncEngine({ store: env.store, connector: { id: 'pncp' } as any, clock: env.clock.now });
  upgradeClassification(env.store, engine);
  const ids = env.db.all<any>('SELECT id FROM procurements ORDER BY id').map((r) => r.id);
  assert.deepEqual(ids, [nicho, acompanhada, manual]);
  assert.ok(!ids.includes(lixo));
  assert.equal(env.db.get<any>("SELECT COUNT(*) c FROM classifications WHERE rules_version='2026.11.1'").c, 0);
  assert.equal(env.db.get<any>('SELECT COUNT(*) c FROM search_fts').c, 3);
});
