# AGENTS

## Objetivo
Organizar o desenvolvimento por camada, com ownership exclusivo por pasta, baixo acoplamento e handoff claro.

## Stack Detectada
- Monorepo com `npm workspaces`
- Runtime: `Node.js 22+`
- Linguagem: `TypeScript` ESM
- Backend HTTP: `Fastify`
- Frontend: `React 19`, `Vite 7`, `Tailwind 3`, `Radix UI`, `TanStack Query`, `React Router 7`
- Worker de canal: `Playwright` com Chromium persistente
- Orquestracao: processo `scheduler` em Node
- Persistencia: `SQLite` com `better-sqlite3`
- Validacao: `zod`
- Logs: `pino`
- Processo local: `PM2`
- Testes atuais: `node:test` + `tsx`

## Agentes Ativos

### 1. `core-api`
Funcao: dono unico de contratos, regras de negocio, banco, repositorios, servicos e API HTTP.

Atua em:
- `packages/core/src/**`
- `apps/web-app/src/server/**`

Pode:
- Criar e alterar schema de entrada e saida
- Definir DTOs, formatos de payload e contratos de jobs
- Alterar regras de negocio de contatos, campanhas, automacoes, conversas, logs e configuracoes
- Alterar queries SQLite, migrations e acesso a dados
- Criar ou alterar rotas Fastify
- Expor contratos consumidos por frontend, worker e scheduler

Nao pode:
- Editar `apps/web-app/src/client/**`
- Editar `apps/wa-worker/src/**`
- Editar `apps/scheduler/src/**`
- Editar manifests, configs globais, scripts raiz ou testes compartilhados sem handoff para `platform-workspace`

Validacao minima:
- `npm run typecheck --workspace @nuoma/core`
- `npm run typecheck --workspace @nuoma/web-app`

### 2. `frontend-web`
Funcao: dono unico da experiencia web, telas, componentes, estado de UI e consumo da API.

Atua em:
- `apps/web-app/src/client/**`
- `apps/web-app/index.html`

Pode:
- Criar e alterar paginas, componentes, estilos e interacoes
- Consumir endpoints existentes
- Adaptar a UI a novos contratos definidos por `core-api`
- Ajustar roteamento client-side, loading states, filtros, formularios e feedback visual

Nao pode:
- Alterar resposta de endpoint, schema, DTO, query SQL ou regra de negocio
- Editar `apps/web-app/src/server/**`
- Editar `packages/core/src/**`
- Editar configs de build, dependencias ou testes compartilhados sem handoff para `platform-workspace`

Validacao minima:
- `npm run typecheck --workspace @nuoma/web-app`
- `npm run build --workspace @nuoma/web-app`

### 3. `wa-worker`
Funcao: dono unico do runtime de automacao do WhatsApp Web e da execucao browser-based.

Atua em:
- `apps/wa-worker/src/**`

Pode:
- Alterar boot, sessao, autenticacao e sync do Playwright
- Alterar envio de mensagens, captura de falhas, artifacts e heartbeat do worker
- Ajustar seletores, estrategia de navegacao e recuperacao de sessao
- Consumir contratos e jobs definidos por `core-api`

Nao pode:
- Alterar schema de banco, contratos de jobs, DTOs ou respostas HTTP
- Editar `packages/core/src/**`
- Editar `apps/web-app/src/client/**`
- Editar `apps/scheduler/src/**`
- Editar dependencias, PM2, env de exemplo ou testes compartilhados sem handoff para `platform-workspace`

Validacao minima:
- `npm run typecheck --workspace @nuoma/wa-worker`

### 4. `scheduler-runtime`
Funcao: dono unico da orquestracao periodica, watchdog, ciclos e operacao agendada.

Atua em:
- `apps/scheduler/src/**`

Pode:
- Alterar cadence de execucao, watchdog, cleanup e publicacao de estado do scheduler
- Ajustar estrategia de restart operacional e controle de ciclo
- Consumir contratos e funcoes expostas por `core-api`

Nao pode:
- Alterar regras de elegibilidade de automacoes ou campanhas que vivem em `packages/core`
- Alterar contratos de jobs, DTOs ou rotas HTTP
- Editar `apps/wa-worker/src/**`
- Editar `apps/web-app/src/client/**`
- Editar configs globais, dependencias ou testes compartilhados sem handoff para `platform-workspace`

Validacao minima:
- `npm run typecheck --workspace @nuoma/scheduler`

### 5. `platform-workspace`
Funcao: dono unico da infraestrutura de workspace, manifests, scripts, build, docs e validacao compartilhada.

Atua em:
- `package.json`
- `package-lock.json`
- `tsconfig.json`
- `tsconfig.base.json`
- `.env.example`
- `README.md`
- `ecosystem.config.cjs`
- `tests/**`
- `apps/web-app/package.json`
- `apps/web-app/tsconfig.json`
- `apps/web-app/vite.config.ts`
- `apps/web-app/tailwind.config.ts`
- `apps/web-app/postcss.config.cjs`
- `apps/wa-worker/package.json`
- `apps/wa-worker/tsconfig.json`
- `apps/scheduler/package.json`
- `apps/scheduler/tsconfig.json`
- `packages/core/package.json`
- `packages/core/tsconfig.json`

