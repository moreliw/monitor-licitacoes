/**
 * Aderência de cada oportunidade ao Ágil (sistema de processo legislativo da Moreli.Dev).
 *
 * O catálogo diz, por tema exigido em edital, em que pé o Ágil está. Ele espelha o relatório de requisitos
 * do repositório do Ágil (`docs/implementation/requisitos/relatorio-requisitos.md`) na data de `AGIL_CATALOG_DATE`.
 * Quando uma entrega mudar de situação lá, atualize `situacao` aqui e incremente `AGIL_VERSION`: a abertura do app
 * recalcula a aderência de todo o acervo.
 *
 * Padrões são aplicados ao texto NORMALIZADO (minúsculo, sem acento, pontuação virando espaço).
 */
import { normalizeText } from './classify.ts';

export const AGIL_VERSION = '2026.11.26-1';
export const AGIL_CATALOG_DATE = '2026-11-26';

/** pronto = código entregue (aceite pendente); parcial = em andamento; falta = não iniciado; fora = fora do produto. */
export type Situacao = 'pronto' | 'parcial' | 'falta' | 'fora';
export type Natureza = 'nucleo' | 'plenario' | 'complemento' | 'operacao' | 'fora';
export type Aderencia = 'nucleo' | 'plenario' | 'compilacao' | 'complemento' | 'condicionada' | 'fora';

export interface Tema { id: string; label: string; natureza: Natureza; situacao: Situacao; entrega: string; pattern: string }

