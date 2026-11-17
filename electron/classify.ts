/**
 * Classificação de relevância por regras versionadas e editáveis.
 * Padrões são expressões regulares aplicadas ao texto NORMALIZADO (minúsculo, sem acentos,
 * pontuação e espaços colapsados). O trecho citado vem do texto original.
 */
export type Label = 'alta' | 'revisar' | 'fora' | 'pendente';
export type Group = 'central' | 'funcao' | 'tecnologia' | 'adjacente' | 'negativo' | 'auxiliar';

export interface Rule { id: string; group: Group; pattern: string; weight: number; label?: string }
export interface RuleSet {
  version: string;
  rules: Rule[];
  orgPatterns: string[];
  params: { funcoesMinimas: number };
}

export const LABEL_TEXT: Record<Label, string> = {
  alta: 'Alta relevância', revisar: 'Revisar', fora: 'Fora do perfil', pendente: 'Evidência pendente',
};

export const DEFAULT_RULES: RuleSet = {
  version: '2026.11.3',
  params: { funcoesMinimas: 2 },
  orgPatterns: [
    'camara municipal', 'camara de vereadores', 'camara legislativa', 'assembleia legislativa',
    'camara dos deputados', 'senado federal', 'poder legislativo', 'legislativo municipal',
  ],
  rules: [
    // Sinais centrais
    { id: 'central-sistema-pl', group: 'central', weight: 10, label: 'Sistema/software de processo legislativo',
      // "programa" ficou de fora: "Programa de Modernização do Processo Legislativo" é iniciativa, não software
      pattern: '\\b(?:software|sistema|solucao|aplicativo|aplicacao|plataforma)\\b(?:\\s+\\w+){0,8}?\\s+(?:processos? legislativos?|atividades? legislativas?|tramitacao legislativa|gestao legislativa|materias legislativas)' },
    { id: 'central-software-legislativo', group: 'central', weight: 10, label: 'Software/sistema legislativo',
      pattern: '\\b(?:softwares?|sistemas?|solucao|plataforma|aplicativo|aplicacao) (?:de gestao )?legislativ[oa]s?\\b' },
    { id: 'central-gestao-pl', group: 'central', weight: 10, label: 'Gestão de processo legislativo',
      pattern: '\\bgestao (?:de|do|dos|da) (?:processos? legislativos?|atividades? legislativas?)' },
    { id: 'central-gestao-poder-leg', group: 'central', weight: 10, label: 'Gestão de processos do Poder Legislativo',
      pattern: '\\bgestao (?:de|dos) processos? (?:\\w+ ){0,2}(?:do|de) poder legislativo' },
    { id: 'central-tramitacao', group: 'central', weight: 9, label: 'Tramitação legislativa',
      pattern: '\\btramitacao (?:legislativa|de materias legislativas|de proposicoes)' },
    { id: 'central-apoio-pl', group: 'central', weight: 10, label: 'Apoio ao processo legislativo',
      pattern: '\\bapoio ao processo legislativo' },
    { id: 'central-gerenciamento', group: 'central', weight: 10, label: 'Gerenciamento de atividades legislativas',
      pattern: '\\bgerenciamento de atividades legislativas' },
    { id: 'central-pl-eletronico', group: 'central', weight: 9, label: 'Processo legislativo eletrônico/digital',
      pattern: '\\bprocessos? legislativos? (?:eletronicos?|digita(?:l|is)|virtua(?:l|is)|informatizados?)' },
    // Funções
    { id: 'func-processo-leg', group: 'funcao', weight: 3, label: 'Processo legislativo', pattern: '\\bprocessos? legislativos?' },
    { id: 'func-materias', group: 'funcao', weight: 3, label: 'Matérias legislativas', pattern: '\\bmaterias? legislativas?' },
    { id: 'func-proposituras', group: 'funcao', weight: 3, label: 'Proposituras/proposições', pattern: '\\b(?:proposituras?|proposicoes|proposicao)\\b' },
    { id: 'func-gabinete', group: 'funcao', weight: 2, label: 'Gabinetes', pattern: '\\bgabinetes? (?:parlamentar(?:es)?|de vereadores?|virtua(?:l|is)|digita(?:l|is))' },
    { id: 'func-comissoes', group: 'funcao', weight: 2, label: 'Comissões', pattern: '\\bcomissoes (?:permanentes|tematicas|parlamentares|legislativas)' },
    { id: 'func-pauta', group: 'funcao', weight: 2, label: 'Pauta / ordem do dia', pattern: '\\b(?:ordem do dia|pauta de (?:votacao|sessao|sessoes)|pauta legislativa)' },
    { id: 'func-votacao', group: 'funcao', weight: 3, label: 'Votação digital', pattern: '\\bvotacao (?:digital|eletronica|on line|online|nominal|simbolica)' },
    { id: 'func-painel', group: 'funcao', weight: 2, label: 'Painel de plenário', pattern: '\\bpainel (?:de plenario|eletronico de votacao|de votacao)' },
    { id: 'func-atos', group: 'funcao', weight: 3, label: 'Atos normativos', pattern: '\\batos normativos' },
    { id: 'func-legcompilada', group: 'funcao', weight: 3, label: 'Legislação compilada', pattern: '\\b(?:legislacao compilada|compilacao de legislacao|consolidacao de normas)' },
    { id: 'func-executivo', group: 'funcao', weight: 2, label: 'Integração ao Executivo', pattern: '\\bintegracao (?:com|ao|do) (?:o )?(?:poder )?executivo' },
    { id: 'aux-parlamentares', group: 'auxiliar', weight: 0.5, label: 'Parlamentares/vereadores', pattern: '\\b(?:parlamentares|vereadores)\\b' },
    // Tecnologia e fornecimento
    { id: 'tec-software', group: 'tecnologia', weight: 1.5, label: 'Software / SaaS',
      pattern: '\\b(?:software|saas|aplicacao web|aplicativo|sistema (?:informatizado|web|integrado|de informacao|de gestao)|solucao (?:web|tecnologica|integrada))' },
    { id: 'tec-licenca', group: 'tecnologia', weight: 1.5, label: 'Licença / locação de sistema',
      // "licenciamento" sozinho também é o de veículos (IPVA): exige complemento de software
      pattern: '\\b(?:licencas? de (?:uso|software|programas?)|locacao de (?:software|sistemas?|licencas?|programas?)|licenciamento (?:de uso|de softwares?|de sistemas?|do software)|cessao de (?:direito de )?uso)' },
    { id: 'tec-desenvolvimento', group: 'tecnologia', weight: 1.5, label: 'Desenvolvimento / customização de sistema',
      pattern: '\\b(?:desenvolvimento|customizacao|criacao) de (?:software|sistemas?|solucao|aplicacao|plataforma)|\\bfabrica de software|\\bmanutencao (?:evolutiva |corretiva )?de (?:software|sistemas?)' },
    // Implantação/treinamento/hospedagem sozinhos não provam software (curso, link de internet etc.)
    { id: 'aux-implantacao', group: 'auxiliar', weight: 0.5, label: 'Implantação / migração / treinamento',
      pattern: '\\b(?:implantacao|migracao de dados|conversao de dados|treinamento|hospedagem|suporte tecnico)' },
    // Adjacentes
    { id: 'adj-portal', group: 'adjacente', weight: 1.5, label: 'Portal institucional', pattern: '\\bportal (?:institucional|web|da transparencia|eletronico|legislativo|do cidadao|da camara|de legislacao)' },
    { id: 'adj-transparencia', group: 'adjacente', weight: 1.5, label: 'Transparência / e-SIC / ouvidoria', pattern: '\\b(?:transparencia|e sic|esic|ouvidoria)\\b' },
    { id: 'adj-protocolo', group: 'adjacente', weight: 1.5, label: 'Protocolo', pattern: '\\bprotocolo(?: eletronico| digital| web)?\\b' },
    { id: 'adj-docs', group: 'adjacente', weight: 1.5, label: 'Gestão documental / processo eletrônico', pattern: '\\b(?:gestao (?:eletronica )?de documentos|gestao documental|processos? (?:eletronicos?|digitais?)|documentos digitais)' },
    { id: 'adj-admin', group: 'adjacente', weight: 1, label: 'Sistemas administrativos', pattern: '\\bsistemas? administrativos?' },
    // Auxiliares (não pontuam sozinhos)
    { id: 'aux-sapl', group: 'auxiliar', weight: 0.5, label: 'SAPL', pattern: '\\bsapl\\b' },
    { id: 'aux-catser', group: 'auxiliar', weight: 0.3, label: 'CATSER', pattern: '\\bcatser\\b' },
    // Falsos positivos
    { id: 'neg-contabil', group: 'negativo', weight: -4, label: 'Contabilidade', pattern: '\\b(?:contabil|contabilidade|contabilizacao)\\b' },
    { id: 'neg-folha', group: 'negativo', weight: -4, label: 'Folha de pagamento', pattern: '\\bfolha de pagamento' },
    { id: 'neg-assessoria', group: 'negativo', weight: -4, label: 'Assessoria jurídica/parlamentar', pattern: '\\bassessoria (?:juridica|parlamentar|legislativa|contabil)' },
    { id: 'neg-hardware', group: 'negativo', weight: -4, label: 'Hardware', pattern: '\\b(?:computadores?|notebooks?|impressoras?|monitores|servidores fisicos|toner|nobreak)\\b' },
    { id: 'neg-audiovisual', group: 'negativo', weight: -4, label: 'Audiovisual / transmissão de sessões', pattern: '\\b(?:audiovisual|transmissao (?:ao vivo )?(?:de|das|dos) (?:sessoes|sessao|plenario)|sonorizacao|equipamentos de audio|edicao de video|producao musical|trilhas? sonoras?|geracao de voz|caixas? de som)' },
    { id: 'neg-software-generico', group: 'negativo', weight: -4, label: 'Software de prateleira (e-mail, escritório, segurança, backup)',
      pattern: '\\b(?:e ?mail corporativo|google workspace|microsoft|office 365|pacote office|adobe|teamviewer|acesso remoto|kaspersky|antivirus|protecao digital|firewall|seguranca da informacao|seguranca de rede|backup|veeam|endpoint|infraestrutura de (?:ti|tecnologia))' },
    { id: 'neg-administrativo', group: 'negativo', weight: -4, label: 'Bens e serviços administrativos',
      pattern: '\\b(?:veiculos? automotor(?:es)?|locacao de veiculos?|combustivel|catracas?|controle de acesso de pedestres|ponto eletronico|registro de ponto|mobiliario)\\b' },
    { id: 'neg-obras', group: 'negativo', weight: -4, label: 'Obras / reforma', pattern: '\\b(?:obras?|reforma predial|construcao civil|engenharia)\\b' },
    { id: 'neg-infra', group: 'negativo', weight: -4, label: 'Infraestrutura / telecom / segurança',
      pattern: '\\b(?:link (?:de internet|dedicado)|acesso a internet|internet dedicada|telefonia|antivirus|certificados? digita(?:l|is)|cftv|videomonitoramento|cameras? de seguranca)' },
  ],
};

