# Spike 3 — Voice recording IC-1

Este experimento valida o pipeline crítico de áudio antes da V2: duração por `ffprobe`, payload WAV 48kHz mono 16-bit e envio via gravador nativo do WhatsApp Web.

## Modos

```bash
npm run generate
npm run dry-run
TARGET_PHONE=5531982066263 npm run send
```

- `generate`: cria WAVs determinísticos de 3s, 30s e 120s.
- `dry-run`: gera os WAVs, grava snapshots `.bin`, valida header, sample rate, bit depth e duração via `ffprobe`.
- `send`: faz o E2E real no WhatsApp Web, sempre bloqueado para qualquer número diferente de `5531982066263`.

## Guardrails

- O modo de envio exige `--send` ou `npm run send`.
- O único alvo permitido por padrão é `5531982066263`.
- Artefatos binários ficam em `fixtures/` e `payloads/` e são ignorados pelo Git.
- O perfil padrão reaproveita `storage/chromium-profile/whatsapp`.

## Docker

```bash
docker build -t nuoma-spike-3-voice .
docker run --rm nuoma-spike-3-voice
```

O Dockerfile valida o modo seco com Node 22, Playwright, Chromium, Xvfb e `ffprobe`.
