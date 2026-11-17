import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, normalizeWithMap, validateRuleSet, DEFAULT_RULES } from '../classify.ts';
import { makeStore, rec } from './helpers.ts';
import { normalizeProcurement } from '../pncp.ts';

const camara = { orgaoNome: 'CAMARA MUNICIPAL DE UNAI', unidadeNome: 'Câmara Municipal', poder: 'L', cnpj: '01512008000108' };

test('normalização mantém mapa para o texto original (acentos, pontuação)', () => {
  const { norm, map } = normalizeWithMap('  Gestão, do Processo-Legislativo! ');
  assert.equal(norm.trim(), 'gestao do processo legislativo');
  assert.equal(map.length, norm.length);
});

test('software legislativo explícito = alta relevância com trecho citado', () => {
  const c = classify({ ...camara, objeto: 'Contratação de serviços técnicos contínuos de software de processo legislativo para a Câmara.' });
  assert.equal(c.label, 'alta');
  const e = c.evidences.find((x) => x.group === 'central');
  assert.ok(e, 'deve haver evidência central');
  assert.match(e!.snippet, /software de processo legislativo/i);
  assert.equal(e!.field, 'objeto');
});

test('Boa Esperança do Iguaçu (caso real do PNCP) é alta relevância', () => {
  const n = normalizeProcurement(rec({ objeto: 'locação de software para controle do processo legislativo, através de ferramenta web, com Portal Web+Ouvidoria/e- Sic, Processo Legislativo, Protocolo, Votação On-line, Transmissão ao Vivo e Treinamento' }), 'x');
  const c = classify({ cnpj: n.cnpj, orgaoNome: n.orgaoNome, unidadeNome: n.unidadeNome, poder: n.poder, objeto: n.objeto });
  assert.equal(c.label, 'alta');
});

test('licenças genéricas em Câmara: evidência pendente, depois triagem com módulo comprovado em item', () => {
  const objeto = 'Pregão eletrônico: locação de licenças de programas';
  const antes = classify({ ...camara, objeto });
  assert.equal(antes.label, 'pendente');
  assert.equal(antes.needsEnrichment, true);
  const depois = classify({
    ...camara, objeto, enriched: true,
    items: [{ numero: 3, descricao: 'Gestão do processo legislativo — licença mensal', info: null }],
  });
  assert.ok(depois.label === 'alta' || depois.label === 'revisar');
  assert.equal(depois.evidences.find((e) => e.group === 'central')?.item, 3);
  // item/TR sem módulo legislativo: sai do radar
  const nada = classify({ ...camara, objeto, enriched: true, items: [{ numero: 1, descricao: 'Licença de antivírus', info: null }] });
  assert.equal(nada.label, 'fora');
});

test('módulo comprovado em termo de referência (página citada)', () => {
  const c = classify({
    ...camara, objeto: 'Locação de licenças de programas', enriched: true,
    docs: [{ documentId: 5, titulo: 'Termo de Referência', page: 12, text: 'LOTE 2 - Sistema de gestão do processo legislativo, com tramitação de matérias legislativas e votação eletrônica.' }],
  });
  assert.notEqual(c.label, 'fora');
  const ev = c.evidences.find((e) => e.field === 'documento');
  assert.equal(ev?.page, 12);
  assert.match(ev!.source, /Termo de Referência/);
});

test('transmissão de sessões isolada fica fora do alerta', () => {
  const c = classify({ ...camara, objeto: 'Contratação de empresa para transmissão ao vivo das sessões plenárias com equipamentos de áudio e vídeo (audiovisual).' });
  assert.equal(c.label, 'fora');
});

test('falsos positivos: contabilidade, folha, hardware, assessoria', () => {
  for (const objeto of [
    'Sistema de contabilidade pública e folha de pagamento para a Câmara Municipal',
    'Aquisição de computadores e impressoras',
    'Assessoria jurídica e parlamentar',
    'Reforma predial e obras de engenharia',
  ]) assert.equal(classify({ ...camara, objeto }).label === 'alta', false, objeto);
});

test('falsos positivos reais do PNCP: lanche para vereadores e veículo para a Câmara não entram na triagem', () => {
  for (const objeto of [
    'Correspondente a aquisição de gêneros de alimentação para servir aos vereadores e servidores da Câmara',
    'Aquisição de 01 (um) veículo automotor novo, tipo sedan, destinado ao atendimento dos parlamentares',
    'Prestação de serviços de assessoria e consultoria técnica em gestão documental à Câmara Municipal',
  ]) assert.equal(classify({ ...camara, objeto }).label, 'fora', objeto);
});

