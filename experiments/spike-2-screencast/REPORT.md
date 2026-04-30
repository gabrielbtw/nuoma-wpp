# Spike 2 — CDP screencast

## Status

VERDE em 2026-04-30 para relay local CDP + canvas + input.

## Artefatos

- `server.ts`: HTTP + WebSocket relay, CDP `Page.startScreencast`, `Input.dispatch*`.
- `client.html`: canvas render, mouse/wheel/keyboard forwarding, overlay de latência.
- `metrics.jsonl`: métricas locais geradas durante os testes (ignorado pelo Git).

## Comandos executados

```bash
npm install
npm run typecheck
npm run start:launch
```

Servidor local usado:

- Client: `http://127.0.0.1:9322`
- CDP: `127.0.0.1:9234`
- Chromium profile: `storage/chromium-profile/whatsapp`

## Resultado

Frame bruto capturado via WebSocket com WhatsApp Business Web autenticado:

- frame: 1470x707
- bytes do frame amostra: 51.157
- screenshot salvo localmente em `screenshots/latest-frame.jpg`

Input back validado por clique remoto no canvas: o relay enviou `Input.dispatchMouseEvent` e o WhatsApp abriu a conversa clicada. Nenhuma mensagem foi enviada durante esse teste.

Latência click→frame após ajuste (`Page.bringToFront` + ACK não-bloqueante):

| amostra | latência |
|---|---:|
| clique 1 | 183ms |
| clique 2 | 137ms |

Bandwidth:

| janela | frames | bytes | média |
|---|---:|---:|---:|
| passiva 10s | 22 | 2.345.037 | 1,88 Mbps |
| estabilidade 600s | 1.601 | 172.610.955 | 2,30 Mbps |

Estabilidade:

- duração: 600,02s
- closes: 0
- errors: 0

## Decisão

G.2 aprovado para ADR 0007/V2.12 em ambiente local. Para produção hosted, repetir a mesma medição entre Mac e host remoto real antes de prometer UX final.
