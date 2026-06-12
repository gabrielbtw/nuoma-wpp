# Maintenance Docs

Documentos operacionais de manutencao e gates de estabilizacao.

- [Phase 0 Freeze Inventory](./PHASE_0_FREEZE.md)
- [Phase 0 Validation Gate](./PHASE_0_VALIDATION.md)
- [Phase 1 Canonicalization](./PHASE_1_CANONICALIZATION.md)
- [Phase 2 Debt Closure](./PHASE_2_DEBT_CLOSURE.md)
- [Rebrand Phase 0 Status](./REBRAND_PHASE_0_STATUS.md)
- [Rebrand Phase 1 Status](./REBRAND_PHASE_1_STATUS.md)
- [Rebrand Phase 4 FlowBuilder V2 Status](./REBRAND_PHASE_4_FLOWBUILDER_V2_STATUS.md)
- [Rebrand Phase 5 Overlay HUD Status](./REBRAND_PHASE_5_OVERLAY_HUD_STATUS.md)
- [Rebrand Phase 6 Clean Code Status](./REBRAND_PHASE_6_CLEAN_CODE_STATUS.md)
- [Rebrand Phase 7 Docs Context Status](./REBRAND_PHASE_7_DOCS_CONTEXT_STATUS.md)
- [Rebrand Phase 8/9 Final QA Status](./REBRAND_PHASE_8_9_FINAL_QA_STATUS.md)
- [Campaign Builder Create Panel UX Status](./CAMPAIGN_BUILDER_CREATE_PANEL_UX_STATUS.md)
- [Rebrand Real Send Canary Status](./REBRAND_REAL_SEND_CANARY_STATUS.md)
- [Rebrand Cleanup Status](./REBRAND_CLEANUP_STATUS.md)
- [AI Cost Guardrails](./AI_COST_GUARDRAILS.md)

## Status Atual

| Fase           | Status                | Observacao                                                              |
| -------------- | --------------------- | ----------------------------------------------------------------------- |
| Rebrand Fase 0 | validada              | baseline, branch/status e inventario documentados                       |
| Rebrand Fase 1 | validada              | `flow-v2` zerado, TSX de produto sem `brand-*`                          |
| Rebrand Fase 4 | validada              | FlowBuilder canonico em `apps/web/src/features/flow-builder/**`         |
| Rebrand Fase 5 | validada              | Overlay HUD retematizado, contratos/test ids preservados                |
| Rebrand Fase 6 | validada              | lixo removido, Radix movido para `@nuoma/ui`, `legacy.css` reduzido     |
| Rebrand Fase 7 | validada              | roadmap, `CLAUDE.md`, `AGENTS.md` e skills alinhados                    |
| Rebrand Fase 8 | validada              | Browser QA e prints em `/tmp/nuoma-rebrand-final/*.png`                 |
| Rebrand Fase 9 | validada              | `lint`, `typecheck`, `npm test`, `build` e smokes criticos passaram     |
| FlowBuilder UX | validada              | painel de criar campanha compacto com starters reais e prints em `/tmp` |
| Real canary    | validado com ressalva | WhatsApp/Instagram enviados; WA worker confirmou errado e retentou      |
