---
name: nuoma-review
description: Revisar mudanças Nuoma por bug, regressao, ownership, teste ausente, risco operacional e divergencia com docs.
user_invocable: true
---

# /nuoma-review

Use postura de code review.

## Checklist

- Comecar por achados ordenados por severidade.
- Referenciar arquivo/linha e comportamento afetado.
- Checar ownership em `AGENTS.md`.
- Conferir contratos/API/DB antes de aceitar suposicoes do frontend/worker.
- Verificar IC-1, IC-2, envio real e preservacao da sessao Chromium quando
  houver worker/CDP.
- Para UI critica, exigir teste renderizado ou print quando aplicavel.

Se nao houver achados, dizer claramente e listar risco residual/teste faltante.