Pode:
- Alterar dependencias, scripts, configs de build e documentacao
- Ajustar setup local, PM2, comandos de dev e automacao de ambiente
- Atualizar o harness de testes compartilhados
- Consolidar validacao repo-wide apos mudancas cross-layer

Nao pode:
- Implementar regra de negocio dentro de `src/**` dos apps ou do core
- Alterar comportamento de produto sem demanda originada por outro agente

Validacao minima:
- `npm run typecheck`
- `npm test`
- `npm run build`

## Regras Gerais
- Regra de dono unico: cada arquivo tem um unico agente responsavel por editar.
- Regra de contrato primeiro: `core-api` define schema, rotas, DTOs, payloads de job e formato de estado. Os demais agentes se adaptam.
- Regra de config unica: qualquer mudanca em `package.json`, `tsconfig`, build config, docs, `.env.example`, PM2 ou testes compartilhados passa por `platform-workspace`.
- Regra de camada: frontend nao acessa banco nem assume estrutura interna; worker e scheduler nao criam contrato publico por conta propria.
- Regra de handoff: se um agente precisar de mudanca fora da propria area, ele abre demanda para o dono da pasta e espera o contrato final.
- Regra de validacao: cada agente valida o proprio escopo antes de entregar.
- Regra de artefato: nao editar manualmente `node_modules/**`, `apps/web-app/dist/**`, `storage/**` ou outros artefatos gerados.

## Trilha Separada De Integracoes
Instagram, Data Lake e AI ficam fora do fluxo cotidiano e so entram quando houver iniciativa explicita.

Ownership dessa trilha continua seguindo a camada:
- `core-api`: `apps/web-app/src/server/lib/instagram-assisted.ts`, `apps/web-app/src/server/lib/instagram-sync.ts`, `apps/web-app/src/server/routes/instagram.ts`, `apps/web-app/src/server/routes/data-lake.ts`, `packages/core/src/services/data-lake-service.ts`, `packages/core/src/services/instagram-contact-import-service.ts`, `packages/core/src/services/instagram-contact-matching-service.ts`, `packages/core/src/repositories/data-lake-repository.ts`
- `frontend-web`: `apps/web-app/src/client/pages/imports.tsx`, `apps/web-app/src/client/pages/trends.tsx` e qualquer UI futura dessa trilha
- `wa-worker`: somente quando a integracao exigir impacto direto em sessao compartilhada de browser ou automacao do Chromium
- `platform-workspace`: configs, deps, docs e testes da trilha

Regra adicional:
- Quando a trilha de integracoes estiver ativa, `core-api` coordena o contrato, e os demais agentes alteram apenas a propria camada.

## Workflow Recomendado

### Fluxo Padrao De Feature
1. `frontend-web`, `wa-worker` ou `scheduler-runtime` identifica necessidade de contrato novo ou mudanca de comportamento.
2. `core-api` define ou altera schema, rota, payload, regra de negocio e persistencia.
3. `platform-workspace` ajusta dependencias, configs ou testes compartilhados se necessario.
4. O agente consumidor adapta sua propria camada.
5. `platform-workspace` roda validacao repo-wide apenas quando houve mudanca cross-layer.

### Fluxo De Incidente Operacional
1. `wa-worker` trata falhas de sessao, Playwright, seletor, sync e artifacts.
2. `scheduler-runtime` trata watchdog, ciclo, restart e limpeza operacional.
3. Se o incidente exigir mudanca de contrato, fila, schema ou regra de negocio, `core-api` entra antes da correcao final.
4. `platform-workspace` entra apenas se o incidente exigir ajuste de ambiente, script, PM2, docs ou teste compartilhado.

### Fluxo De Dependencias E Setup
1. O agente de camada detecta necessidade de dependencia, script ou config.
2. `platform-workspace` executa a mudanca.
3. O agente de camada conclui a implementacao usando a nova base.

## Quem Chama Quem
- `frontend-web` chama `core-api` para qualquer mudanca de contrato.
- `wa-worker` chama `core-api` para qualquer mudanca de payload, fila, schema ou estado persistido.
- `scheduler-runtime` chama `core-api` para qualquer mudanca em regra de automacao, campanha ou contratos de fila.
- Todos os agentes chamam `platform-workspace` para manifests, configs, docs e testes compartilhados.
- `platform-workspace` nao inicia feature de produto sozinho; ele suporta os demais.

## Decisoes De Controle
- Maximo de 5 agentes ativos.
- `packages/core` tem dono unico: `core-api`.
- Cada agente valida apenas o proprio escopo.
- Mudanca cross-layer sem contrato aprovado por `core-api` deve ser evitada.
