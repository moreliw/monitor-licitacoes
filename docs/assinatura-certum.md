# Assinatura do instalador com Certum (Open Source Code Signing na nuvem)

Sem assinatura, o **Controle Inteligente de Aplicativos** do Windows 11 bloqueia o instalador e as atualizações.
A Microsoft documenta que o Controle Inteligente libera um app quando ele é assinado por uma autoridade do
*Microsoft Trusted Root Program*. A Certum faz parte desse programa.

O projeto já está preparado: com o certificado conectado, `npm run release` assina o `.exe` do app, o instalador e
o desinstalador, verifica as assinaturas e publica no GitHub. Sem certificado, `npm run dist` continua gerando um
instalador local sem assinatura, e a publicação sem assinatura é bloqueada.

## 1. Comprar e validar (uma vez por ano)

1. Em [shop.certum.eu](https://shop.certum.eu/open-source-code-signing-on-simplysign.html), compre o
   **Open Source Code Signing in the Cloud** (SimplySign). O produto é emitido para **pessoa física**, e o nome no
   certificado vem com o prefixo "Open Source Developer". O projeto precisa ser de código aberto e público
   (`https://github.com/moreliw/monitor-licitacoes`).
2. Envie os documentos pedidos na [lista de documentos da Certum](https://www.support.certum.eu/en/required-documents/)
   (documento de identidade e o endereço do projeto aberto) e aguarde a validação.
3. Ative o certificado seguindo o
   [manual de ativação](https://files.certum.eu/documents/manual_en/CS-Open_Source_Code_Signing_in_the_cloud_Certificate_activation.pdf):
   instale o app **SimplySign** no celular (gera os códigos de acesso) e o **SimplySign Desktop** no Windows.

A chave fica no HSM da Certum e não pode ser exportada (não existe arquivo `.pfx`). Para assinar, o SimplySign Desktop
precisa estar conectado nesta máquina.

## 2. Conectar e conferir o certificado

1. Abra o **SimplySign Desktop**, clique em **Connect to SimplySign** e digite o código mostrado no app do celular.
2. No terminal, na pasta do projeto:

```bash
npm run sign:check
```

O comando lista os certificados de assinatura do Windows e mostra o thumbprint e o nome (CN) do certificado
Certum, com os dois comandos prontos para copiar.

## 3. Publicar uma versão assinada

No PowerShell, na pasta do projeto, com o SimplySign conectado:

```powershell
$env:CERTUM_CERT_SHA1 = "<thumbprint mostrado pelo sign:check>"
$env:CERTUM_PUBLISHER_NAME = "<CN mostrado pelo sign:check>"
npm version minor --no-git-tag-version
npm run release
```

O `npm run release`:

1. confere se o certificado está disponível e tem chave privada;
2. gera o app e o instalador, assinando com SHA-256 e carimbo de tempo `http://time.certum.pl`;
3. publica o Release com `latest.yml` e `.blockmap` (usa o login do `gh`);
4. confere as assinaturas (`npm run sign:verify`).

O `CERTUM_PUBLISHER_NAME` vai para a configuração do atualizador. A partir da primeira versão assinada, o app só
instala atualizações assinadas por esse mesmo nome. Use exatamente o CN mostrado pelo `sign:check`.

Commit e tag da versão: `git commit -am "Versão X.Y.Z"`, `git tag vX.Y.Z` e `git push --follow-tags`.

## 4. Primeira instalação assinada nesta máquina

As versões 1.2.x não são assinadas, então o Controle Inteligente bloqueia a atualização automática delas. Depois de
publicar a primeira versão assinada, baixe o instalador da página de Releases e instale manualmente uma vez. Daí em
diante, o botão **Atualizar agora** instala as próximas versões assinadas.

## Problemas comuns

| Sintoma | Causa provável |
| --- | --- |
| `sign:check` não encontra certificado | SimplySign Desktop desconectado (a sessão expira) |
| `SignTool Error: No certificates were found` | thumbprint errado ou sessão do SimplySign expirada |
| Erro no carimbo de tempo | sem internet ou `time.certum.pl` indisponível; tente de novo |
| Atualização recusada com erro de assinatura | `CERTUM_PUBLISHER_NAME` diferente do CN do certificado |
| Windows ainda avisa logo após a primeira versão assinada | reputação de um editor novo; o Controle Inteligente aceita a assinatura, mas o aviso do SmartScreen pode aparecer nos primeiros downloads |
