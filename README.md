# Monitor de Licitações Legislativas

Aplicativo desktop (Windows x64) da Moreli.Dev que descobre e acompanha, em todo o Brasil, oportunidades de
**software de processo legislativo** para Câmaras, Assembleias e outros órgãos do Legislativo, a partir do
**PNCP real** (dados públicos, somente leitura). Interface em português do Brasil.

Funciona sem servidor, conta externa ou chave de IA. Continua operando em segundo plano na bandeja enquanto o
PC estiver ligado e permite pesquisar o acervo local offline.

## Baixar e instalar

É gratuito, não pede conta nem senha e não precisa de administrador.

**Requisitos:** Windows 10 ou 11 de 64 bits, internet e cerca de 1 GB livre durante a instalação (o app instalado
ocupa uns 500 MB; o `.zip` e a pasta extraída podem ser apagados depois).

### 1. Baixar

1. Abra a página da versão mais recente:
   **https://github.com/moreliw/monitor-licitacoes/releases/latest**
2. Em **Assets**, clique em **`MonitorLegislativo-<versão>-win-x64.zip`** (cerca de 170 MB).
   Os outros arquivos da lista (`app-….tar.gz`, `app-latest.json`, código-fonte) são usados pela atualização
   automática e não precisam ser baixados.

### 2. Extrair

1. Na pasta Downloads, clique com o botão direito no `.zip` e escolha **Extrair tudo…** e depois **Extrair**.
2. Abra a pasta extraída **Monitor Legislativo**.

> Extraia antes de abrir. Executar o programa de dentro do `.zip`, sem extrair, não funciona.

### 3. Instalar

1. Dê dois cliques em **`Monitor Legislativo.exe`**.
2. Na janela "Instalar o Monitor de Licitações neste computador?":
   * deixe marcado **Criar atalho na área de trabalho**, se quiser o ícone na área de trabalho;
   * clique em **Instalar**.
3. O app se copia para a pasta de programas do usuário, cria o atalho **Monitor de Licitações** no Menu Iniciar e
   abre sozinho. Depois disso, o `.zip` e a pasta extraída podem ser apagados.

Prefere não instalar? Clique em **Usar sem instalar**: o app roda direto da pasta extraída, sem criar atalhos.

#### Se o Windows mostrar um aviso

O executável é o do Electron oficial, conhecido pelo Windows, então normalmente abre sem aviso. Se aparecer:

* **"O Windows protegeu o computador"** (tela azul do SmartScreen): clique em **Mais informações** e depois em
  **Executar assim mesmo**.
* **"Deseja executar este arquivo?"**: clique em **Executar**.

### 4. Primeiro uso

* Na primeira abertura, o app começa a buscar as contratações no PNCP. A carga inicial leva alguns minutos e
  continua em segundo plano. O andamento aparece no canto inferior esquerdo ("Sincronizando").
* O **X** da janela não fecha o app: ele continua na **bandeja** (perto do relógio), coletando e avisando sobre
  novidades. Para fechar de verdade: botão direito no ícone da bandeja e **Encerrar**.
* Os dados ficam só no computador (`%APPDATA%\monitor-licitacoes`). Nada é enviado para servidor nenhum.

### Atualizações

O app verifica novas versões sozinho. Quando houver uma, aparece **Atualizar agora** na barra lateral: um clique
baixa, instala e reabre o app, sem perder dados. Também dá para verificar em **Configurações → Atualizações →
Verificar agora**.

### Desinstalar

**Configurações do Windows → Aplicativos → Aplicativos instalados → Monitor de Licitações → Desinstalar.**
Na confirmação, marque "Apagar também meus dados" se quiser remover também as oportunidades e editais baixados.

### O que testar

* **Oportunidades:** a lista enche à medida que a coleta avança. Teste a busca, os filtros e a abertura de um item.
* **Detalhe:** **Abrir no PNCP**, **Visualizar** e **Baixar** os editais em PDF.
* **Acompanhadas** e **Alertas:** no detalhe, preencha **Acompanhamento** e clique em **Salvar acompanhamento**;
  a oportunidade passa a receber lembretes 72 h, 24 h e 3 h antes do prazo.
* **Mercado de software:** o panorama de tudo o que está sendo comprado em software, por categoria e UF.
* **Bandeja:** feche a janela no X e reabra pelo ícone perto do relógio.

