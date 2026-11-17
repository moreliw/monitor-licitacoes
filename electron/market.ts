/**
 * Mercado de software: detecta contratações de software em TODO o PNCP coletado (qualquer órgão)
 * e as agrupa por categoria de produto, para mapear demanda além do nicho legislativo.
 * Padrões aplicados ao texto normalizado (minúsculo, sem acentos, pontuação vira espaço).
 */
import { normalizeText } from './classify.ts';

export const MARKET_VERSION = '2026.11.2';

export interface MarketCategory { id: string; label: string; pattern: RegExp }

const re = (s: string) => new RegExp(s, 'u');

/** Evidência de que o objeto é software (e não "sistema de som", "plataforma elevatória"...). */
const SOFTWARE = re(
  '\\b(?:softwares?|saas|software como servico|licencas? de uso|licenciamento (?:de uso|de softwares?|de sistemas?)|cessao de direito de uso|cessao de uso de (?:softwares?|sistemas?|licencas?|programas?)' +
  '|locacao de (?:softwares?|sistemas?|licencas?|programas?|solucao)|sistemas? (?:informatizados?|integrados? de gestao|de gestao|web|em nuvem|computacional|eletronicos? de (?:gestao|registro|controle))' +
  '|plataforma (?:digital|web|online|on line|tecnologica|de software|em nuvem|educacional|de ensino)|aplicativos? (?:movel|moveis|mobile|para)|aplicacao web' +
  '|solucao (?:tecnologica|digital|web|de software|integrada de gestao|em nuvem)|desenvolvimento de (?:softwares?|sistemas?|aplicativos?|aplicacoes|plataforma)' +
  '|fabrica de software|computacao em nuvem|servicos? de nuvem|cloud|subscricao de licencas?|assinatura de (?:software|licencas?|plataforma)|business intelligence|inteligencia artificial' +
  '|microsoft|office 365|google workspace|adobe|autocad|autodesk|kaspersky|antivirus|vmware|sql server)'
);

/** Usos comuns de "sistema"/"plataforma" que não são software. */
const NOT_SOFTWARE = re(
  '\\b(?:sistemas? (?:de som|de sonorizacao|de microgeracao|de geracao|de ar condicionado|de climatizacao|de refrigeracao|de bombeamento|de abastecimento de agua|de esgoto|fotovoltaicos?|de energia solar|de iluminacao|de irrigacao|de drenagem|de aterramento|de protecao contra descargas|de alarme|de combate a incendio|de hemodialise|construtivos?)' +
  '|plataformas? elevatorias?|plataforma de trabalho aereo)'
);

