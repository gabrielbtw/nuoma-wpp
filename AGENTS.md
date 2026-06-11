# AGENTS

## Objetivo

Organizar o desenvolvimento por camada, com ownership exclusivo por pasta,
baixo acoplamento e handoff claro.

## Stack Canonica Da Fase 1

A Fase 1 decidiu que a stack canonica para novas features, refactors,
validacoes padrao e operacao V2 e:

- `apps/api`
- `apps/web`
- `apps/worker`
- `packages/db`
- `packages/contracts`
- `packages/ui`
- `packages/config`

Apps companion `apps/chrome-extension` e `apps/safari-extension` sao satelites
da linha V2 e seguem o agente de runtime/plataforma conforme o escopo.

A stack legada fica preservada como `legacy-maintenance`:

- `apps/web-app`
- `apps/wa-worker`
- `apps/scheduler`
- `packages/core`

Stack legada so deve receber hotfix, leitura comparativa, rollback/cutover ou
suporte de migracao com justificativa explicita. A remocao da stack legada nao
faz parte da Fase 1.

## Stack Detectada

- Monorepo com `npm workspaces` e Turborepo
- Runtime: `Node.js 22+`
- Linguagem: `TypeScript` ESM
- Backend HTTP: `Fastify` + tRPC/REST
- Frontend: `React 19`, `Vite 7`, `Tailwind 3`, `Radix UI`, `TanStack Query`
- Worker de canal: `Playwright` + CDP com Chromium persistente
- Persistencia canonica: `SQLite` com `better-sqlite3` + Drizzle
- Validacao: `zod`
- Logs: `pino`
- Processo local: `PM2`
- Testes atuais: Vitest, `node:test`, `tsx` e smokes operacionais

## Diretrizes De Trabalho

- Antes de alterar qualquer arquivo, revisar o codigo existente, o fluxo atual
  e o ownership da camada.
- Priorizar legibilidade, simplicidade e manutencao acima de cleverness ou
  abstracoes prematuras.
- Evitar imports, helpers e bibliotecas desnecessarias; se algo puder ser
  resolvido com a base atual, preferir a base atual.
- Nao introduzir dependencias pesadas sem justificativa tecnica objetiva,
  impacto esperado e comparacao com a alternativa de nao adicionar dependencia.
- Manter documentacao tecnica e executiva sincronizadas quando a mudanca alterar
  arquitetura, fluxo operacional, setup ou backlog.
- Trabalhar por etapas pequenas, reversiveis e validaveis.
- Antes de qualquer refactor grande, explicar impacto esperado, risco,
  fronteiras afetadas e plano de validacao.
- Quando um diagrama ajudar a explicar arquitetura, fluxo ou ownership, preferir
  Mermaid.

## Agentes Ativos

### 1. `core-api`

Funcao: dono de contratos publicos, regras de negocio server-side, persistencia
V2 e API HTTP.

Atua em:

- `apps/api/src/**`
- `packages/contracts/src/**`
- `packages/db/src/**`

Pode:

- Definir schema de entrada/saida, DTOs, contratos tRPC/REST e payloads de job.
- Alterar regras de negocio server-side, repositorios Drizzle e migrations V2.
- Expor contratos consumidos por web, worker e companions.

Nao pode:

- Editar UI em `apps/web/**` ou `packages/ui/**`.
- Editar runtime Playwright/CDP em `apps/worker/**`.
- Editar stack legada sem handoff para `legacy-maintenance`.
- Editar manifests, configs globais, PM2, docs ou testes compartilhados sem
  handoff para `platform-workspace`.

Validacao minima:

- `npm run typecheck --workspace @nuoma/contracts`
- `npm run typecheck --workspace @nuoma/db`
- `npm run typecheck --workspace @nuoma/api`
- `npm run test --workspace @nuoma/db`
- `npm run test --workspace @nuoma/api`

### 2. `frontend-web`

Funcao: dono da experiencia web canonica, telas, componentes, estado de UI,
design system e consumo da API.

Atua em:

- `apps/web/src/**`
- `apps/web/index.html`
- `packages/ui/src/**`

Pode:

- Criar e alterar paginas, componentes, estilos, interacoes e estados de UI.
- Consumir contratos existentes da API.
- Adaptar a UI a contratos definidos por `core-api`.
- Evoluir tokens e componentes compartilhados em `packages/ui`.

Nao pode:

