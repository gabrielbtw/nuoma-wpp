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

## Correcao da confirmacao WhatsApp

Status: corrigido em 2026-06-12.

Mudanca:

- Arquivo: `apps/worker/src/sync/cdp.ts`
- Area: `inspectOutgoingTextBubble` e `inspectOutgoingBubble`
- O detector preserva `.message-out` para DOM antigo.
- O detector agora tambem usa `#main [data-id]` visivel, com evidencia de saida por `aria-label="Voce:"`/`aria-label="You:"`, `tail-out`, `msg-*` e `wds-ic-*`.
- Status de entrega agora reconhece os marcadores atuais `wds-ic-read`, `wds-ic-check`, `aria-label="Entregue"` e equivalentes antigos `msg-dblcheck-*`.

Regressao automatizada:

```bash
npm run test --workspace @nuoma/worker -- src/sync/cdp.test.ts
npm run typecheck --workspace @nuoma/worker
npm run lint --workspace @nuoma/worker
npm run test --workspace @nuoma/worker
```

Resultado:

- `src/sync/cdp.test.ts`: 22 testes passaram.
- Worker completo: 127 testes passaram.

Validacao live sem novo envio:

- A expressao corrigida foi executada na sessao real do Chrome/CDP contra o token `REBRAND-20260612012411-WA`.
- Resultado: `externalId=3EB0B1F8088AEFDD34C225`, `deliveryStatus=read`, `hasExpectedText=true`.

Canario real WhatsApp-only depois da correcao:

```text
whatsapp-fix-canary|token=REBRAND-FIX-20260612044907|job=3049|status=completed|attempts=1|matches=1|shot=data/rebrand-real-canary/REBRAND-FIX-20260612044907-whatsapp-fix.png|report=data/rebrand-real-canary/REBRAND-FIX-20260612044907-whatsapp-fix-report.json
```

Evidencia:

- Relatorio JSON: `data/rebrand-real-canary/REBRAND-FIX-20260612044907-whatsapp-fix-report.json`
- Print WhatsApp: `data/rebrand-real-canary/REBRAND-FIX-20260612044907-whatsapp-fix.png`
- Job `3049`: `completed`, `attempts=1`, `last_error=null`
- Mensagem `199810`: `status=sent`, `external_id=3EB08A94BB843092E3A538`
- DOM WhatsApp: exatamente 1 bolha para `REBRAND-FIX-20260612044907-WA`

Instagram nao foi reenviado nesta validacao corretiva; o canario Instagram anterior continua registrado acima.
