# Nuoma Safari Extension Companion

Companion local M39 para carregar o overlay Nuoma no Safari em
`https://web.whatsapp.com/*`, reaproveitando o build MV3 de
`apps/chrome-extension`.

## Build

Pre-requisito real: Xcode completo com o converter Safari disponivel.

```bash
xcrun --find safari-web-extension-converter
npm run build:safari-extension
```

O build faz:

1. gera `apps/chrome-extension/dist`;
2. copia o web extension para `apps/safari-extension/dist/web-extension`;
3. chama `xcrun safari-web-extension-converter`;
4. grava o projeto Xcode e `M39_SAFARI_EXTENSION_SUMMARY.json` em
   `apps/safari-extension/dist`.

Se o converter nao estiver no PATH do Xcode, o build falha com mensagem
explícita. Para smoke controlado, use:

```bash
SAFARI_WEB_EXTENSION_CONVERTER_BIN=/abs/path/do/converter npm run build:safari-extension
```

## Instalacao Local No Safari

1. Rode `npm run build:safari-extension`.
2. Abra o `.xcodeproj` gerado em `apps/safari-extension/dist`.
3. Configure o time de assinatura no Xcode, se solicitado.
4. Rode o app macOS gerado pelo Xcode.
5. No Safari, habilite o menu Develop e permita extensoes nao assinadas se for
   necessario para ambiente local.
6. Abra Safari > Settings > Extensions e habilite `Nuoma Safari Companion`.
7. Mantenha o Nuoma local logado em `http://127.0.0.1:3002` para o cookie
   `nuoma_access` autorizar `/api/extension/overlay`.
8. Abra `https://web.whatsapp.com/` e valide o overlay no chat.

## Escopo M39

- Reaproveita background, content script, popup, manifest e page bridge da
  Chrome extension M38.
- Usa o mesmo endpoint `/api/extension/overlay` para `ping` e
  `contactSummary`.
- Mantem mutacoes reais bloqueadas no companion; envio e sync seguem no
  worker/CDP.
- O smoke automatizado cobre build, manifest, content script, overlay e API com
  converter fake. Ele prefere Playwright WebKit e cai para Chromium se WebKit
  nao estiver instalado. O aceite real com print no Safari depende do
  `safari-web-extension-converter` instalado.
