# AGENTS

Objetivo: organizar desenvolvimento por camada, ownership exclusivo por pasta,
baixo acoplamento e handoff claro.

## Stack

Stack canônica V2 para novas features, refactors e operação:

- `apps/api`
- `apps/web`
- `apps/worker`
- `packages/contracts`
- `packages/db`
- `packages/ui`
- `packages/config`

Companions V2: `apps/chrome-extension`, `apps/safari-extension`.

Stack legada preservada para leitura, hotfix aprovado, rollback e cutover:

- `apps/web-app`
- `apps/wa-worker`
- `apps/scheduler`
- `packages/core`

Detalhes operacionais sob demanda: `docs/agent-context/CANONICAL_CONTEXT.md`.

## Regras gerais

- Revisar fluxo e ownership antes de editar.
- Preferir mudanças pequenas, reversíveis e validáveis.
- Não criar dependência pesada sem justificativa objetiva.
- Documentar mudanças que alterem arquitetura, operação, setup ou backlog.
- Não editar `node_modules/**`, `dist/**`, `.turbo/**`, `data/**`,
  `storage/**` ou artefatos gerados.
- Contratos públicos nascem no `core-api`; consumidores se adaptam depois.
- Legado não recebe feature nova.
- `DATABASE_URL` e `DATABASE_PATH` devem apontar para a stack correta; mismatch
  falha com `NUOMA_DB_STACK_MISMATCH`.
- OpenAI/Data Lake remoto/Sora live exigem env explícita
  (`AI_COST_APPROVED=SIM` ou `SORA_BUDGET_APPROVED=SIM`).
- Teste de envio real exige destino/canal conferido e evidência visual; se for
  WhatsApp-only, registrar `IG nao aplicavel`.
- UI de produto não pode conter dado fabricado, ação morta, atalho falso ou
  botão cenográfico. A ação precisa executar, navegar ou ficar desabilitada com
  motivo visível.
- Mudança visual em fluxo crítico exige smoke ou print desktop/mobile salvo fora
  do repo, salvo quando a alteração for puramente documental.

## Ownership

### `core-api`

Atua em:

- `apps/api/src/**`
- `packages/contracts/src/**`
- `packages/db/src/**`

Pode alterar contratos tRPC/REST, schemas, DTOs, payloads de job, regras
server-side, migrations V2 e repositórios Drizzle.

Não pode editar UI, worker/CDP, stack legada ou configs globais sem handoff.

Validação mínima:

```bash
npm run typecheck --workspace @nuoma/contracts
npm run typecheck --workspace @nuoma/db
npm run typecheck --workspace @nuoma/api
npm run test --workspace @nuoma/db
npm run test --workspace @nuoma/api
```

### `frontend-web`

Atua em:

- `apps/web/src/**`
- `apps/web/index.html`
- `packages/ui/src/**`

Pode alterar páginas, componentes, estilos, interações, estado de UI, consumo de
API e componentes compartilhados.

Não pode alterar schema, query, migration, regra server-side, worker/CDP,
dependências ou configs sem handoff.

FlowBuilder canônico fica em `apps/web/src/features/flow-builder/**`; qualquer
mudança de contrato de campanha, automação ou chatbot chama `core-api` primeiro.

Validação mínima:

```bash
npm run typecheck --workspace @nuoma/ui
npm run typecheck --workspace @nuoma/web
npm run build --workspace @nuoma/web
```

### `worker-runtime`

Atua em:

- `apps/worker/src/**`
- `apps/chrome-extension/src/**` quando o escopo for overlay/bridge de canal
- `apps/safari-extension/src/**` quando o escopo for companion runtime

Pode alterar boot, sessão, CDP, Playwright, sync, envio, evidência, heartbeat,
guards, seletores e recuperação de sessão.

Não pode alterar contratos públicos, migrations, DB, UI do produto ou configs
sem handoff.

Overlay/HUD WhatsApp é responsabilidade `worker-runtime`; preservar root id,
test ids, bridge globals, `data-nuoma-*`, foco mínimo e sessão Chromium ativa.

Validação mínima:

```bash
npm run typecheck --workspace @nuoma/worker
npm run test --workspace @nuoma/worker
```

### `legacy-maintenance`

Atua em:

- `apps/web-app/**`
- `apps/wa-worker/**`
- `apps/scheduler/**`
- `packages/core/**`

Pode ler, comparar, apoiar V2.15 e aplicar hotfix explicitamente aprovado.

Não pode iniciar feature/refactor de produto, escrever no DB V2 ou rodar envio
real/PM2 real sem revisão explícita.

Validação mínima:

```bash
npm run legacy:typecheck
```

### `platform-workspace`

Atua em:

- manifests, lockfiles, tsconfigs, PM2, CI, docs, `.claude/**`
- `scripts/**`, `tests/**`, `apps/migration/**`
- `apps/*/package.json`, `apps/*/tsconfig.json`
- `packages/*/package.json`, `packages/*/tsconfig.json`

Pode alterar dependências, scripts, configs, documentação, harness de testes,
setup local e validação repo-wide.

Não pode implementar regra de negócio em `src/**` sem demanda do agente dono.

Validação mínima:

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Handoff

- `frontend-web`, `worker-runtime` e companions chamam `core-api` para contratos,
  payloads, fila, schema e persistência.
- Todos chamam `platform-workspace` para deps, scripts, configs, docs, PM2, CI e
  testes compartilhados.
- `platform-workspace` consolida validação repo-wide após mudanças cross-layer.

## Fluxos

Feature:

1. Definir contrato e persistência no `core-api`.
2. Ajustar plataforma se houver deps/config/testes compartilhados.
3. Adaptar consumidores na própria camada.
4. Validar camada e, se cruzar ownership, validar repo-wide.

Incidente:

1. `worker-runtime` trata sessão, Playwright, CDP, seletor, sync e artifacts.
2. `core-api` entra para contrato, fila, schema, persistência ou regra.
3. `frontend-web` entra para feedback visual ou fluxo de operador.
4. `platform-workspace` entra para ambiente, script, PM2, docs, CI ou teste.
5. `legacy-maintenance` entra só para stack legada/cutover/rollback.

## Decisões confirmadas

- Máximo de cinco agentes ativos.
- Single-user inicial, desktop/local-first e timezone Brasil.
- Canais cotidianos: WhatsApp e Instagram.
- SQLite otimizado para 5k-50k contatos.
- Browser automation; sem API oficial Meta no caminho de envio.
- Fluxos explícitos: Campanha, Automação e Chatbot.
- Builder unificado: UI em `frontend-web`, contratos em `core-api`.
- Inbox unificada: timeline por contato, seletor manual de canal e quick
  actions de tag/status/lembrete/campanha/notas.
- Segmentação AND/OR reutilizável em contatos, campanhas e automações.