- Alterar schema, DTO, query SQL, migration ou regra de negocio server-side.
- Editar worker/canal em `apps/worker/**`.
- Editar stack legada sem handoff para `legacy-maintenance`.
- Editar dependencias, build configs ou testes compartilhados sem handoff para
  `platform-workspace`.

Validacao minima:

- `npm run typecheck --workspace @nuoma/ui`
- `npm run typecheck --workspace @nuoma/web`
- `npm run build --workspace @nuoma/web`

### 3. `worker-runtime`

Funcao: dono do runtime de canal, automacao browser-based, sync, envio guardado,
artifacts e companion runtime quando houver impacto direto no Chromium/overlay.

Atua em:

- `apps/worker/src/**`
- `apps/chrome-extension/src/**` quando o escopo for overlay/bridge de canal
- `apps/safari-extension/src/**` quando o escopo for wrapper/acceptance de
  companion

Pode:

- Alterar boot, sessao, CDP, Playwright, sync, envio, evidencia e heartbeat.
- Consumir jobs e contratos definidos por `core-api`.
- Ajustar guards de canal, seletores, navegacao e recuperacao de sessao.

Nao pode:

- Alterar schema de banco, contratos publicos, migrations ou DTOs.
- Editar UI do produto em `apps/web/**` ou `packages/ui/**`.
- Editar stack legada sem handoff para `legacy-maintenance`.
- Editar dependencias, PM2, env ou testes compartilhados sem handoff para
  `platform-workspace`.

Validacao minima:

- `npm run typecheck --workspace @nuoma/worker`
- `npm run test --workspace @nuoma/worker`

### 4. `legacy-maintenance`

Funcao: dono unico da stack legada preservada para manutencao, comparacao,
rollback/cutover e migracao.

Atua em:

- `apps/web-app/**`
- `apps/wa-worker/**`
- `apps/scheduler/**`
- `packages/core/**`

Pode:

- Ler e comparar comportamento legado.
- Fazer hotfix explicitamente aprovado na stack legada.
- Apoiar V2.15 cutover, rollback e validacao historica.

Nao pode:

- Iniciar novas features ou refactors de produto na stack legada.
- Alterar banco V2, contratos V2 ou runtime canonico sem handoff para o agente
  canonico dono.
- Rodar envio real ou PM2 real sem revisao explicita de plataforma + runtime.

Validacao minima:

- `npm run legacy:typecheck`

### 5. `platform-workspace`

Funcao: dono da infraestrutura de workspace, manifests, scripts, build, PM2,
docs, CI, testes compartilhados e validacao repo-wide.

Atua em:

- `package.json`
- `package-lock.json`
- `turbo.json`
- `tsconfig.json`
- `tsconfig.base.json`
- `.env.example`
- `.github/**`
- `README.md`
- `docs/**`
- `.claude/**`
- `ecosystem.config.cjs`
- `ecosystem.canonical.config.cjs`
- `scripts/**`
- `tests/**`
- `apps/*/package.json`
- `apps/*/tsconfig.json`
- `packages/*/package.json`
- `packages/*/tsconfig.json`
- `apps/migration/**`

Pode:

- Alterar dependencias, scripts, configs de build, PM2 e documentacao.
- Ajustar setup local, comandos de dev e automacao de ambiente.
- Atualizar harness de testes compartilhados e smokes operacionais.
- Consolidar validacao repo-wide apos mudancas cross-layer.

Nao pode:

- Implementar regra de negocio dentro de `src/**` de apps/pacotes sem demanda do
  agente dono.
- Alterar comportamento de produto sem contrato aprovado pelo agente dono.

Validacao minima:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

## Regras Gerais

- Regra de dono unico: cada arquivo tem um unico agente responsavel por editar.
- Regra de stack canonica: novas features/refactors partem da linha V2 ativa.
- Regra de legado: `apps/web-app`, `apps/wa-worker`, `apps/scheduler` e
  `packages/core` sao manutencao, nao destino padrao de produto novo.
- Regra de contrato primeiro: `core-api` define schemas, rotas, DTOs, payloads
  de job e formato de estado. Os demais agentes se adaptam.
- Regra de config unica: mudanca em manifests, tsconfig, build config, docs,
  `.env.example`, PM2, CI ou testes compartilhados passa por
  `platform-workspace`.
- Regra de camada: frontend nao acessa banco; worker nao cria contrato publico;
  legado nao escreve no banco V2 sem caminho de migracao aprovado.
