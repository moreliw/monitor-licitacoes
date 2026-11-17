import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../classify.ts';

/** Casos reais coletados do PNCP em 17/11/2026 (texto do objeto resumido) usados para calibrar as regras. */
const c = (orgaoNome: string, objeto: string, poder = 'L') => classify({ orgaoNome, poder, objeto });

test('reais do nicho: entram como alta relevância', () => {
  for (const [org, obj] of [
    ['TIMBO CAMARA DE VEREADORES', 'Contratação de empresa especializada para disponibilização de Sistema de Processo Legislativo e Administrativo Eletrônico'],
    ['CAMARA MUNICIPAL DE NOVA VENECIA', 'CONTRATAÇÃO DE PLATAFORMA DIGITAL INTEGRADA, COMPOSTA POR SOFTWARES PARA GESTÃO DE PROCESSOS LEGISLATIVOS, ADMINISTRATIVOS'],
    ['CAMARA MUNICIPAL DE VEREADORES DE SEARA', 'Contratação de empresa especializada para fornecimento de licença de uso de sistema integrado de gestão legislativa e administrativa'],
    ['CAMARA MUNICIPAL DE CAMPO GRANDE', '[LICITANET] - CONTRATAÇÃO DE EMPRESA ESPECIALIZADA PARA O FORNECIMENTO DE SOLUÇÃO DE SOFTWARE LEGISLATIVO, EM AMBIENTE WEB, NO MODELO DE SOFTWARE COMO SERVIÇO (SAAS)'],
  ]) assert.equal(c(org, obj).label, 'alta', org);
});

test('reais adjacentes (Ágil: gestão documental, publicação de atos, portal) entram na triagem', () => {
  for (const [org, obj] of [
    ['CAMARA MUNICIPAL DE SAO JOAO DA BOA VISTA', 'Locação de software em plataforma web, destinado à desmaterialização de documentos e à gestão eletrônica do processo legislativo'],
    ['GABINETE CAMARA MUNICIPAL SANTA LUZIA', 'Contratação de empresa especializada em locação de sistema de gerenciamento de publicação de atos oficiais, portal da transparência'],
  ]) assert.notEqual(c(org, obj).label, 'fora', org);
});

test('reais fora do nicho que antes passavam: ficam fora', () => {
  for (const [org, obj, poder] of [
    ['CAMARA MUNICIPAL DE VEREADORES DE QUEDAS DO IGUACU', 'Registro de Preços para aquisição de computadores portáteis do tipo notebook, impressoras multifuncionais, smartphones, monitores de vídeo, microfones, destinados ao uso pelos vereadores. A contratação visa modernizar a infraestrutura tecnológica do Poder Legislativo, especialmente para a implementação do Programa de Modernização do Processo Legislativo, assegurando condições para a utilização de software e ferramentas digitais', 'L'],
    ['CAMARA MUNICIPAL DE REGISTRO', 'Contratação de subscrição de licenças de software pelo período de 12 meses, 70 contas da solução de e-mail corporativo e produtividade em nuvem Google Workspace e licença TeamViewer. Início da disputa no Portal de Compras Públicas', 'L'],
    ['SETE LAGOAS CAMARA MUNICIPAL', 'Locação de 02 (dois) veículos automotores, sem motorista, incluídas manutenção preventiva e corretiva e seguro total, licenciamento, IPVA e quilometragem livre', 'L'],
    ['CONTAGEM CAMARA MUNICIPAL', 'AQUISIÇÃO DE 2 CATRACAS ELETRÔNICAS DE CONTROLE DE ACESSO DE PEDESTRES COM GERENCIAMENTO EMBARCADO SEM LICENÇA DE USO RECORRENTE, INCLUINDO INSTALAÇÃO E TREINAMENTO', 'L'],
    ['JOAO PESSOA TRIBUNAL DE CONTAS DO ESTADO DA PARAIBA', 'Contratação de licenciamento do software Veeam Backup & Replication com suporte do fabricante', 'L'],
    ['CAMARA MUNICIPAL DE QUISSAMA', '[Portal de Compras Públicas] - Licença de software de proteção digital para estações de trabalho e/ou servidores, com recursos de antivírus', 'L'],
    ['CAMARA DOS DEPUTADOS', 'Aquisição de licenças de software para produção musical e edição de vídeo', 'L'],
    ['SAO JOSE DOS PINHAIS CAMARA MUNICIPAL', 'Fornecimento de 260 licenças de uso de software Kaspersky Endpoint Security', 'L'],
  ] as const) assert.equal(c(org, obj, poder).label, 'fora', org);
});

test('sistema adjacente com software não é derrubado por termos técnicos como backup', () => {
  const r = c('CAMARA MUNICIPAL DE X', 'Locação de sistema web de protocolo eletrônico e gestão documental, com backup diário e segurança da informação');
  assert.equal(r.label, 'revisar');
});
