# Spike 3 — Voice recording IC-1

## Status

G.3a/G.3b concluídos em 2026-04-30.

Status prático: **VERDE para pipeline local IC-1** (payload + envio real nativo). **AMARELO para hosted/container completo** até rodar `--send` dentro de container com perfil WhatsApp autenticado.

## Escopo executado

- Harness criado em `experiments/spike-3-voice/`.
- Modo seco gera payloads WAV determinísticos de 3s, 30s e 120s.
- Validação local cobre `ffprobe`, header WAV, sample rate 48kHz, mono, 16-bit e snapshots binários.
- Modo `send` está preparado, mas bloqueia qualquer alvo diferente de `5531982066263`.
- E2E local enviou 3 áudios reais para `5531982066263` usando Web Audio API injection.
- Docker build e dry-run com `xvfb-run` passaram.

## Resultado atual

### G.3a — Dry-run local

| payload | duração alvo | ffprobe | erro | formato | sha256 |
|---|---:|---:|---:|---|---|
| `voice-3s` | 3s | 3.000000s | 0.000ms | 48000Hz mono 16-bit | `d0e423593a1c...` |
| `voice-30s` | 30s | 30.000000s | 0.000ms | 48000Hz mono 16-bit | `33a8e5ed10bb...` |
| `voice-120s` | 120s | 120.000000s | 0.000ms | 48000Hz mono 16-bit | `d83be644512a...` |

Comandos executados:

```bash
npm install
npm run dry-run
npm run typecheck
```

Artefatos gerados localmente:

- `fixtures/voice-3s.wav`, `fixtures/voice-30s.wav`, `fixtures/voice-120s.wav`
- `payloads/voice-3s.bin`, `payloads/voice-30s.bin`, `payloads/voice-120s.bin`
- `payloads/voice-3s.json`, `payloads/voice-30s.json`, `payloads/voice-120s.json`

### G.3b — E2E real WhatsApp local

Primeira tentativa provou voice nativo, mas ficou com duração inflada por causa do wait herdado do V1 (`duração + 2s`). O harness foi calibrado para parar próximo da duração real e a rodada final passou:

| payload | delivered | voice nativo | duração exibida | erro |
|---|---:|---:|---:|---:|
| `voice-3s` | true | true | 3s | 0ms |
| `voice-30s` | true | true | 30s | 0ms |
| `voice-120s` | true | true | 120s | 0ms |

Resultado salvo em `payloads/send-results.json`. Screenshots finais ficam em `screenshots/`.

### G.3c — Docker/Xvfb

Comandos executados:

```bash
docker build -t nuoma-spike-3-voice .
docker run --rm nuoma-spike-3-voice
```

Resultado: dry-run passou dentro do container com Node 22, Playwright image, Chromium, Xvfb e `ffprobe`.

## Próximo critério

1. Para fechar o Spike 3 como verde hosted absoluto: executar `TARGET_PHONE=5531982066263 npm run send` dentro de container com perfil WhatsApp autenticado.
2. Preservar a calibração de duração; não voltar ao wait fixo `duração + 2s` no V2.