test('item qualificado dentro de objeto amplo com contabilidade não é descartado', () => {
  const c = classify({
    ...camara, objeto: 'Sistemas de contabilidade, folha de pagamento e processo legislativo', enriched: true,
    items: [{ numero: 4, descricao: 'Software de gestão do processo legislativo', info: null }],
  });
  assert.equal(c.label, 'alta');
});

test('norma citada no preâmbulo / frase genérica não é prova do nicho', () => {
  const c = classify({
    orgaoNome: 'PREFEITURA MUNICIPAL DE X', poder: 'E',
    objeto: 'Aquisição de material de expediente nos termos da legislação vigente e da Lei 14.133/2021.',
  });
  assert.equal(c.label, 'fora');
  assert.equal(classify({ orgaoNome: 'PREFEITURA', poder: 'E', objeto: 'Manutenção de ar condicionado, nos termos da legislação.' }).label, 'fora');
});

test('Marataízes/ES (caso real): software para gestão de processos do Poder Legislativo é sinal central', () => {
  const c = classify({ orgaoNome: 'CAMARA MUNICIPAL DE MARATAIZES', poder: 'L', objeto: 'II. Software para Gestão de Processos do Poder Legislativo, compreendendo a gestão dos processos administrativos e legislativos' });
  assert.equal(c.label, 'alta');
  assert.ok(c.evidences.some((e) => e.group === 'central' && /Poder Legislativo/i.test(e.snippet)));
});

test('Pedra Bonita: aplicação integrada de atividades legislativas', () => {
  const c = classify({
    orgaoNome: 'CAMARA MUNICIPAL DE PEDRA BONITA', poder: 'L',
    objeto: 'Contratação de aplicação integrada para gerenciamento de atividades legislativas, protocolo, comissões, parlamentares, normas, portal web e integração ao Executivo, com migração e manutenção.',
  });
  assert.equal(c.label, 'alta');
});

test('Ilha Comprida: SaaS de gestão documental para atividades legislativas vai para revisão', () => {
  const c = classify({
    orgaoNome: 'CAMARA MUNICIPAL DE ILHA COMPRIDA', poder: 'L',
    objeto: 'SaaS de gestão eletrônica de documentos e processos digitais para atividades administrativas e legislativas, com implantação, configuração, treinamento e suporte.',
  });
  assert.equal(c.label, 'revisar');
});

test('detecção de órgão legislativo por variantes, CNPJ cadastrado e sem exigir texto no objeto', () => {
  for (const o of ['CAMARA DE VEREADORES DE X', 'ASSEMBLEIA LEGISLATIVA DO ESTADO DE ES', 'CÂMARA LEGISLATIVA DO DF', 'CAMARA DOS DEPUTADOS', 'SENADO FEDERAL']) {
    assert.equal(classify({ orgaoNome: o, objeto: 'locação de software' }).legislativeOrg, true, o);
  }
  assert.equal(classify({ orgaoNome: 'ASSOCIACAO X', objeto: 'x', cnpj: '11222333000181', extraCnpjs: ['11222333000181'] }).legislativeOrg, true);
  assert.equal(classify({ orgaoNome: 'PREFEITURA', objeto: 'x' }).legislativeOrg, false);
});

test('regras editáveis: validação rejeita padrão inválido; reclassificar preserva decisão manual', () => {
  assert.throws(() => validateRuleSet({ rules: [{ id: 'a', group: 'central', pattern: '(', weight: 1 }] }));
  assert.throws(() => validateRuleSet({ rules: [{ id: 'a', group: 'xx', pattern: 'a', weight: 1 }] }));
  assert.ok(validateRuleSet(DEFAULT_RULES));

  const { store, settings } = makeStore();
  settings.set({ guardarForaDoPerfil: true });
  const n = normalizeProcurement(rec({ objeto: 'Aquisição de canetas' }), 'x');
  const r = store.upsertProcurement(n, { silent: false, level: 0, route: 'lista' });
  assert.equal(store.db.get<any>('SELECT relevance FROM procurements WHERE id=?', r.id)!.relevance, 'fora');
  store.setManualLabel(r.id, 'alta'); // promoção manual
  store.reclassify(r.id);
  store.reclassifyAll();
  assert.equal(store.db.get<any>('SELECT relevance FROM procurements WHERE id=?', r.id)!.relevance, 'alta');
  store.setManualLabel(r.id, null);
  assert.equal(store.db.get<any>('SELECT relevance FROM procurements WHERE id=?', r.id)!.relevance, 'fora');
});
