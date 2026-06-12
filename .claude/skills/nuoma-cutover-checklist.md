---
name: nuoma-cutover-checklist
description: Checklist operacional para cutover V1->V2, rollback, janela de aplicacao e validacao final sem escrever no DB V1.
user_invocable: true
---

# /nuoma-cutover-checklist

Use quando o trabalho envolver cutover real, rollback, janela operacional ou
go/no-go de V2.15.

## Regras

- Nunca escrever no DB V1.
- Preflight e dry-run vem antes de qualquer apply.
- Apply real exige confirmacao explicita e `V215_CONFIRM_CUTOVER=SIM`.
- Worker/scheduler so sobem contra dados migrados depois de validate + smoke.
- Envio real exige destino/canal conferido, evidencia visual e nota `IG nao aplicavel`
  quando for WhatsApp-only.

## Sequencia

1. Confirmar `DATABASE_URL`, `DATABASE_PATH`, storage e stack ativa.
2. Gerar backup local e registrar caminho.
3. Rodar preflight e bloquear em qualquer blocker.
4. Rodar dry-run, revisar contagens, orfaos e midias ausentes.
5. Aplicar primeiro em clone, validar, ensaiar rollback.
6. Aplicar real apenas na janela aprovada.
7. Rodar smoke produto, monitorar fila/DLQ/sync por 24h.

## Comandos

- `npm run migration:v215:preflight`
- `npm run migration:v215:dry-run`
- `V215_CONFIRM_CUTOVER=SIM npm run migration:v215:apply`
- `npm run migration:v215:validate`
- `npm run test:v215-cutover-preflight`
- `npm run test:v215-cutover-apply`

Runbooks longos: `docs/migration/CUTOVER_PLAN.md` e
`docs/runbooks/CUTOVER_ROLLBACK.md`.