export function validateRuleSet(x: any): RuleSet {
  if (!x || typeof x !== 'object' || !Array.isArray(x.rules)) throw new Error('Conjunto de regras inválido: faltam "rules".');
  const groups = ['central', 'funcao', 'tecnologia', 'adjacente', 'negativo', 'auxiliar'];
  const ids = new Set<string>();
  for (const r of x.rules) {
    if (!r || typeof r.id !== 'string' || !groups.includes(r.group) || typeof r.pattern !== 'string' || typeof r.weight !== 'number') {
      throw new Error(`Regra inválida: ${JSON.stringify(r)?.slice(0, 120)}`);
    }
    if (ids.has(r.id)) throw new Error(`Regra duplicada: ${r.id}`);
    ids.add(r.id);
    if (r.pattern.length > 600) throw new Error(`Padrão muito longo em ${r.id}`);
    try { new RegExp(r.pattern, 'u'); } catch (e) { throw new Error(`Padrão inválido em ${r.id}: ${(e as Error).message}`); }
  }
  for (const p of x.orgPatterns ?? []) if (typeof p !== 'string') throw new Error('orgPatterns inválido');
  return {
    version: String(x.version ?? 'custom'),
    rules: x.rules,
    orgPatterns: x.orgPatterns ?? DEFAULT_RULES.orgPatterns,
    params: { funcoesMinimas: Number(x.params?.funcoesMinimas ?? 2) },
  };
}

