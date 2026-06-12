# Rebrand Real Send Canary Status

Data: 2026-06-12

## Escopo

Canario real solicitado para validar a sessao Chromium ja logada:

- WhatsApp: `5531982066263`
- Instagram: `gabriell_braga`
- Token: `REBRAND-20260612012411`

## Comando

```bash
REBRAND_REAL_SEND=SIM \
REBRAND_REAL_TOKEN=REBRAND-20260612012411 \
REBRAND_REAL_WA_PHONE=5531982066263 \
REBRAND_REAL_IG_HANDLE=gabriell_braga \
WA_SEND_ALLOWED_PHONES=5531982066263 \
WA_SEND_ALLOWED_PHONE=5531982066263 \
IG_SEND_ALLOWED_HANDLES=gabriell_braga \
REBRAND_REAL_TIMEOUT_MS=240000 \
npm run test:rebrand-real-canary
```

Resultado final:

```text
rebrand-real-canary|token=REBRAND-20260612012411|wa=5531982066263|waJob=3048|waShot=data/rebrand-real-canary/REBRAND-20260612012411-whatsapp.png|ig=gabriell_braga|igShot=data/rebrand-real-canary/REBRAND-20260612012411-instagram.png|report=data/rebrand-real-canary/REBRAND-20260612012411-report.json|realSend=completed
```

## Evidencias

- Relatorio JSON: `data/rebrand-real-canary/REBRAND-20260612012411-report.json`
- Print WhatsApp: `data/rebrand-real-canary/REBRAND-20260612012411-whatsapp.png`
- Print Instagram: `data/rebrand-real-canary/REBRAND-20260612012411-instagram.png`

## Resultado por canal

WhatsApp:

- Envio real apareceu no WhatsApp Web com o token `REBRAND-20260612012411-WA`.
- O job `3048` ficou `failed`.
- Erro do worker: `send_message did not produce a sent outgoing text bubble: null`.
- O print mostra tres bolhas com o mesmo token, porque o worker nao reconheceu a confirmacao visual e retentou.
- A mensagem no DB tambem ficou com `status=failed`, apesar da evidencia visual no WhatsApp.

Instagram:

- Envio real apareceu no Instagram Direct com o token `REBRAND-20260612012411-IG`.
- O envio usou o thread real `110051807055981` para `gabriell_braga`.
- A reexecucao do canario ficou idempotente: quando o token ja existe na tela, o script recaptura evidencia e nao reenvia.

## Ajustes no smoke

- Adicionado `test:rebrand-real-canary`.
- O smoke exige `REBRAND_REAL_SEND=SIM`.
- O smoke valida alvos fixos para impedir envio acidental fora de:
  - `5531982066263`
  - `gabriell_braga`
- O smoke limita novas tentativas WhatsApp do job a `max_attempts=1` para evitar duplicatas em novas execucoes.
- O smoke reaproveita evidencia visual existente quando o mesmo token ja foi enviado.
- O smoke usa `external_thread_id` real do Instagram quando disponivel, evitando a busca fragil do composer novo.

## Divida aberta

Corrigir a confirmacao visual do worker WhatsApp:

- Arquivo: `apps/worker/src/sync/cdp.ts`
- Area: `inspectOutgoingTextBubble`
- Sintoma: `document.querySelectorAll(".message-out")` retorna zero na UI atual do WhatsApp Web.
- Impacto: envio real pode sair no WhatsApp, mas o worker marca o job como failed e retenta.
- Proxima acao: atualizar o detector de bolha de saida para a DOM atual do WhatsApp Web e adicionar teste/smoke dedicado antes de reabilitar retentativas > 1 no canario.