export const AGIL_TEMAS: Tema[] = [
  // Núcleo: processo legislativo
  { id: 'gestao_leg', label: 'Gestão do processo legislativo', natureza: 'nucleo', situacao: 'parcial', entrega: 'L089',
    pattern: '\\b(?:processos? legislativos?|gestao legislativa|atividades? legislativas?|sistemas? legislativos?|softwares? legislativos?|producao legislativa|materias legislativas|apoio ao processo legislativo)' },
  { id: 'proposicoes', label: 'Proposições (projetos, indicações, requerimentos, moções)', natureza: 'nucleo', situacao: 'parcial', entrega: 'L004/L034',
    pattern: '\\bmoc(?:ao|oes)\\b|\\bindicac(?:ao|oes) (?:parlamentar|legislativa|de vereador)|\\bprojetos? de (?:lei|resolucao|decreto legislativo)|\\bproposic(?:ao|oes)\\b|\\bproposituras?\\b' },
  { id: 'tramitacao', label: 'Tramitação legislativa', natureza: 'nucleo', situacao: 'parcial', entrega: 'L031', pattern: '\\btramitac' },
  { id: 'protocolo', label: 'Protocolo eletrônico e comprovante', natureza: 'nucleo', situacao: 'parcial', entrega: 'L029',
    pattern: '\\bprotocolo (?:eletronico|digital|online|on line|web|geral|legislativo)|\\bcomprovante de protocolo|\\brecibo de protocolo' },
  { id: 'comissoes', label: 'Comissões e pareceres', natureza: 'nucleo', situacao: 'falta', entrega: 'L047/L048',
    pattern: '\\bcomiss(?:ao|oes) (?:permanentes?|tecnicas?|de justica|de constituicao|de financas)|\\bpareceres? (?:da|das|de) comiss|\\breunio(?:es)? (?:da|das) comiss' },
  { id: 'emendas_prop', label: 'Emendas, substitutivos e redação final', natureza: 'nucleo', situacao: 'pronto', entrega: 'L056',
    pattern: '\\bredacao final|\\bemendas? (?:modificativa|aditiva|supressiva|substitutiva|aglutinativa)|\\bsubemenda|\\bsubstitutivo' },
  { id: 'executivo', label: 'Autógrafo, sanção e veto (Executivo)', natureza: 'nucleo', situacao: 'parcial', entrega: 'L046',
    pattern: '\\bautografo|\\bsancao\\b|\\bvetos?\\b|\\bintegracao com (?:o poder executivo|a prefeitura)' },
  { id: 'compilacao', label: 'Compilação e consolidação de normas', natureza: 'nucleo', situacao: 'pronto', entrega: 'L055/L081',
    pattern: '\\bcompilac|\\bconsolidac(?:ao|oes) (?:da|das|de) (?:leis|normas|legislacao)|\\btexto (?:compilado|consolidado)|\\blegislacao compilada|\\brepositorio legislativo' },
  { id: 'prazos', label: 'Prazos regimentais e calendário', natureza: 'nucleo', situacao: 'parcial', entrega: 'L036',
    pattern: '\\bcontrole de prazos|\\bprazos? regimenta|\\bprazo de tramitacao' },
  { id: 'editor', label: 'Editor e modelos de documentos', natureza: 'nucleo', situacao: 'falta', entrega: 'L024/L025',
    pattern: '\\beditor (?:de texto|online|integrado|de documentos)|\\bmodelos? de documentos' },
  { id: 'icp', label: 'Assinatura ICP-Brasil (A1/A3, PAdES)', natureza: 'nucleo', situacao: 'falta', entrega: 'L038/L039',
    pattern: '\\bicp ?brasil|\\bassinatura (?:digital|eletronica qualificada)|\\bpades\\b|\\btoken\\b|\\bsmart ?card' },
  { id: 'qr', label: 'Selo/QR e validação pública', natureza: 'nucleo', situacao: 'parcial', entrega: 'L037',
    pattern: '\\bqr ?code|\\bcodigo qr|\\bcodigo (?:de )?verificacao|\\bverificar a autenticidade|\\bvalidacao (?:publica|de autenticidade)' },
  { id: 'arquivo', label: 'Arquivo: classificação e temporalidade', natureza: 'nucleo', situacao: 'parcial', entrega: 'L019/L020',
    pattern: '\\btemporalidade|\\bplano de classificacao|\\bclassificacao arquivistica|\\be ?arq\\b|\\bconarq' },
  { id: 'busca', label: 'Pesquisa textual avançada', natureza: 'nucleo', situacao: 'parcial', entrega: 'L017',
    pattern: '\\bpesquisa (?:textual|avancada|full|por palavra)|\\bbusca (?:avancada|textual|por conteudo|full)' },
  { id: 'portal', label: 'Portal legislativo', natureza: 'nucleo', situacao: 'parcial', entrega: 'L057',
    pattern: '\\bportal (?:legislativo|da camara|de legislacao)|\\bconsulta publica (?:de|das) (?:materias|proposicoes|normas)' },
  { id: 'ged', label: 'GED, OCR e PDF/A', natureza: 'nucleo', situacao: 'falta', entrega: 'L015/L016',
    pattern: '\\bged\\b|\\bgestao eletronica de documentos|\\bocr\\b|\\bpdf a\\b' },
  // Plenário
  { id: 'pauta', label: 'Pauta e ordem do dia', natureza: 'plenario', situacao: 'parcial', entrega: 'L049', pattern: '\\bordem do dia|\\bpautas?\\b|\\bpequeno expediente|\\bgrande expediente' },
  { id: 'votacao', label: 'Votação eletrônica (nominal, secreta, simbólica)', natureza: 'plenario', situacao: 'parcial', entrega: 'L050/L053',
    pattern: '\\bvotac(?:ao|oes) (?:eletronica|nominal|secreta|simbolica|digital|on line|online)|\\bvoto (?:nominal|secreto)|\\bsistema de votacao' },
  { id: 'painel', label: 'Painel e telão em tempo real', natureza: 'plenario', situacao: 'parcial', entrega: 'L051',
    pattern: '\\bpainel (?:eletronico|de votacao|de plenario|do plenario|multimidia)|\\btelao|\\btempo real' },
  { id: 'quorum', label: 'Presença e quórum', natureza: 'plenario', situacao: 'parcial', entrega: 'L050',
    pattern: '\\bquorum|\\bregistro (?:eletronico )?de presenca|\\blista de presenca|\\bcontrole de presenca' },
  { id: 'oradores', label: 'Oradores, apartes e cronômetro', natureza: 'plenario', situacao: 'parcial', entrega: 'L052',
    pattern: '\\bcronometr|\\btempo de (?:fala|pronunciamento)|\\bapartes?\\b|\\binscricao (?:de|dos) oradores|\\buso da palavra|\\btribuna\\b' },
  { id: 'atas', label: 'Atas geradas pela sessão', natureza: 'plenario', situacao: 'pronto', entrega: 'L054',
    pattern: '\\bpre ?atas?\\b|\\bminuta da ata|\\bata da sessao|\\batas das sessoes|\\bgeracao (?:automatica )?da ata|\\bata (?:eletronica|automatica)' },
  { id: 'tablet', label: 'Tablet / app do parlamentar', natureza: 'plenario', situacao: 'falta', entrega: 'L051/L063/L064',
    pattern: '\\btablets?\\b|\\btabletes\\b|\\bterminais? (?:de votacao|individuais)|\\baplicativo (?:movel|mobile|para (?:android|ios|smartphone|celular))|\\bandroid\\b|\\bplay store|\\bapp store' },
  { id: 'transmissao', label: 'Transmissão das sessões', natureza: 'plenario', situacao: 'falta', entrega: 'L060',
    pattern: '\\btransmiss(?:ao|oes) (?:ao vivo|em tempo real|das sessoes|online)|\\byoutube|\\bstreaming' },
  { id: 'remota', label: 'Sessão remota ou híbrida', natureza: 'plenario', situacao: 'falta', entrega: 'novo',
    pattern: '\\bsess(?:ao|oes) (?:remota|virtual|hibrida|semipresencial)s?|\\bvideoconferencia|\\bdeliberacao remota|\\bparticipacao remota' },
  // Complementos legislativos
  { id: 'transcricao', label: 'Transcrição de áudio e vídeo', natureza: 'complemento', situacao: 'falta', entrega: 'L070/L071', pattern: '\\btranscric|\\bdegravac|\\breconhecimento de (?:voz|fala)' },
  { id: 'ia', label: 'Inteligência artificial', natureza: 'complemento', situacao: 'falta', entrega: 'L072/L073', pattern: '\\binteligencia artificial|\\bia generativa|\\bllm\\b|\\bmachine learning' },
  { id: 'diario', label: 'Diário Oficial eletrônico', natureza: 'complemento', situacao: 'falta', entrega: 'L062/L068', pattern: '\\bdiario oficial|\\bdiario eletronico|\\bdom sc\\b|\\bdiario dos municipios' },
  { id: 'api', label: 'APIs e dados abertos', natureza: 'complemento', situacao: 'falta', entrega: 'L066', pattern: '\\bdados abertos|\\bapis?\\b|\\bweb ?services?|\\binteroperab|\\bjson\\b|\\bxml\\b' },
  { id: 'participacao', label: 'Participação cidadã', natureza: 'complemento', situacao: 'parcial', entrega: 'L058',
    pattern: '\\bparticipacao (?:popular|cidada)|\\benquetes?\\b|\\bbanco de ideias|\\bvereador mirim|\\bparlamento jovem|\\bcamara mirim' },
  { id: 'emendas_orc', label: 'Emendas impositivas e parcerias com OSC', natureza: 'complemento', situacao: 'falta', entrega: 'L069',
    pattern: '\\bemendas? (?:impositivas?|parlamentares?)\\b(?! a )|\\btransferencias especiais|\\bmrosc\\b|\\borganizac(?:ao|oes) da sociedade civil' },
  { id: 'gabinete', label: 'Gabinete parlamentar', natureza: 'complemento', situacao: 'falta', entrega: 'novo',
    pattern: '\\bgabinete (?:parlamentar|virtual|do vereador)|\\bpainel do parlamentar|\\bagenda (?:do|dos) vereador|\\batendimento ao (?:cidadao|eleitor)' },
  { id: 'notificacao', label: 'Notificações (e-mail, push, WhatsApp)', natureza: 'complemento', situacao: 'falta', entrega: 'L059',
    pattern: '\\bnotificac(?:ao|oes) (?:automatica|por e ?mail|push|eletronica|aos usuarios)|\\balertas? (?:por|via) e ?mail|\\bwhatsapp|\\bsms\\b' },
  { id: 'relatorios', label: 'Relatórios gerenciais e estatísticas', natureza: 'complemento', situacao: 'falta', entrega: 'L074', pattern: '\\brelatorios? (?:gerenciais|estatisticos)|\\bestatisticas|\\bdashboards?' },
  { id: 'govbr', label: 'Login Gov.br / SSO', natureza: 'complemento', situacao: 'falta', entrega: 'L009',
    pattern: '\\b(?:login|autenticacao|acesso|conta|integracao) (?:pelo|via|com|do|ao) gov br|\\blogin unico|\\bsingle sign|\\bsso\\b|\\bldap\\b|\\bactive directory' },
  { id: 'carimbo', label: 'Carimbo do tempo', natureza: 'complemento', situacao: 'falta', entrega: 'L042', pattern: '\\bcarimbo (?:do|de) tempo' },
  // Operação e habilitação (aparecem em quase todo edital)
  { id: 'migracao', label: 'Migração e conversão de dados', natureza: 'operacao', situacao: 'falta', entrega: 'L014', pattern: '\\bmigracao|\\bconversao (?:de|dos) dados|\\bimportacao (?:de|dos) dados|\\bsapl\\b|\\binterlegis' },
  { id: 'hospedagem', label: 'Hospedagem, SLA e backup', natureza: 'operacao', situacao: 'falta', entrega: 'L011/L012', pattern: '\\bbackup|\\bcopia de seguranca|\\bdata ?center|\\bsla\\b|\\bnuvem|\\bcloud' },
  { id: 'suporte', label: 'Suporte técnico e chamados', natureza: 'operacao', situacao: 'falta', entrega: 'L077', pattern: '\\bsuporte tecnico|\\bchamados|\\bhelp ?desk|\\b0800\\b' },
  { id: 'treinamento', label: 'Implantação e treinamento', natureza: 'operacao', situacao: 'falta', entrega: 'L078', pattern: '\\btreinamento|\\bcapacitac' },
  { id: 'poc', label: 'Prova de conceito', natureza: 'operacao', situacao: 'falta', entrega: 'L086', pattern: '\\bprova de conceito|\\bpoc\\b' },
  { id: 'acessibilidade', label: 'Acessibilidade (e-MAG, WCAG, VLibras)', natureza: 'operacao', situacao: 'falta', entrega: 'L075', pattern: '\\bacessibilidade|\\bwcag\\b|\\be ?mag\\b|\\bvlibras|\\bleitor de tela' },
  { id: 'lgpd', label: 'LGPD e segurança', natureza: 'operacao', situacao: 'parcial', entrega: 'L010', pattern: '\\blgpd\\b|\\b13 ?709\\b|\\bprotecao de dados pessoais' },
  // Fora do produto (parceria, consórcio ou módulo de enquadramento)
  { id: 'esic', label: 'e-SIC / LAI / ouvidoria', natureza: 'fora', situacao: 'fora', entrega: 'enquadramento', pattern: '\\be ?sic\\b|\\blei de acesso a informacao|\\b12 ?527\\b|\\bouvidoria' },
  { id: 'portal_inst', label: 'Portal institucional (CMS)', natureza: 'fora', situacao: 'fora', entrega: 'enquadramento',
    pattern: '\\bportal (?:institucional|web)|\\bsite institucional|\\bsitio (?:eletronico|oficial)|\\bweb ?site\\b' },
  { id: 'transparencia', label: 'Portal da transparência (LC 131)', natureza: 'fora', situacao: 'fora', entrega: 'parceria',
    pattern: '\\bportal da transparencia|\\blei complementar (?:n[o ] ?)?131\\b|\\bpntp\\b|\\batricon' },
  { id: 'processo_adm', label: 'Processo administrativo eletrônico', natureza: 'fora', situacao: 'fora', entrega: 'enquadramento',
    pattern: '\\bprocessos? administrativos? (?:eletronicos?|digita(?:l|is))|\\bsistemas? administrativos?|\\bprotocolos? administrativos?' },
  { id: 'email', label: 'Contas de e-mail institucional', natureza: 'fora', situacao: 'fora', entrega: 'revenda', pattern: '\\bcorreio eletronico institucional|\\bcontas de e ?mail|\\be ?mail institucional' },
  { id: 'erp', label: 'ERP (contabilidade, folha, compras, patrimônio)', natureza: 'fora', situacao: 'fora', entrega: 'parceria',
    pattern: '\\bfolha de pagamento|\\bcontabilidade|\\bcontabil\\b|\\bpatrimonio\\b|\\balmoxarifado|\\bcompras e licitacoes|\\bfrota\\b|\\btesouraria|\\brecursos humanos' },
  { id: 'equip', label: 'Equipamentos de plenário (áudio, vídeo, hardware)', natureza: 'fora', situacao: 'fora', entrega: 'parceria',
    pattern: '\\bmicrofones?|\\bcameras?\\b|\\btelevisor|\\bsonorizacao|\\bcabeamento|\\bmesa de som|\\bequipamentos de (?:audio|video)|\\baudiovisual' },
  { id: 'legado', label: 'Manutenção de sistema legado de outro fornecedor', natureza: 'fora', situacao: 'fora', entrega: 'L083',
    pattern: '\\bversao executavel|\\bja e de propriedade da camara|\\bmanutencao (?:mensal )?e suporte tecnico especializado nos softwares|\\b(?:suporte|manutencao|sustentacao)(?: e \\w+){0,2} (?:dos|do) sistemas? (?:legislativos? )?(?:interlegis|sapl)' },
  { id: 'publicidade', label: 'Publicidade e mídia', natureza: 'fora', situacao: 'fora', entrega: 'fora',
    pattern: '\\bespacos publicitarios|\\bpublicidade institucional|\\bveiculacao de publicidade|\\bmidia (?:impressa|televisiva)' },
  { id: 'servico_doc', label: 'Digitalização e serviço documental', natureza: 'fora', situacao: 'fora', entrega: 'parceria',
    pattern: '\\bdigitalizac(?:ao|oes) (?:de|do|dos) (?:documentos|acervo)|\\bhigienizacao|\\bbiblioteca|\\bwinisis|\\bcds isis' },
];