/** Normaliza (caixa, Unicode, acentos, pontuação, espaços) mantendo o mapa para o texto original. */
export function normalizeWithMap(text: string): { norm: string; map: number[] } {
  let norm = '';
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < text.length; i++) {
    const base = text[i].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    for (const ch of base) {
      if (/[\p{L}\p{N}]/u.test(ch)) { norm += ch; map.push(i); lastSpace = false; }
      else if (!lastSpace) { norm += ' '; map.push(i); lastSpace = true; }
    }
  }
  return { norm, map };
}

export function normalizeText(text: string): string {
  return normalizeWithMap(text).norm.trim();
}

export interface Evidence {
  ruleId: string;
  group: Group;
  label: string;
  weight: number;
  field: 'objeto' | 'informacao' | 'item' | 'documento' | 'orgao';
  snippet: string;
  source: string;
  page?: number;
  item?: number;
  documentId?: number;
}

export interface ClassifyInput {
  cnpj?: string | null;
  orgaoNome?: string | null;
  unidadeNome?: string | null;
  poder?: string | null;
  objeto?: string | null;
  info?: string | null;
  items?: { numero: number; descricao: string | null; info?: string | null }[];
  docs?: { documentId: number; titulo: string | null; page: number; text: string }[];
  /** Itens e/ou documentos já examinados. */
  enriched?: boolean;
  extraCnpjs?: string[];
}

