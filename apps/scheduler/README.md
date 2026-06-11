# Scheduler

Camada responsavel pela execucao periodica do sistema.

## Papel

- rodar o ciclo de automacoes e campanhas
- limpar temporarios antigos
- vigiar o estado do `wa-worker`
- reiniciar o worker via PM2 quando o watchdog estiver habilitado

## Entrypoint

- [`src/index.ts`](/Users/gabrielbraga/Projetos/nuoma-wpp/apps/scheduler/src/index.ts)

## Comandos

```bash
npm run dev --workspace @nuoma/scheduler
npm run start --workspace @nuoma/scheduler
npm run build --workspace @nuoma/scheduler
npm run typecheck --workspace @nuoma/scheduler
```

## Variaveis mais relevantes

- `SCHEDULER_INTERVAL_SEC`
- `WATCHDOG_STALE_SECONDS`
- `ENABLE_PM2_WATCHDOG`

## Limites da camada

- as regras de elegibilidade de automacoes e campanhas vivem no `core`
- esta camada nao deve criar contratos publicos nem alterar o comportamento funcional do worker
- nesta rodada, o scheduler so recebe limpeza segura e documentacao
