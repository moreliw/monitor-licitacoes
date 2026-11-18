# Monitor de Licitações Legislativas

Aplicativo desktop (Windows x64) da Moreli.Dev que descobre e acompanha, em todo o Brasil, oportunidades de
**software de processo legislativo** para Câmaras, Assembleias e outros órgãos do Legislativo, a partir do
**PNCP real** (dados públicos, somente leitura). Interface em português do Brasil.

Funciona sem servidor, conta externa ou chave de IA. Continua operando em segundo plano na bandeja enquanto o
PC estiver ligado e permite pesquisar o acervo local offline.

### Escopo do nicho (versão 1.1)

O PNCP não filtra por texto, então a coleta **lê todas** as contratações das modalidades habilitadas, mas **guarda e mostra
só as do nicho** — software para o Legislativo, no escopo do produto Ágil:

* **Alta relevância:** sistema/software/plataforma de processo legislativo, gestão legislativa, tramitação legislativa,
  processo legislativo eletrônico, "software legislativo" (em qualquer órgão).
* **Revisar:** em órgão legislativo (Câmara, Assembleia, Câmara Legislativa, Câmara dos Deputados, Senado), software ou
  desenvolvimento de sistema para protocolo, tramitação, gestão documental, processo eletrônico, e-SIC/ouvidoria, portal,
  publicação de atos, votação/plenário.
* **Evidência pendente:** Câmara comprando software genérico; o app consulta itens e edital e, se não houver módulo do
  nicho, remove o registro.
* **Descartado:** todo o resto, inclusive software de prateleira (e-mail, Office/Google, antivírus, backup, firewall),
  hardware, veículos, catracas e órgãos não legislativos (Tribunais de Contas incluídos) sem o sinal central.

Ao abrir, a versão 1.1 reclassifica o acervo existente e remove o que estiver fora do nicho, preservando acompanhadas e decisões
manuais. A opção “Guardar também contratações fora do nicho” (Configurações) mantém tudo para auditar as regras.

### Mercado de software (versão 1.2)

A aba **Mercado de software** registra **toda** contratação de software vista na coleta, de qualquer órgão (inclusive o que
fica fora do nicho legislativo), e a classifica pelo tipo de produto pedido: saúde, educação, ERP/contabilidade, tributos,
RH/folha, protocolo e gestão documental, transparência/e-SIC, licenças de prateleira, segurança da informação, nuvem,
telecom, frota, trânsito, geoprocessamento, IA/BI, legislativo e outros (`electron/market.ts`). Mostra quantidade, valor
estimado, abertas agora, esfera, UF, tendência semanal e maiores compradores, com lista detalhada e CSV.
“Ampliar histórico” enfileira meses anteriores (prioridade baixa, pausável).

### Atualizações dentro do app (versão 1.2)

O app consulta o GitHub Releases de `moreliw/monitor-licitacoes` ao abrir e a cada 4 h, baixa a nova versão em segundo
plano e mostra **“Atualizar agora”** na barra lateral e em Configurações → Atualizações; um clique instala em silêncio e
reabre o app (`electron/updater.ts`, electron-updater).

Publicar uma versão: `npm run release` (gera, assina, verifica e publica). A assinatura com o certificado Certum
(SimplySign) está descrita em [docs/assinatura-certum.md](docs/assinatura-certum.md); sem certificado, a publicação é
bloqueada, e `npm run dist` gera só um instalador local sem assinatura. Instaladores sem assinatura são bloqueados pelo
Controle Inteligente de Aplicativos do Windows.

## Stack e versões fixadas

| Parte | Versão | Observação |
| --- | --- | --- |
| Electron | 45.3.3 (Node 24.22, Chromium 148) | processo principal + preload tipado + renderer |
| Angular | 21.2 (standalone, sinais, rotas por hash) | Angular 22 exige Node ≥ 22.22.3; o ambiente tem 22.21 |
| TypeScript | 5.9 | `electron/` compila para CommonJS em `dist-electron/` |
| SQLite | `node:sqlite` embutido no Electron (SQLite 3.54.1, **FTS5 ativo**) | **sem dependência nativa**: não há ABI/`electron-rebuild` |
| PDF | `pdfjs-dist` 5.4 (build legacy) em **processo filho** | extração local, isolada do renderer e do processo principal |
| Empacotador | electron-builder 26.18 (NSIS x64) | `package-lock.json` versionado |