export interface Classification {
  label: Label;
  score: number;
  evidences: Evidence[];
  needsEnrichment: boolean;
  legislativeOrg: boolean;
  rulesVersion: string;
}

const FIELD_WEIGHT = { objeto: 1, informacao: 1, item: 1, documento: 0.8, orgao: 1 } as const;
const compiled = new WeakMap<RuleSet, { rule: Rule; re: RegExp }[]>();
function compile(rs: RuleSet) {
  let c = compiled.get(rs);
  if (!c) { c = rs.rules.map((rule) => ({ rule, re: new RegExp(rule.pattern, 'gu') })); compiled.set(rs, c); }
  return c;
}

function snippet(orig: string, map: number[], norm: string, start: number, end: number): string {
  const a = map[Math.max(0, start)] ?? 0;
  const b = (map[Math.min(end - 1, map.length - 1)] ?? orig.length - 1) + 1;
  const from = Math.max(0, a - 70), to = Math.min(orig.length, b + 70);
  return (from > 0 ? '…' : '') + orig.slice(from, to).replace(/\s+/g, ' ').trim() + (to < orig.length ? '…' : '');
}

export function classify(input: ClassifyInput, rs: RuleSet = DEFAULT_RULES): Classification {
  const comp = compile(rs);
  const evidences: Evidence[] = [];

  const scan = (text: string | null | undefined, ctx: Pick<Evidence, 'field' | 'source'> & { page?: number; item?: number; documentId?: number }) => {
    if (!text) return;
    const { norm, map } = normalizeWithMap(text);
    for (const { rule, re } of comp) {
      re.lastIndex = 0;
      const m = re.exec(norm);
      if (m && m[0].length > 0) {
        evidences.push({
          ruleId: rule.id, group: rule.group, label: rule.label ?? rule.id, weight: rule.weight,
          snippet: snippet(text, map, norm, m.index, m.index + m[0].length), ...ctx,
        });
      }
    }
  };

  scan(input.objeto, { field: 'objeto', source: 'Objeto da contratação' });
  scan(input.info, { field: 'informacao', source: 'Informação complementar' });
  for (const it of input.items ?? []) {
    scan(it.descricao, { field: 'item', source: `Item ${it.numero}`, item: it.numero });
    if (it.info) scan(it.info, { field: 'item', source: `Item ${it.numero} (complemento)`, item: it.numero });
  }
  for (const d of input.docs ?? []) {
    scan(d.text, { field: 'documento', source: `${d.titulo ?? 'Documento'} · p. ${d.page}`, page: d.page, documentId: d.documentId });
  }

  // Órgão legislativo por contexto institucional.
  const orgText = normalizeText(`${input.orgaoNome ?? ''} | ${input.unidadeNome ?? ''}`);
  const orgHit = rs.orgPatterns.find((p) => orgText.includes(normalizeText(p)));
  const cnpj = input.cnpj?.toUpperCase();
  const registered = !!cnpj && (input.extraCnpjs ?? []).includes(cnpj);
  // Tribunais de Contas aparecem com poder "L" no PNCP, mas não são clientes de processo legislativo.
  const tribunalDeContas = /\btribunal de contas\b/.test(orgText);
  const legislativeOrg = registered || (!tribunalDeContas && (!!orgHit || input.poder === 'L'));
  if (legislativeOrg) {
    evidences.push({
      ruleId: 'org-legislativo', group: 'auxiliar', label: 'Órgão legislativo', weight: 2, field: 'orgao',
      snippet: [input.orgaoNome, input.unidadeNome].filter(Boolean).join(' — '),
      source: registered ? 'CNPJ cadastrado como legislativo' : orgHit ? `Contexto institucional: "${orgHit}"` : 'Poder = Legislativo',
    });
  }

  const hits = (g: Group) => evidences.filter((e) => e.group === g);
  const distinct = (g: Group) => new Set(hits(g).map((e) => e.ruleId)).size;
  const central = hits('central').length > 0;
  const funcs = distinct('funcao');
  const tech = distinct('tecnologia');
  const adj = distinct('adjacente');
  const negs = distinct('negativo');
  const enriched = !!input.enriched;

  let positive = 0;
  for (const e of evidences) if (e.weight > 0) positive += e.weight * FIELD_WEIGHT[e.field];
  // Penalidade só para escopo isolado: item/sinal qualificado protege o objeto mais amplo.
  // Penalidade só vale para escopo isolado: sinal central, duas funções legislativas ou uma solução
  // adjacente com software (ex.: protocolo com backup) protegem a oportunidade.
  const isolated = negs > 0 && !central && funcs < 2 && !(adj >= 1 && tech >= 1);
  let score = positive;
  if (isolated) for (const e of hits('negativo')) score += e.weight;
  score = Math.round(score * 10) / 10;

  let label: Label;
  let needsEnrichment = false;
  if (central) label = 'alta';
  else if (legislativeOrg && tech >= 1 && funcs >= rs.params.funcoesMinimas) label = 'alta';
  else if (isolated) label = 'fora';
  // Escopo: software para o Legislativo. Fora de órgão legislativo, só o sinal central conta.
  else if (!legislativeOrg) label = 'fora';
  else if (funcs >= 2 || (funcs >= 1 && (tech >= 1 || adj >= 1)) || (adj >= 1 && tech >= 1)) {
    label = 'revisar'; needsEnrichment = !enriched && funcs === 0;
  }
  else if (tech >= 1) { label = enriched ? 'fora' : 'pendente'; needsEnrichment = !enriched; }
  else label = 'fora';

  return { label, score, evidences, needsEnrichment, legislativeOrg, rulesVersion: rs.version };
}
