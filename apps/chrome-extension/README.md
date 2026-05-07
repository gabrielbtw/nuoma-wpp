# Nuoma Chrome Extension Companion

Extensao local MV3 para carregar o overlay Nuoma no Chrome do usuario em
`https://web.whatsapp.com/*`.

## Build

```bash
npm run build:chrome-extension
```

Depois carregue `apps/chrome-extension/dist` em `chrome://extensions` usando
Developer mode / Load unpacked.

## Escopo M38

- Injeta o mesmo overlay Shadow DOM do `V2.11`.
- Usa `chrome.cookies` para ler `nuoma_access` em `127.0.0.1` e chamar a API
  local com `Authorization: Bearer`.
- Hidrata `contactSummary` via `/api/extension/overlay`.
- Mantem mutacoes reais no worker/CDP; a extensao responde erro controlado para
  metodos sensiveis como `forceConversationSync`.
