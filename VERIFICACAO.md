# Verificação (17/11/2026)

## Versão 1.1 — escopo do nicho (Ágil)

* Regras 2026.11.3 calibradas com casos reais do PNCP (`electron/tests/realcases.test.ts`, `scope.test.ts`): 71 testes aprovados.
* Atualização testada numa **cópia** do banco real do app instalado (19.665 contratações; o original não foi alterado):
  abertura em ~20 s, 21.949 registros fora do nicho removidos (o número inclui o que a coleta trouxe durante o teste), banco de 113 MB → 11 MB,
  restando 20 oportunidades (5 alta, 5 revisar, 10 pendentes de itens/edital).
* Falsos positivos corrigidos com texto real: notebook/impressoras (Quedas do Iguaçu), Google Workspace/TeamViewer (Registro),
  locação de veículos (Sete Lagoas), catracas (Contagem), Veeam no Tribunal de Contas da PB, antivírus (Quissamã, São José dos Pinhais),
  software musical (Câmara dos Deputados). Acerto recuperado: "software legislativo" (Campo Grande/MS).
* Desempenho: a busca FTS passou a usar `rowid` (migração 2); antes, cada atualização varria a tabela inteira de busca.
* Robustez: a extração de PDF saiu de `worker_threads` para processo filho, depois de reproduzir falha nativa (0xC0000005) em 26 de 42
  execuções sob carga; após a mudança, 0 falhas em 48 execuções (Node 22 e runtime do Electron).
* Pacote 1.1.0: o selftest do app instalado acusou `DOMMatrix is not defined` (o pdf.js desempacotado não achava `@napi-rs/canvas`,
  que ficava dentro do asar). Corrigido com `asarUnpack` de `node_modules/@napi-rs/**`; o `app.asar` final passou no selftest
  completo (FTS5, busca, PDF em processo filho, bandeja, notificação) executado pelo binário oficial do Electron.
* O executável final 1.1.0 **não** pôde ser executado aqui: o Controle Inteligente de Aplicativos do Windows bloqueou o binário novo
  não assinado. A instalação silenciosa do build anterior (mesmo código, sem a correção do `asarUnpack`) funcionou.

Ambiente: Windows 11 Home (10.0.26200) x64, Node 22.21.1, Electron 45.3.3.

## Testes automatizados (`npm test`) — 62 aprovados, 0 falhas

Determinísticos, sem rede (fake de `fetch` e relógio falso), mais fixtures reais pequenas do PNCP em `electron/tests/fixtures/`.

| Cenário de aceitação | Coberto por |
| --- | --- |
| 1. Coleta repetida não multiplica registros/avisos; filtro por UF | `sync.test` “1ª importação…”, “decisão manual…” |
| 2. Software legislativo explícito → alta com trecho; genérico com módulo em item/TR → triagem; só transmissão de sessões → fora | `classify.test`, `docs.test` (TR em PDF), `sync.test` (enriquecimento) |
| 3. Publicado em dia anterior recuperado pelo feed de atualização; retificação = 1 evento; suspensão interrompe lembretes; reabertura recalcula | `sync.test` “edital publicado em dia anterior…”, “retificação de prazo…” |
| 4. Falha de rede/429/5xx, 204, janela incompleta retoma do checkpoint, falha persistente visível, ausência ≠ encerramento | `http.test`, `sync.test` “falha persistente na página 2…”, “HTTP 404 e falha…” |
| 5. CNPJ alfanumérico/zeros, datas com/sem offset, sigilo/ausente/zero, histórico, valores por escopo, decisão manual preservada | `core.test`, `classify.test`, `sync.test` |
| 6. Abre/pesquisa offline, FTS5, migração, busca | `core.test`, `sync.test` “o app opera offline…”, `--selftest` |
| 7. Fonte indisponível → conector mantido e teste determinístico | `sync.test` (rede offline, 400, schema inválido) |