> Escolha deliberada: `node:sqlite` do runtime do Electron evita compilar `better-sqlite3` para a ABI do Electron.
> A versão empacotada é validada pelo `--selftest` (FTS5, migração, busca, PDF, bandeja, notificação).

## Executar

```bash
npm install
npm start            # compila UI + processo principal e abre o app
```

Scripts:

| Script | O que faz |
| --- | --- |
| `npm run build` | `ng build` (UI) + `tsc` (processo principal) |
| `npm test` | compila e roda os testes determinísticos (`node:test`, sem rede) |
| `LIVE=1 npm test` | inclui o smoke test contra o PNCP real |
| `npm run selftest` | abre o Electron em modo de autoverificação (SQLite/FTS5, busca, PDF, bandeja) |
| `npm run dist` | gera o instalador NSIS em `release/` |

Opções de linha de comando do executável: `--hidden` (inicia minimizado na bandeja), `--data-dir=<pasta>`
(dados isolados), `--selftest --selftest-out=<arquivo.json>`, `--screenshot=<png> --routes=/a,/b --wait=ms`
(captura de telas para verificação).

Dados do usuário: `%APPDATA%\monitor-licitacoes\` — banco em `dados\monitor.sqlite`, anexos em `anexos\`.
Para mover o banco, feche o app (menu da bandeja → Encerrar) e copie `dados\`.
Banco corrompido é preservado como `monitor.sqlite.corrompido-<timestamp>` e um novo é criado.

## Arquitetura

```
electron/
  main.ts        ciclo de vida, instância única, bandeja, protocolo app://, IPC com validação de remetente/payload, agendador
  preload.ts     contextBridge: métodos específicos (nunca expõe ipcRenderer)
  db.ts          SQLite + migrações + FTS5 + sintaxe segura de busca
  store.ts       upsert idempotente, snapshots, eventos, avisos, lembretes, classificação, FTS, acompanhamento
  sync.ts        fila persistente (discover/update/reconcile/refetch/enrich/doc), checkpoints, retomada
  connector.ts   interface de conectores de fonte (plugar fontes complementares na fase 2)
  pncp.ts        conector PNCP real (contrato, normalização, anexos seguros)
  http.ts        limite por host, timeout, cancelamento, backoff com jitter, Retry-After, penalidade compartilhada
  classify.ts    regras versionadas/editáveis, evidências com trecho/campo/página/item
  states.ts      estado derivado (precedência de suspensa/revogada/anulada) · time.ts fuso America/Sao_Paulo
  docs.ts        download validado + extração de PDF em worker · pdfworker.ts
  query.ts       listagem/filtros/CSV/fontes · csv.ts proteção contra fórmulas · links.ts validação de URLs
  selftest.ts    autoverificação do build empacotado
