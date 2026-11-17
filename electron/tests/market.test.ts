import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyMarket } from '../market.ts';
import { makeStore, rec, makeEngine, fakeFetch, page } from './helpers.ts';
import { normalizeProcurement } from '../pncp.ts';
import { marketOverview, marketList, marketCsv } from '../query.ts';

const cat = (objeto: string) => classifyMarket(objeto);

test('mercado: reconhece software e separa por categoria de produto', () => {
  const cases: [string, string][] = [
    ['Locação de sistema informatizado de gestão de saúde com prontuário eletrônico', 'saude'],
    ['Contratação de plataforma digital de ensino para alunos da rede municipal', 'educacao'],
    ['Licença de uso de software de gestão tributária, ISS e NFS-e', 'tributos'],
    ['Locação de sistema integrado de gestão pública: contabilidade, orçamento, tesouraria, tributos e folha', 'erp'],
    ['Software de folha de pagamento e recursos humanos', 'rh'],
    ['Licenças Microsoft Office 365 para a Secretaria de Saúde', 'prateleira'],
    ['Licença de software antivírus e firewall', 'seguranca-ti'],
    ['Locação de software de processo legislativo para a Câmara', 'legislativo'],
    ['Sistema web de protocolo e processo eletrônico com assinatura digital', 'documental'],
    ['Contratação de software de gestão de frota e abastecimento de combustível', 'frota'],
    ['Plataforma de inteligência artificial para análise de dados', 'dados-ia'],
    ['Licença de uso de software especializado', 'outros'],
  ];
  for (const [objeto, esperado] of cases) {
    const c = cat(objeto);
    assert.equal(c.software, true, objeto);
    assert.equal(c.primary, esperado, `${objeto} → ${c.primary}`);
  }
});

test('mercado: "sistema" que não é software fica fora', () => {
  for (const objeto of [
    'Aquisição de sistema de som para o auditório',
    'Instalação de sistema fotovoltaico',
    'Manutenção de sistema de ar condicionado',
    'Locação de plataforma elevatória',
    'Registro de preços para aquisição de material de limpeza',
    'Aquisição de computadores e notebooks',
  ]) assert.equal(cat(objeto).software, false, objeto);
  // evidência explícita de software vence
  assert.equal(cat('Software de gestão do sistema de abastecimento de água').software, true);
});

test('mercado: coleta registra software de qualquer órgão, mesmo o que sai do nicho, e agrega por categoria/UF/esfera', async () => {
  const env = makeStore();
  env.settings.set({ modalidades: [8], diasIniciais: 1, sobreposicaoDias: 1 });
  const p = (seq: number, objeto: string, uf: string, valor: number, orgao = 'MUNICIPIO DE X') =>
    rec({ sequencialCompra: seq, objeto, uf, valor, orgao, raw: { orgaoEntidade: { cnpj: `0000000000${String(seq).padStart(2, '0')}91`.slice(-14), razaoSocial: orgao, poderId: 'E', esferaId: 'M' } } });
  const pubs = [
    p(1, 'Locação de sistema de gestão de saúde', 'SP', 100000),
    p(2, 'Locação de sistema de gestão de saúde e regulação', 'MG', 50000),
    p(3, 'Licenças Microsoft Office 365', 'SP', 20000),
    p(4, 'Aquisição de canetas', 'SP', 500),
    p(5, 'Locação de software de processo legislativo', 'ES', 30000, 'CAMARA MUNICIPAL DE Y'),
  ];
  const f = fakeFetch({
    '/contratacoes/publicacao': () => ({ status: 200, body: page(pubs) }),
    '/contratacoes/atualizacao': () => ({ status: 204 }), '/contratacoes/proposta': () => ({ status: 204 }),
    '/itens': () => ({ status: 200, body: [] }), '/arquivos': () => ({ status: 200, body: [] }), '/compras/': () => ({ status: 404 }),
  });
  const { engine } = makeEngine(env, f);
  const st = await engine.runCycle('manual');
  assert.equal(st.software, 4);
  await engine.runCycle('manual'); // idempotente
  const o = marketOverview(env.store, {});
  assert.equal(o.kpis.total, 4);
  assert.equal(o.kpis.valor, 20_000_000);
  assert.equal(o.byCategory[0].id, 'saude');
  assert.equal(o.byCategory[0].n, 2);
  assert.equal(o.byUf[0].uf, 'SP');
  assert.ok(o.byEsfera.some((e: any) => e.label === 'Municipal'));
  assert.equal(marketList(env.store, { categoria: 'prateleira' }).total, 1);
  assert.equal(marketList(env.store, { text: 'regulação' }).total, 1);
  assert.equal(marketList(env.store, { uf: ['ES'] }).rows[0].primary_category, 'legislativo');
  assert.equal(marketList(env.store, { abertas: true }).total, 4);
  // o nicho continua só com o legislativo
  assert.equal(env.db.get<any>('SELECT COUNT(*) c FROM procurements').c, 1);
  assert.ok(marketCsv(env.store, {}).includes('Saúde'));
});

test('mercado: atualização antiga não sobrescreve a nova', () => {
  const env = makeStore();
  const novo = normalizeProcurement(rec({ sequencialCompra: 1, objeto: 'Software de gestão de saúde', atualizacao: '2026-11-17T10:00:00', valor: 999 }), 'x');
  const velho = normalizeProcurement(rec({ sequencialCompra: 1, objeto: 'Software de gestão de saúde', atualizacao: '2026-11-10T10:00:00', valor: 1 }), 'x');
  env.store.recordMarket(novo);
  env.store.recordMarket(velho);
  assert.equal(env.db.get<any>('SELECT valor_estimado_cents v FROM market_items').v, 99900);
});