Problemas ou sugestões: abra uma issue em https://github.com/moreliw/monitor-licitacoes/issues ou envie um print
da tela com a versão, que aparece no canto inferior esquerdo do app (ex.: `v1.3.3`).

---

## Para desenvolvedores

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

### Instalação e atualização gratuitas (versão 1.3)

O Windows 11 com **Controle Inteligente de Aplicativos** bloqueia executáveis novos sem assinatura paga, como o
instalador que o empacotador gerava. Desde a 1.3 o app não tem instalador `.exe`:

* **Pacote completo** (`MonitorLegislativo-<versão>-win-x64.zip`): contém o `electron.exe` **oficial, sem nenhuma
  alteração** (apenas renomeado para `Monitor Legislativo.exe`). É o mesmo arquivo usado em milhões de PCs, com
  reputação conhecida pela Microsoft, por isso o Windows deixa abrir. O app em si é JavaScript, interface e módulos.
* **Instalação pelo próprio app** (`electron/install.ts`): na primeira abertura a partir do zip, ele oferece
  "Instalar": copia para `%LOCALAPPDATA%\Programs\Monitor Legislativo`, cria o atalho no Menu Iniciar (e na área de
  trabalho, opcional), registra-se em "Aplicativos instalados" (desinstalar chama `--desinstalar`) e remove a
  instalação antiga feita pelo instalador NSIS (até a 1.2.x), mantendo os dados.
* **Atualização sem instalador** (`electron/updater.ts` + `scripts/portable/bootstrap.js`): o app consulta o último
  Release de `moreliw/monitor-licitacoes`, baixa só `app-<versão>.tar.gz` (~18 MB), confere o SHA-512 do
  `app-latest.json`, extrai com o `tar.exe` do Windows em `%LOCALAPPDATA%\monitor-licitacoes\versoes\<versão>` e
  reinicia. O carregador usa a versão mais nova e volta automaticamente para a versão do pacote se a nova falhar ao
  abrir. Se uma versão exigir outro Electron, o app avisa e abre a página para baixar o pacote completo.

Publicar uma versão:

```bash
npm version patch --no-git-tag-version
```

```bash
npm run release -- "Texto das novidades"
```

### Aderência ao Ágil e acervo sem perdas (versão 1.4)

**Aderência ao Ágil** (`electron/agil.ts`). Cada oportunidade recebe uma aderência ao Ágil, o sistema de processo legislativo da Moreli.Dev, calculada pelo objeto, pelos itens e pelo texto dos editais. As categorias são:

* processo legislativo;
* plenário;
* compilação;
* complemento;
* condicionada (o lote exige ERP, equipamentos ou manutenção de sistema legado);
* fora.

Junto com a aderência saem uma pontuação de 0 a 100, os temas encontrados e a situação de cada tema no Ágil (entregue, em andamento, a desenvolver, fora do produto) com a entrega do plano (L001–L089). Saem também as parcelas fora do produto, que pedem parceria, revenda ou módulo de enquadramento. A lista ganha o filtro **Ágil**, a ordenação **Aderência ao Ágil** e o indicador **Alvos do Ágil abertos**. O detalhe mostra a seção **Aderência ao Ágil**, e o CSV traz as colunas correspondentes.

Oportunidades abertas com aderência de processo legislativo, plenário ou compilação entram sozinhas em **Triagem** e recebem os lembretes de prazo. Isso acontece uma única vez por oportunidade: quem foi tirado do acompanhamento não volta. A opção pode ser desligada em Configurações.

O catálogo espelha `docs/implementation/requisitos/relatorio-requisitos.md` do repositório do Ágil. Quando uma entrega mudar de situação, atualize `situacao` em `AGIL_TEMAS` e incremente `AGIL_VERSION`; a próxima abertura recalcula todo o acervo.

**Acervo sem perdas.**

* Quem já foi candidato do nicho (`ever_candidate`) nunca sai do banco por reclassificação. Até a 1.3.4, um registro "pendente" que virava "fora" depois da leitura do edital era apagado; foi o caso de Santa Isabel/SP. Agora ele só fica fora da lista padrão: aparece com "Mostrar também fora do perfil".
* Na primeira abertura da 1.4, as janelas de publicação dos últimos 30 dias são relidas para trazer de volta o que foi apagado.
* Cópia diária do banco (`VACUUM INTO`) em `dados/backups/monitor-AAAAMMDD.sqlite`; ficam as 14 mais recentes, número ajustável. Se o banco corromper, o app restaura a cópia mais recente em vez de recomeçar vazio.
* Arquivos de anexo de oportunidades do nicho não são apagados pela retenção.

