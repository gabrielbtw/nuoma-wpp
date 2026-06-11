# Fase 2 - Debt Closure E Validacao Limpa

## Objetivo

Fechar as pendencias deixadas intencionalmente pelas Fases 0 e 1 sem refactor
funcional: formatacao global, artefatos locais rastreados, drift documental
bloqueante e gate executavel da trilha de manutencao.

Esta fase nao altera fluxo real de envio, banco, contratos publicos, PM2,
workers, OpenAI, Sora, Instagram real ou WhatsApp real.

## Escopo

### Em escopo

- Resolver `npm run format:check`.
- Remover do controle de versao artefatos locais historicos em `data/`,
  preservando os arquivos no disco local.
- Manter `data/`, `storage/`, `dist/` e `.turbo/` ignorados.
- Adicionar `npm run test:phase2-debt-closure`.
- Adicionar `npm run phase2:validate` como agregador operacional.
- Registrar os comandos executados, falhas e donos.
- Fechar referencias documentais objetivamente obsoletas que impedem validacao.

### Fora de escopo

- Refactor de produto ou reorganizacao arquitetural ampla.
- Mudanca em schema, migrations, contratos publicos ou jobs.
- Troca de PM2 real ou start/reload automatico.
- Smoke real de WhatsApp, Instagram, Sora, OpenAI/Data Lake ou hosted canary.
- Cache de prompts/modelos; isso fica para fase posterior.

## Estado Inicial

Snapshot em 2026-06-11:

```text
## feat/rebrand-carvao-cobre
 M apps/web/src/campaigns/CampaignOperationalPanels.tsx
 M apps/web/src/campaigns/CampaignsOverviewPanel.tsx
 M apps/web/src/campaigns/SafeRemarketingConsole.tsx
 M apps/web/src/inbox/QueueIndicator.tsx
 M apps/web/src/pages/DashboardPage.tsx
 M apps/web/src/pages/JobsPage.tsx
 M apps/web/src/pages/OperationsPage.tsx
 M apps/web/src/shell/Sidebar.tsx
 M tests/design-system-v3-smoke.mjs
```

`npm run format:check` falhava em 280 arquivos. Os arquivos alterados acima
pertencem a trilha `rebrand-ui` e devem ser preservados; a Fase 2 pode aplicar
somente ajustes mecanicos de Prettier sobre eles.

## Decisoes

- A formatacao sera corrigida mecanicamente com Prettier, sem mudanca manual de
  comportamento.
- Artefatos historicos em `data/` saem do indice Git com `git rm --cached`,
  sem apagar os arquivos locais.
- O gate `test:phase2-debt-closure` falha se novos artefatos locais estiverem
  rastreados.
- Referencias legadas continuam permitidas quando marcadas como historicas ou
  legacy; referencias operacionais obsoletas devem ser removidas.
- Validacoes de plataforma usam `AI_PROVIDER=none` por padrao.

## Validacao

Comandos alvo:

```bash
npm run format:check
npm run test:phase2-debt-closure
npm run phase2:validate
npm run lint
npm run typecheck
npm run build
npm test
npm run lint:canonical
npm run typecheck:canonical
npm run build:canonical
npm run test:canonical
npm run legacy:typecheck
npm run test:artifact-retention
npm run test:product-confidence
```

Sem validacao externa live:

- WhatsApp real.
- Instagram real.
- Sora live.
- OpenAI/Data Lake remoto.
- PM2 real.
- Hosted canary.

## Status

| Item                        | Status       | Dono                 | Observacao                                             |
| --------------------------- | ------------ | -------------------- | ------------------------------------------------------ |
| `format:check`              | em andamento | `platform-workspace` | Divida global de Prettier sera corrigida mecanicamente |
| artefatos rastreados        | em andamento | `platform-workspace` | Remover do indice Git, preservar arquivos locais       |
| drift documental bloqueante | em andamento | `platform-workspace` | Foco em referencias obsoletas operacionais             |
| gate Fase 2                 | em andamento | `platform-workspace` | `npm run test:phase2-debt-closure`                     |
| agregador Fase 2            | em andamento | `platform-workspace` | `npm run phase2:validate`                              |
| validacao repo-wide         | pendente     | `platform-workspace` | Rodar apos formatacao e limpeza do indice              |

## Politica De Custo IA

Durante esta fase, `AI_PROVIDER=none` continua sendo o default operacional para
validacoes de plataforma. OpenAI/Data Lake remoto exige `AI_COST_APPROVED=SIM`.
Sora exige `SORA_BUDGET_APPROVED=SIM`. Nenhum comando live sera executado nesta
fase.
