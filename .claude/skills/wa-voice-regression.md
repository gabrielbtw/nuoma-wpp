---
name: wa-voice-regression
description: Validar IC-1 de audio nativo WhatsApp antes/depois de tocar no pipeline de voz do worker.
user_invocable: true
---

# /wa-voice-regression

Use antes de alterar gravacao, transcode, envio ou evidencias de audio.

## Invariante

WhatsApp deve receber audio nativo/PTT, nao anexo de arquivo, com duracao
coerente e evidencia visual. `apps/wa-worker` e apenas referencia legada; a
validacao canonica e `apps/worker`.

## Regras

- Nao refatorar pipeline de voz junto de mudanca visual ou de fila.
- Nao enviar para alvo real sem aprovacao explicita.
- Preservar no-relaunch e foco minimo da sessao.
- Registrar print/video e duracao quando houver envio real.

## Validacao

- `npm run test --workspace @nuoma/worker -- src/voice/audio.test.ts`
- `npm run test:v29-voice-recorder`
- Smoke real somente com destino/canal conferido.