**Anexos.**

* Os anexos marcados como "Anexo não encontrado" pela URL antiga voltam para a fila.
* Se o PNCP responder 404 e já houver cópia local, o texto é extraído dela. Sem cópia, o app tenta de novo em 1, 2, 4 e 8 dias.
* ZIPs são abertos sem dependência nova (`electron/zip.ts`): PDFs, DOCX, ODT e TXT de dentro deles viram texto pesquisável. DOCX e ODT avulsos também.
* A fila de leitura passa a incluir retificações, respostas a impugnação, ETP, anexos e atas, além de edital e TR, para oportunidades relevantes, acompanhadas ou com aderência ao Ágil. As abertas vêm primeiro.
* PDFs só de imagem continuam sem OCR e aparecem como "escaneado".

**Lista.** A lista mostra quantas vezes a mesma compra foi republicada e marca "Datas a conferir" quando a publicação é posterior ao encerramento.

**Regras 2026.11.5.** Entram como sinal:

* software de plenário e votação;
* repositório e compilação legislativa;
* atividades parlamentares;
* sessões legislativas;
* emendas parlamentares.

Passam a contar contra: viagens, publicidade, saúde ocupacional, auxílio-alimentação, combustível e assessoria tributária.

## Stack e versões fixadas

| Parte | Versão | Observação |
| --- | --- | --- |
| Electron | 45.3.3 (Node 24.22, Chromium 148) | processo principal + preload tipado + renderer |
| Angular | 21.2 (standalone, sinais, rotas por hash) | Angular 22 exige Node ≥ 22.22.3; o ambiente tem 22.21 |
| TypeScript | 5.9 | `electron/` compila para CommonJS em `dist-electron/` |
| SQLite | `node:sqlite` embutido no Electron (SQLite 3.54.1, **FTS5 ativo**) | **sem dependência nativa**: não há ABI/`electron-rebuild` |
| PDF | `pdfjs-dist` 5.4 (build legacy) em **processo filho** | extração local, isolada do renderer e do processo principal |
| Empacotamento | `scripts/build-portable.mjs` (zip com Electron oficial intacto + pacote de atualização) | sem instalador `.exe`, sem assinatura paga |

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
| `npm run dist` | gera o pacote completo (zip), a atualização (tar.gz) e o manifesto em `release/` |
| `npm run release` | gera e publica no GitHub Releases |

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

* Instalação por usuário, sem elevação, feita pelo próprio app (sem instalador `.exe`).
* “Iniciar com o Windows” (opcional) registra `openAtLogin` com `--hidden`.
* “Fechar para a bandeja” (padrão): o X oculta a janela; **Encerrar** só pelo menu da bandeja. Instância única.
* Notificações do Windows: dependem do Assistente de foco/permissões do sistema; a central de Alertas é a fonte de verdade.

## Limitações conhecidas

* A coleta automática exige PC ligado, internet e o app ativo na bandeja. Coleta 24/7 exigiria outra máquina.
* OCR de PDFs escaneados não está incluído: o app sinaliza “somente imagem/extração parcial” e abre o original.
* Anexos ZIP/não-PDF são ignorados (não executados).
* Nada é assinado (sem custo). O executável é o do Electron oficial, por isso o Controle Inteligente de Aplicativos libera; se um dia o Windows passar a avisar, a saída é uma assinatura de código.
* Fontes complementares (Câmara de Rio Novo do Sul, DOM/AMUNES, Compras.gov.br, contratos/PCA) são a fase seguinte; a
  interface `SourceConnector` está pronta e a tela de Fontes mostra a cobertura real (somente PNCP).
* O PNCP aplica limite de taxa (HTTP 429) em coletas intensas: a primeira carga pode levar vários ciclos; a retomada é automática.

## Verificação

Veja `VERIFICACAO.md` para o que foi executado em produção, o que os testes cobrem e o que ainda precisa ser validado em Windows real.
