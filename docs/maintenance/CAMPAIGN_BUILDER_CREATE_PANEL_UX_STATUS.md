# Campaign Builder Create Panel UX Status

Data: 2026-06-12

## Escopo

Reimaginado o painel lateral de criar campanha no FlowBuilder canonico:

- `apps/web/src/features/flow-builder/inspector/CampaignFlowSettings.tsx`
- `apps/web/src/features/flow-builder/screens/CampaignBuilderScreen.tsx`
- `apps/web/src/features/flow-builder/state/campaign-store.tsx`

## Mudancas

- Painel deixou de usar secoes grandes em card e passou para uma superficie plana e compacta.
- Nome, canal, agenda, starters, audiencia e prontidao cabem no inspector desktop sem scroll horizontal.
- Starters rapidos aplicam rascunhos reais:
  - Reativacao WhatsApp
  - Pos-atendimento Instagram
  - Remarketing seguro
- A acao de starter atualiza nome, canal, steps, audiencia e layout do canvas via reducer.
- O estado de prontidao continua usando `readyChecks` e `buildSteps`.

## Evidencias

Referencia gerada por imagem:

- `/Users/gabrielbraga/.codex/generated_images/019eb7e2-f34a-7ee0-8209-8796d3002c76/ig_063ebc30d39c81d9016a2b8486f63c8191bc1280e27dc761a5.png`
- `/Users/gabrielbraga/.codex/generated_images/019eb7e2-f34a-7ee0-8209-8796d3002c76/ig_06821537855c93d9016a2b6f69398881918b53e8ad3e8ec6a6.png`

Prints finais fora do repo:

- `/tmp/nuoma-rebrand-final/campaign-builder-create-panel-final-1440.png`
- `/tmp/nuoma-rebrand-final/campaign-builder-create-panel-final-1280.png`

Metricas Browser/Playwright:

- 1440px: `settings.scrollWidth=327`, `settings.clientWidth=327`, `bodyScrollWidth=1440`
- 1280px: `settings.scrollWidth=327`, `settings.clientWidth=327`, `bodyScrollWidth=1280`
- Starter `Remarketing seguro` aplicado com `activeName=Remarketing seguro`

## Validacao

```bash
npm run test --workspace @nuoma/web -- src/features/flow-builder src/flow-builder/lib
npm run typecheck --workspace @nuoma/web
```

Resultado: passou.