const COMPILED = AGIL_TEMAS.map((t) => ({ t, re: new RegExp(t.pattern, 'g') }));

export interface TemaHit { id: string; label: string; natureza: Natureza; situacao: Situacao; entrega: string; noObjeto: boolean; mencoes: number }
export interface AgilFit {
  version: string;
  aderencia: Aderencia;
  score: number;
  resumo: string;
  temas: TemaHit[];
  /** Temas fora do produto que o lote pede (precisam de parceiro, revenda ou módulo de enquadramento). */
  bloqueios: string[];
  /** Temas do produto ainda não entregues. */
  lacunas: string[];
}

export interface AgilInput {
  objeto?: string | null;
  info?: string | null;
  items?: (string | null)[];
  docs?: string[];
  /** Relevância legislativa já calculada pelo classificador. */
  relevance?: string | null;
}

export const ADERENCIA_TEXT: Record<Aderencia, string> = {
  nucleo: 'Processo legislativo', plenario: 'Plenário', compilacao: 'Compilação de normas',
  complemento: 'Complemento legislativo', condicionada: 'Condicionada', fora: 'Fora do Ágil',
};
export const SITUACAO_TEXT: Record<Situacao, string> = { pronto: 'Entregue', parcial: 'Em andamento', falta: 'A desenvolver', fora: 'Fora do produto' };

