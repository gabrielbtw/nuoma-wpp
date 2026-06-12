---
name: nuoma-worker-observability
description: Diagnosticar worker/CDP/queue/overlay/sync com postura read-only, preservando sessao Chromium e contratos de envio.
user_invocable: true
---

# /nuoma-worker-observability

Use para incidentes ou investigacoes em `apps/worker`, CDP, overlay, fila,
DLQ, sync WhatsApp/Instagram e evidencia operacional.

## Limites

- Read-only por padrao; mostrar SQL, restart ou mutacao antes de aplicar.
- Nao parar worker, resetar sessao, reiniciar PM2 ou enviar mensagem real sem
  aprovacao explicita.
- Preservar IC-1 audio e IC-2 multi-step sender.
- Para smokes reais, usar a sessao Chromium/Chrome for Testing ativa quando
  possivel e registrar destino/canal.

## Triagem rapida

- `npm run worker:status`
- `curl -s http://127.0.0.1:9222/json/version`
- `npm run typecheck --workspace @nuoma/worker`
- `npm run test --workspace @nuoma/worker`

Verifique stack ativa, `NUOMA_DB_STACK_MISMATCH`, jobs ativos, DLQ, system
events, screenshots/videos e estado de autenticacao antes de editar codigo.