src/app/         UI Angular: Oportunidades, Detalhe, Acompanhadas, Alertas, Fontes e sincronização, Configurações
electron/tests/  testes determinísticos + fixtures reais pequenas do PNCP
```

### Coleta (PNCP)

* Rotas: `/contratacoes/publicacao`, `/atualizacao`, `/proposta`, detalhe, `/itens`, `/arquivos`, `/modalidades`
  (HTTPS, 10–50 por página; padrão 50; `204` tratado; envelope validado em runtime, campos novos tolerados).
* Descoberta por **dia × modalidade** (6, 7, 8, 4, 5; 9 opcional como radar), nacional sem `uf`; sobreposição de 2 dias;
  intervalo configurável (padrão 4 h) com recuperação após suspensão/atraso.
* **Página + checkpoint na mesma transação**; janela só fica `concluido` quando completa; reinício retoma da página seguinte.
  Paginação instável → pontas reprocessadas. Janela com mais de N páginas é dividida por UF.
* Reconciliação de propostas abertas (horizonte padrão 30 dias). **Ausência em feed nunca fecha** uma oportunidade:
  só agenda reconsulta do detalhe; HTTP 404 é registrado à parte; resposta antiga não sobrescreve dado novo.
* 429/5xx: backoff exponencial com jitter + `Retry-After` + penalidade compartilhada por host; 4xx de parâmetros e erro de
  schema viram diagnóstico permanente (sem laço). Concorrência 2 e limites configuráveis.
* Datas: PNCP sem offset = Brasília (UTC-3), offset explícito preservado, data ausente/inválida **não** vira meia-noite.
* Valores em centavos; zero publicado preservado; sigilo distinto de ausência; CNPJ alfanumérico/zeros à esquerda preservados.

### Relevância

Regras em JSON (Configurações → Regras): sinais centrais, funções, tecnologia, adjacentes, auxiliares (SAPL/CATSER) e falsos
positivos. Resultados: **Alta relevância**, **Revisar**, **Fora do perfil**, **Evidência pendente**. Cada evidência traz regra,
peso, campo, trecho original, origem e página/item. Órgãos legislativos reconhecidos por contexto institucional (e CNPJs
cadastrados). Candidatos genéricos passam por itens → edital/TR (download limitado, PDF extraído em worker, SHA-256 e
revalidação). Decisões manuais (promover/descartar) são preservadas ao reprocessar.

### Alertas

Eventos persistentes e idempotentes (`nova_publicacao`, `prorrogacao`, `retificacao`, `suspensao`, `reabertura`,
`revogacao`, `anulacao`, `documento_alterado`). Evento + aviso gravados na mesma transação. Lembretes 72 h/24 h/3 h para
acompanhadas; cancelados ao mudar o prazo, suspender ou encerrar; sem avisos atrasados. Primeira importação: histórico
visível e **um resumo**, sem avisos retroativos. A central de alertas fica no banco (sobrevive a reinício e a bloqueio do Windows).

### Segurança

`contextIsolation`, `sandbox`, `nodeIntegration` desligado, CSP restritiva servida pelo protocolo `app://` (somente a UI
empacotada, sem travessia de diretório), permissões negadas, navegação/popups bloqueados. IPC valida remetente e payload.
O renderer **não envia URLs**: pede “abrir PNCP/origem/documento” por id e o processo principal valida (HTTPS, host público,
sem credenciais, redirecionamentos). Anexos: origem `*.pncp.gov.br`, tamanho máximo, tipo por assinatura (só PDF é lido),
nome sanitizado, armazenamento por hash. CSV com UTF‑8 BOM e proteção contra injeção de fórmulas.

## Permissões e comportamento no Windows

* Instalação por usuário (NSIS, sem elevação), com escolha de pasta.
* “Iniciar com o Windows” (opcional) registra `openAtLogin` com `--hidden`.
* “Fechar para a bandeja” (padrão): o X oculta a janela; **Encerrar** só pelo menu da bandeja. Instância única.
* Notificações do Windows: dependem do Assistente de foco/permissões do sistema; a central de Alertas é a fonte de verdade.

## Limitações conhecidas

* A coleta automática exige PC ligado, internet e o app ativo na bandeja. Coleta 24/7 exigiria outra máquina.
* OCR de PDFs escaneados não está incluído: o app sinaliza “somente imagem/extração parcial” e abre o original.
* Anexos ZIP/não-PDF são ignorados (não executados).
* O instalador **não é assinado** (sem certificado): o SmartScreen pode exibir aviso na primeira execução.
* Fontes complementares (Câmara de Rio Novo do Sul, DOM/AMUNES, Compras.gov.br, contratos/PCA) são a fase seguinte; a
  interface `SourceConnector` está pronta e a tela de Fontes mostra a cobertura real (somente PNCP).
* O PNCP aplica limite de taxa (HTTP 429) em coletas intensas: a primeira carga pode levar vários ciclos; a retomada é automática.

## Verificação

Veja `VERIFICACAO.md` para o que foi executado em produção, o que os testes cobrem e o que ainda precisa ser validado em Windows real.