Também cobertos: backoff com jitter e `Retry-After`, penalidade compartilhada por host, limite por minuto, extração de PDF em worker
(ok/parcial/imagem/corrompido), SHA-256 e detecção de mudança de conteúdo, anexos não-PDF ignorados, validação de links/redirecionamentos,
proteção contra travessia de diretório no protocolo `app://`, CSV com injeção de fórmulas, sintaxe FTS hostil.

`LIVE=1 npm test` roda o smoke test no PNCP real (executado e aprovado em 17/11/2026): compra `01512008000108-1-000002/2026`
(detalhe, itens, arquivos e catálogo de modalidades) e as listagens de publicação/atualização/propostas. Valida estrutura e vinculação,
sem contagens permanentes.

## Verificado em produção (PNCP real, 17/11/2026)

* Sondagem: detalhe, itens (paginados), arquivos (`200`, `application/octet-stream`), modalidades, publicação/atualização/propostas;
  `tamanhoPagina=51` → HTTP 400 (confirmado); itens aceitam `pagina`/`tamanhoPagina`.
* Execução do app real com banco novo e coleta nacional: **4.428 contratações** reais carregadas em poucos minutos (todas as UFs, modalidades 6/7/8/4/5),
  estados derivados corretos (recebendo propostas, abertura futura, encerrada, suspensa, revogada, anulada), 1 alta + 15 revisar + 11 pendentes
  entre 3,9 mil. O PNCP respondeu **HTTP 429 e resets de conexão** sob coleta intensa; o motor repetiu com backoff/penalidade por host e
  retomou pelos checkpoints (a UI mostra os erros e a fila).
* Caso real: Câmara Municipal de Marataízes/ES (Pregão eletrônico 10/2026) classificada como **Alta relevância** com evidências por regra/trecho.

## Build empacotado (Windows x64)

* `npm run dist` → `release/Monitor de Licitações Legislativas Setup 1.0.0.exe` (NSIS, por usuário, não assinado).
* `--selftest` no **executável empacotado** e no **app instalado**: SQLite 3.54.1 com FTS5, integridade `ok`, chaves estrangeiras, migração, busca,
  CNPJ alfanumérico, extração de PDF em worker (dentro do asar), criação do ícone de bandeja, suporte a notificações → `ok: true`.
  (O primeiro selftest empacotado revelou que o ícone não estava no pacote — corrigido.)
* Instalação silenciosa (`/S`) em pasta temporária, execução do selftest a partir do instalado e desinstalação silenciosa: concluídas com código 0;
  não restaram entrada de desinstalação nem atalho no Menu Iniciar.
* Interface verificada por capturas de tela do app real (Oportunidades, Fontes e sincronização, Alertas, Detalhe).

## Diferença entre build gerado e testado em Windows real

Testado em Windows real nesta máquina: instalação/desinstalação silenciosas, selftest do instalado, execução do app com coleta ao vivo e capturas.
**Não testado** (precisa de olhos humanos/tempo): exibição efetiva do toast do Windows (o selftest só confirma `Notification.isSupported()`),
clique na bandeja/menu, “Iniciar com o Windows” após reinício real, retomada após suspensão/hibernação, instalador com UI (modo não silencioso)
e SmartScreen (instalador não assinado), ciclo completo de 4 h e lembretes de prazo reais (cobertos só por relógio falso nos testes).

## Pendências e limitações

* OCR de editais escaneados e fontes complementares (Rio Novo do Sul, DOM/AMUNES, Compras.gov.br, contratos/PCA) ficam para a fase seguinte.
* A calibração das regras de relevância usa os casos do estudo + amostra real; recomenda-se rotular ~50 casos reais e medir
  precisão dos alertas de alta e cobertura da triagem (indicadores do estudo) antes de confiar nos avisos.
* Limite de taxa do PNCP: a primeira carga completa (7 dias × 5 modalidades × atualização) leva vários ciclos de retomada.
