---
name: nuoma-v2-feature
description: Implementar feature/refactor V2 respeitando ownership, contratos, Carvao & Cobre, FlowBuilder, Inbox e validacao por camada.
user_invocable: true
---

# /nuoma-v2-feature

Use para features e refactors em produto V2.

## Antes de editar

1. Ler `AGENTS.md` e identificar owner.
2. Confirmar se a mudanca toca contrato/API/DB, UI, worker/CDP ou plataforma.
3. Reusar componentes, tokens `nw-*` e padroes locais.
4. Nao criar UI cenografica: botao, dado e atalho visivel precisam executar
   acao real, navegar ou ficar desabilitados com motivo.

## Direcao atual

- Web canonica e overlay seguem Carvao & Cobre.
- FlowBuilder canonico fica em `apps/web/src/features/flow-builder/**`.
- Contratos publicos de campanha/automacao/chatbot nascem no `core-api`.
- Prints/smokes sao obrigatorios para UI critica quando houver mudanca visual.

## Validacao minima

- Frontend: `npm run typecheck --workspace @nuoma/ui`,
  `npm run typecheck --workspace @nuoma/web`,
  `npm run build --workspace @nuoma/web`.
- Worker: `npm run typecheck --workspace @nuoma/worker`,
  `npm run test --workspace @nuoma/worker`.
- API/DB: rodar contratos/db/api conforme `AGENTS.md`.
- Cross-layer: `npm run lint`, `npm run typecheck`, `npm test`,
  `npm run build`.
