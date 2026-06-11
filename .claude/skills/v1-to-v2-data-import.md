---
name: v1-to-v2-data-import
description: Run the real V2.15 V1 to V2 data import workflow with preflight, dry-run, apply, validation, evidence capture and rollback gates.
user_invocable: true
---

# /v1-to-v2-data-import - V2.15 import operacional

Use esta skill somente quando o owner pedir explicitamente para preparar ou executar a migracao V1 -> V2. O V1 deve ser tratado como read-only.

## Regras

- Nunca escrever no DB V1.
- Sempre rodar `preflight` antes de `apply`.
- `apply` exige `V215_CONFIRM_CUTOVER=SIM`.
- Nao iniciar worker/scheduler V2 antes de concluir validate e smoke.
- Registrar evidencia visual do smoke real. Se Instagram nao entrar no teste, registrar `IG nao aplicavel`.

## Comandos

Preflight:

```bash
npm run migration:v215:preflight -- --report=data/reports/v215-preflight.json
```

Dry-run:

```bash
npm run migration:v215:dry-run -- --report=data/reports/v215-dry-run.json
```

Apply:

```bash
V215_CONFIRM_CUTOVER=SIM npm run migration:v215:apply -- --report=data/reports/v215-apply.json
```

Validate:

```bash
npm run migration:v215:validate -- --report=data/reports/v215-validate.json
```

Smokes:

```bash
npm run test:v215-cutover-preflight
npm run test:v215-cutover-apply
```

## Workflow

1. Confirmar paths: `V215_V1_DB_PATH`, `V215_V2_DB_PATH`, `V215_V1_STORAGE_ROOT`, `V215_MEDIA_TARGET_ROOT`.
2. Rodar preflight e bloquear se houver blockers.
3. Rodar dry-run e revisar contagens, orphans, midias ausentes e `data_lake_*` ignorado.
4. Rodar apply em clone V2.
5. Rodar validate no clone.
6. Rodar smokes V2.15.
7. Fazer backup final V1 e backup pre-cutover V2.
8. Rodar apply real com `V215_CONFIRM_CUTOVER=SIM`.
9. Rodar validate real.
10. Fazer smoke T+0 com print app + WPP/CDP.
11. Monitorar 24h.

## Escopo importado

- Usuario admin V2.
- Tags, contacts, contact_tags, attendants.
- Media assets com copia fisica quando o arquivo existe.
- Conversations e messages.
- Campaigns, campaign steps embutidos e recipients.
- Campaign executions legadas como `system_events`.
- Automations com actions embutidas.
- Automation runs/state como `system_events`.
- Chatbots e chatbot rules.
- Jobs vivos do V1.
- Reminders.
- Audit logs.
- System logs/events.
- `data_lake_*` ignorado por politica.

## Rollback

Se o cutover falhar, seguir `docs/runbooks/CUTOVER_ROLLBACK.md`.

## Referencias

- `docs/migration/CUTOVER_PLAN.md`
- `docs/runbooks/CUTOVER_ROLLBACK.md`
- `docs/migration/V1_TO_V2_DATA_MAP.md`
- `apps/migration/src/index.ts`
