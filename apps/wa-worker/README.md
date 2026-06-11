# WA Worker

Camada responsavel pelo runtime browser-based do WhatsApp Web.

## Papel

- manter um Chromium persistente para autenticacao e execucao
- sincronizar inbox do WhatsApp
- consumir jobs de envio gerados pelo sistema
- publicar heartbeat, estado e falhas operacionais

## Entrypoints

- [`src/index.ts`](/Users/gabrielbraga/Projetos/nuoma-wpp/apps/wa-worker/src/index.ts)
- [`src/worker.ts`](/Users/gabrielbraga/Projetos/nuoma-wpp/apps/wa-worker/src/worker.ts)

## Comandos

```bash
npm run dev --workspace @nuoma/wa-worker
npm run start --workspace @nuoma/wa-worker
npm run build --workspace @nuoma/wa-worker
npm run typecheck --workspace @nuoma/wa-worker
```

## Dependencias operacionais

- `Playwright` com Chromium persistente
- perfil local em [`storage/chromium-profile/whatsapp`](/Users/gabrielbraga/Projetos/nuoma-wpp/storage/chromium-profile/whatsapp)
- screenshots e artefatos em [`storage/screenshots`](/Users/gabrielbraga/Projetos/nuoma-wpp/storage/screenshots)

## Limites da camada

- nao definir schema, contrato publico, rota HTTP ou regra de negocio compartilhada
- consumir jobs e estados definidos por `@nuoma/core`
- nesta rodada, nao alterar fluxo funcional de autenticacao, sync ou envio

## Envio de audio (mensagem de voz)

O envio de audio como PTT (push-to-talk) usa uma abordagem de injecao de stream via Web Audio API, sem depender do microfone real do sistema.

### Como funciona

1. O arquivo de audio (OGG/WAV) e convertido para WAV 48kHz mono via `ffmpeg`
2. O browser e relancado com `--use-fake-ui-for-media-stream` e `--use-fake-device-for-media-stream` (sem `--use-file-for-fake-audio-capture`)
3. Um script e injetado via `page.addInitScript` **antes** do WhatsApp carregar, substituindo `navigator.mediaDevices.getUserMedia`
4. O override decodifica o WAV via Web Audio API e retorna um `MediaStreamDestination` como stream do microfone
5. Quando o botao de mic e clicado, o WhatsApp chama `getUserMedia` e recebe nosso stream — o audio comeca a tocar exatamente nesse momento
6. Apos a duracao exata do audio (+2s de buffer), o botao de enviar e clicado

### Por que nao usar `--use-file-for-fake-audio-capture`

Essa flag inicia a reproducao do arquivo no momento do **launch do browser**, nao quando o mic e clicado. Com qualquer delay entre launch e click (~25-50s), o inicio do audio ja foi consumido, resultando em mensagens cortadas independente de quantos segundos de silencio sejam adicionados ao inicio do arquivo.

### Detalhes criticos da implementacao

- `audioCtx.resume()` e obrigatorio antes de `source.start()` — Chrome suspende `AudioContext` por padrao, producindo silencio
- O override deve ser registrado via `addInitScript` (nao `page.evaluate`) porque o WhatsApp captura a referencia de `getUserMedia` durante o load inicial da pagina
- A navegacao deve passar por `about:blank` antes de ir para o chat — navegacoes SPA no mesmo dominio nao disparam `addInitScript`
- O retry do botao de mic foi removido — um segundo clique durante a gravacao cancela o recording

## Observacao da rodada atual

So entram ajustes operacionais claramente seguros, como higiene local e encerramento gracioso do processo. Mudancas em seletores, integracoes ou comportamento de envio ficam fora do escopo.
