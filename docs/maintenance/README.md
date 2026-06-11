# Maintenance Docs

Documentos operacionais de manutencao e gates de estabilizacao.

- [Phase 0 Freeze Inventory](./PHASE_0_FREEZE.md)
- [Phase 0 Validation Gate](./PHASE_0_VALIDATION.md)
- [Phase 1 Canonicalization](./PHASE_1_CANONICALIZATION.md)
- [Rebrand Phase 0 Status](./REBRAND_PHASE_0_STATUS.md)
- [Rebrand Phase 1 Status](./REBRAND_PHASE_1_STATUS.md)
- [Rebrand Cleanup Status](./REBRAND_CLEANUP_STATUS.md)
- [AI Cost Guardrails](./AI_COST_GUARDRAILS.md)

## Status Atual

| Fase | Status | Observacao |
| --- | --- | --- |
| Rebrand Fase 0 | retomada estavel | gates focados passaram; Fase 1 ainda bloqueada por token/CSS legado |
| Rebrand Fase 1 | validada | `flow-v2` zerado, TSX de produto sem `brand-*`, prints em `/tmp/nuoma-rebrand-phase1/` |
| Context diet | parcial | detalhes movidos para `docs/agent-context/**`; `CLAUDE.md` ja esta curto |