function count(re: RegExp, text: string): number {
  re.lastIndex = 0;
  let n = 0;
  while (re.exec(text) && n < 50) n++;
  return n;
}

/** Calcula a aderência ao Ágil a partir do objeto, itens e texto dos documentos. */
export function agilFit(input: AgilInput): AgilFit {
  const head = normalizeText([input.objeto, input.info, ...(input.items ?? [])].filter(Boolean).join(' \n '));
  const body = normalizeText((input.docs ?? []).join(' \n ')).slice(0, 2_000_000);
  const temas: TemaHit[] = [];
  for (const { t, re } of COMPILED) {
    const h = count(re, head);
    const b = body ? count(re, body) : 0;
    // no objeto basta uma menção; nos documentos, duas (evita citação solta em cláusula padrão)
    if (h >= 1 || b >= 2) temas.push({ id: t.id, label: t.label, natureza: t.natureza, situacao: t.situacao, entrega: t.entrega, noObjeto: h >= 1, mencoes: h + b });
  }
  const has = (id: string) => temas.find((x) => x.id === id);
  const of = (n: Natureza) => temas.filter((x) => x.natureza === n);
  const nucleo = of('nucleo'), plenario = of('plenario'), complemento = of('complemento'), fora = of('fora');
  const coreObj = [...nucleo, ...plenario].filter((x) => x.noObjeto).length;

  const erp = has('erp');
  const erpForte = !!erp && (erp.noObjeto || erp.mencoes >= 8) && !(coreObj >= 2 && erp.mencoes < 4);
  const equip = has('equip');
  const equipForte = !!equip && (equip.noObjeto || equip.mencoes >= 10);
  const servicoDoc = has('servico_doc');

  const plenSinal = plenario.filter((x) => ['votacao', 'painel', 'quorum', 'oradores', 'tablet'].includes(x.id)).length;
  const procSinal = nucleo.filter((x) => ['gestao_leg', 'proposicoes', 'tramitacao', 'protocolo', 'comissoes', 'emendas_prop', 'executivo'].includes(x.id)).length;
  const compil = has('compilacao');

  const plenObj = plenario.some((x) => x.noObjeto && x.id !== 'pauta');
  const complObj = complemento.some((x) => x.noObjeto);

  let aderencia: Aderencia;
  if (input.relevance === 'fora' && procSinal + plenSinal === 0 && !compil?.noObjeto) aderencia = 'fora';
  else if (compil?.noObjeto && coreObj <= 1 && !plenObj) aderencia = 'compilacao';
  else if (procSinal + plenSinal === 0 && compil) aderencia = 'compilacao';
  else if (procSinal === 0 && plenSinal === 0) aderencia = complObj ? 'complemento' : 'fora';
  // objeto sem sinal legislativo: o edital precisa mostrar o núcleo com folga (evita cláusula genérica de TR)
  else if (coreObj === 0 && complObj) aderencia = 'complemento';
  else if (coreObj === 0 && procSinal + plenSinal < 3) aderencia = 'fora';
  else if (plenSinal >= 2 && (procSinal === 0 || (plenObj && !nucleo.some((x) => x.noObjeto && x.id !== 'portal')))) aderencia = 'plenario';
  else aderencia = 'nucleo';
  if ((servicoDoc?.noObjeto && coreObj === 0) || has('publicidade')?.noObjeto) aderencia = 'fora';
  if (aderencia !== 'fora' && (erpForte || equipForte || has('legado')?.noObjeto)) aderencia = 'condicionada';

  const produto = temas.filter((x) => x.natureza !== 'fora' && x.natureza !== 'operacao');
  const cobertos = produto.filter((x) => x.situacao === 'pronto' || x.situacao === 'parcial');
  const lacunas = produto.filter((x) => x.situacao === 'falta').map((x) => x.label);
  const bloqueios = fora.map((x) => x.label);

  const base: Record<Aderencia, number> = { nucleo: 70, plenario: 72, compilacao: 62, complemento: 40, condicionada: 35, fora: 0 };
  let score = base[aderencia];
  if (aderencia !== 'fora') {
    const pontos = produto.reduce((s, x) => s + (x.situacao === 'pronto' ? 1 : x.situacao === 'parcial' ? 0.6 : 0), 0);
    score += produto.length ? Math.round(20 * (pontos / produto.length)) : 0;
    score -= Math.min(15, bloqueios.length * 4);
    if (input.relevance === 'alta') score += 8;
  }
  score = Math.max(0, Math.min(100, score));

  const partes = [ADERENCIA_TEXT[aderencia] + (body ? '' : ' (edital ainda não lido)')];
  if (produto.length) partes.push(`${cobertos.length} de ${produto.length} temas com base no Ágil`);
  if (lacunas.length) partes.push(`a desenvolver: ${lacunas.slice(0, 4).join(', ')}${lacunas.length > 4 ? '…' : ''}`);
  if (bloqueios.length) partes.push(`fora do Ágil: ${bloqueios.join(', ')}`);
  return { version: AGIL_VERSION, aderencia, score, resumo: partes.join(' · '), temas, bloqueios, lacunas };
}

/** Aderências que valem acompanhamento automático. */
export const ALVOS: Aderencia[] = ['nucleo', 'plenario', 'compilacao'];