/** Ordem = prioridade para a categoria principal. */
export const CATEGORIES: MarketCategory[] = [
  { id: 'legislativo', label: 'Legislativo (processo legislativo, plenário)', pattern: re('\\b(?:processos? legislativos?|gestao legislativa|tramitacao legislativa|materias legislativas|software legislativo|sistema legislativo|votacao eletronica|painel de votacao|plenario)') },
  // produtos de prateleira/segurança vêm antes dos domínios: o objeto costuma citar a secretaria
  // ("licenças Microsoft para a Secretaria de Saúde" é demanda de licença, não de sistema de saúde)
  { id: 'prateleira', label: 'Licenças de prateleira (Microsoft, Google, Adobe, CAD, design)', pattern: re('\\b(?:microsoft|office 365|pacote office|windows|google workspace|adobe|autocad|autodesk|corel|zoom|teamviewer|sql server|oracle|vmware|red hat|canva|pipefy|design visual|edicao de video|producao musical)') },
  { id: 'seguranca-ti', label: 'Segurança da informação (antivírus, firewall, backup)', pattern: re('\\b(?:antivirus|firewall|endpoint|seguranca da informacao|seguranca cibernetica|ciberseguranca|backup|siem|waf|cdn|ddos|negacao de servico|observabilidade)') },
  { id: 'saude', label: 'Saúde (prontuário, e-SUS, regulação, farmácia)', pattern: re('\\b(?:saude|prontuarios?|e ?sus|ubs|hospital\\w*|regulacao|farmacia|vacina\\w*|odontolog\\w*|laborator\\w*|samu|atencao basica|telemedicina)') },
  { id: 'educacao', label: 'Educação (gestão escolar, plataformas de ensino)', pattern: re('\\b(?:escola\\w*|educaciona\\w*|educacao|alunos?|matriculas?|diario de classe|ensino|ead|pedagogic\\w*|aprendizagem|professores?|merenda|transporte escolar)') },
  { id: 'erp', label: 'Gestão pública integrada (ERP, contabilidade, orçamento)', pattern: re('\\b(?:gestao publica|gestao administrativa|erp|contab\\w*|orcament\\w*|tesouraria|siafic|prestacao de contas|planejamento e orcamento|sistemas? integrados? de gestao|patrimonio|almoxarifado)') },
  { id: 'tributos', label: 'Tributação e arrecadação (ISS, IPTU, NFS-e)', pattern: re('\\b(?:tribut\\w*|iss(?:qn)?|iptu|itbi|nota fiscal|nfs ?e|arrecadacao|divida ativa|cadastro imobiliario|fiscalizacao fazendaria)') },
  { id: 'rh', label: 'RH, folha de pagamento e ponto', pattern: re('\\b(?:folha de pagamento|recursos humanos|gestao de pessoas|ponto eletronico|registro de ponto|e ?social|servidores publicos)') },
  { id: 'previdencia', label: 'Previdência própria (RPPS)', pattern: re('\\b(?:previdencia\\w*|rpps|aposentadorias?|pensoes)') },
  { id: 'assistencia', label: 'Assistência social', pattern: re('\\b(?:assistencia social|cadunico|cad unico|cras|creas|socioassistencia\\w*)') },
  { id: 'documental', label: 'Protocolo, processo eletrônico e gestão documental', pattern: re('\\b(?:protocolo|processos? (?:administrativos? )?eletronicos?|processos? digita\\w*|gestao (?:eletronica )?de documentos|gestao documental|ged|digitalizacao|assinaturas? (?:eletronicas?|digitais?))') },
  { id: 'transparencia', label: 'Transparência, e-SIC, ouvidoria e portais', pattern: re('\\b(?:transparencia|e ?sic|ouvidoria|portal (?:institucional|web|do cidadao|da transparencia)|sites?|websites?|hospedagem de sites?)') },
  { id: 'diario', label: 'Diário oficial e publicações', pattern: re('\\b(?:diario oficial|publicacao de atos|publicacoes oficiais)') },
  { id: 'compras', label: 'Compras, licitações e contratos', pattern: re('\\b(?:gestao de (?:licitacoes|compras|contratos)|contratac(?:ao|oes) publicas?|plataformas? de (?:compras|licitacoes|pregao|disputa)|software de (?:licitacoes|compras)|sistema de (?:compras|licitacoes))') },
  { id: 'juridico', label: 'Jurídico e procuradoria', pattern: re('\\b(?:procuradoria|juridic\\w*|processos judiciais|execucao fiscal|pesquisa de jurisprudencia)') },
  { id: 'atendimento', label: 'Atendimento ao cidadão, apps e chatbots', pattern: re('\\b(?:atendimento ao (?:cidadao|publico)|agendamento|chatbot|whatsapp|central de atendimento|call center|totens?|gerenciamento de filas|senhas)') },
  { id: 'frota', label: 'Frota, combustível e rastreamento', pattern: re('\\b(?:frotas?|combustivel|rastreamento|telemetria|veiculos?|manutencao veicular)') },
  { id: 'transito', label: 'Trânsito, multas e estacionamento', pattern: re('\\b(?:transito|multas?|radares?|talonario eletronico|estacionamento rotativo|zona azul)') },
  { id: 'geo', label: 'Geoprocessamento, obras e urbanismo', pattern: re('\\b(?:geoprocessamento|georreferenc\\w*|gis|sig|cadastro territorial|aprovacao de projetos|alvaras?|urbanismo|obras)') },
  { id: 'monitoramento', label: 'Videomonitoramento e segurança pública', pattern: re('\\b(?:videomonitoramento|cftv|reconhecimento facial|leitura de placas|cerco eletronico|seguranca publica|guarda municipal)') },
  { id: 'dados-ia', label: 'Dados, BI e inteligência artificial', pattern: re('\\b(?:inteligencia artificial|ia generativa|machine learning|business intelligence|bi|analytics|paineis? de indicadores|dashboards?|ciencia de dados)') },
  { id: 'desenvolvimento', label: 'Desenvolvimento e fábrica de software', pattern: re('\\b(?:desenvolvimento|fabrica de software|pontos? de funcao|sustentacao de sistemas|manutencao evolutiva|testes de software|customizacao de (?:sistemas?|software))') },
  { id: 'infra', label: 'Nuvem, hospedagem e infraestrutura', pattern: re('\\b(?:nuvem|cloud|hospedagem|data ?center|servidores? virtua\\w*|vps|colocation|storage|virtualizacao)') },
  { id: 'telecom', label: 'Telecom e conectividade', pattern: re('\\b(?:link|internet|telefonia|voip|pabx|mpls|sd ?wan|wi ?fi|conectividade)') },
  { id: 'outros', label: 'Outros softwares', pattern: re('.') },
];

export const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label]));

export interface MarketClassification { software: boolean; primary: string | null; categories: string[] }

export function classifyMarket(objeto: string | null | undefined, info?: string | null): MarketClassification {
  const text = normalizeText(`${objeto ?? ''} ${info ?? ''}`);
  if (!text || !SOFTWARE.test(text)) return { software: false, primary: null, categories: [] };
  // "sistema de som" etc. só exclui quando não há outra evidência explícita de software
  if (NOT_SOFTWARE.test(text) && !/\b(?:softwares?|saas|licencas? de uso|aplicativos?|plataforma digital)\b/u.test(text)) {
    return { software: false, primary: null, categories: [] };
  }
  const categories = CATEGORIES.filter((c) => c.id !== 'outros' && c.pattern.test(text)).map((c) => c.id);
  return { software: true, primary: categories[0] ?? 'outros', categories: categories.length ? categories : ['outros'] };
}

export const ESFERA_LABEL: Record<string, string> = { M: 'Municipal', E: 'Estadual', F: 'Federal', D: 'Distrital', N: 'Não informada' };
