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

test('mercado: casos reais refinados (desenvolvimento, design, CDN/WAF, compras públicas)', () => {
  const cases: [string, string][] = [
    ['Contratação de serviços de tecnologia da informação para o desenvolvimento, manutenção, sustentação e testes de software', 'desenvolvimento'],
    ['Contratação de assinatura e licença de uso de software Canva Pro', 'prateleira'],
    ['Licenças de softwares para design visual', 'prateleira'],
    ['Software de serviço de CDN, WAF e mitigação de ataques de negação de serviço', 'seguranca-ti'],
    ['Plataforma eletrônica de contratação pública em ambiente web, modelo Software as a Service', 'compras'],
    ['Contratação de solução em modelo SaaS para gestão administrativa integrada', 'erp'],
  ];
  for (const [o, e] of cases) assert.equal(cat(o).primary, e, o);
  for (const o of [
    'Cessão de uso para a instalação de uma alfaiataria (artigos militares)',
    'Aquisição de Sistemas de Microgeração de Energia Elétrica a partir da fonte solar',
    'Locação de sistema de sonorização de pequeno porte',
  ]) assert.equal(cat(o).software, false, o);
});

test('mercado: mudança de regras recategoriza o acervo guardado', () => {
  const env = makeStore();
  env.store.recordMarket(normalizeProcurement(rec({ sequencialCompra: 1, objeto: 'Software de gestão de saúde' }), 'x'));
  env.store.recordMarket(normalizeProcurement(rec({ sequencialCompra: 2, objeto: 'Software de gestão de saúde' }), 'x'));
  env.db.run("UPDATE market_items SET rules_version='antiga', primary_category='outros' WHERE control_id LIKE '%000001/2026'");
  env.db.run("UPDATE market_items SET rules_version='antiga', objeto='Cessão de uso para alfaiataria' WHERE control_id LIKE '%000002/2026'");
  assert.deepEqual(env.store.reclassifyMarket(), { updated: 1, removed: 1 });
  assert.equal(env.db.get<any>('SELECT primary_category c FROM market_items').c, 'saude');
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