- Regra de split-brain: `DATABASE_URL` e `DATABASE_PATH` devem apontar para o
  banco da stack correta; mismatch deve falhar com `NUOMA_DB_STACK_MISMATCH`.
- Regra de custo IA: OpenAI/Data Lake remoto/Sora live exigem env explicita
  (`AI_COST_APPROVED=SIM` ou `SORA_BUDGET_APPROVED=SIM`).
- Regra de artefato: nao editar manualmente `node_modules/**`, `dist/**`,
  `.turbo/**`, `data/**`, `storage/**` ou outros artefatos gerados.
- Regra de smoke de envio: todo teste de envio real deve conferir destino/canal
  e anexar evidencia visual. Se o teste for WhatsApp-only sem IG aplicavel,
  registrar explicitamente `IG nao aplicavel`.

## Workflow Recomendado

### Fluxo Padrao De Feature

1. `frontend-web`, `worker-runtime` ou `platform-workspace` identifica
   necessidade de contrato novo ou mudanca de comportamento.
2. `core-api` define ou altera schema, rota, payload, regra de negocio e
   persistencia V2.
3. `platform-workspace` ajusta dependencias, configs ou testes compartilhados se
   necessario.
4. O agente consumidor adapta sua propria camada.
5. `platform-workspace` roda validacao repo-wide quando houver mudanca
   cross-layer.

### Fluxo De Incidente Operacional

1. `worker-runtime` trata falhas de sessao, Playwright, CDP, seletor, sync e
   artifacts.
2. `core-api` entra quando o incidente exigir contrato, fila, schema,
   persistencia ou regra de negocio.
3. `frontend-web` entra quando o incidente exigir feedback visual ou fluxo de
   operador.
4. `platform-workspace` entra quando o incidente exigir ambiente, script, PM2,
   docs, CI ou teste compartilhado.
5. `legacy-maintenance` entra apenas quando o incidente estiver na stack legada
   ou em cutover/rollback.

### Fluxo De Dependencias E Setup

1. O agente de camada detecta necessidade de dependencia, script ou config.
2. `platform-workspace` executa a mudanca.
3. O agente de camada conclui a implementacao usando a nova base.

## Decisoes De Controle

- Maximo de 5 agentes ativos.
- Stack canonica: `apps/api`, `apps/web`, `apps/worker`, `packages/db`,
  `packages/contracts`, `packages/ui`, `packages/config`.
- Stack legada: `apps/web-app`, `apps/wa-worker`, `apps/scheduler`,
  `packages/core`.
- Cada agente valida apenas o proprio escopo; `platform-workspace` consolida
  validacao repo-wide.
- Mudanca cross-layer sem contrato aprovado por `core-api` deve ser evitada.

## Decisoes Arquiteturais Confirmadas

### Modelo De Convergencia De Fluxos

- 3 tipos explicitos: Campanha (push manual/CSV), Automacao (trigger continuo),
  Chatbot (reativo por mensagem).
- Builder unico adapta UI conforme tipo de fluxo.
- Chatbot e entidade separada, nao subtipo de automacao.
- Ownership do builder unificado: `frontend-web` na UI e `core-api` nos
  contratos/tipos compartilhados.

### Campanhas

- Templates com variaveis (`{{nome}}`, `{{telefone}}`) e formatacao WhatsApp.
- Condicoes em steps: `replied`, `has_tag`, `channel_is`, `outside_window`.
- Campanhas evergreen com auto-avaliacao de novos contatos e adicao manual.
- Step types incluem texto, documento, link e midia.

### Inbox Unificada

- Timeline unica por contato com WhatsApp e Instagram em ordem cronologica.
- Compositor com seletor manual de canal.
- Quick actions: tag, status, lembrete, campanha e notas.

### Segmentacao

- Filtro builder AND/OR reutilizavel em contatos, campanhas e automacoes.
- Criterios: tag, status, canal, datas, procedimento e relacionamento
  Instagram.

### Automacoes

- Triggers por eventos: `message_received`, `campaign_completed`,
  `tag_applied` e `tag_removed`.
- Condicoes compostas por evento, tag e status.
- Categorias customizaveis via UI, nao enum fixo.

### Restricoes Confirmadas

- Single-user inicial, desktop/local-first e timezone Brasil.
- Apenas WhatsApp + Instagram como canais.
- Minimo de AI/LLM no fluxo cotidiano.
- SQLite otimizado para 5k-50k contatos.
- Browser automation, sem API oficial Meta no caminho de envio.
