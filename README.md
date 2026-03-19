# Nuoma WPP

Aplicação web local para macOS com CRM embutido sobre o WhatsApp Web, automações por regra, campanhas CSV, inbox local e observabilidade operacional.

## Stack

- Backend: Node.js + TypeScript + Fastify
- Frontend: React + Vite + Tailwind + componentes no estilo shadcn/ui
- Banco: SQLite
- Worker WhatsApp: Playwright com perfil persistente dedicado
- Scheduler/Watchdog: Node.js + TypeScript
- Logs: Pino + persistência em SQLite + arquivos locais
- Process manager: PM2

## Arquitetura

Três processos separados:

- `web-app`
  - Fastify
  - API REST
  - UI React servida no mesmo processo
  - uploads, health, logs e dashboard
- `wa-worker`
  - Chromium persistente dedicado ao WhatsApp Web
  - sincronização de conversas
  - processamento de envios
  - screenshots e HTML dump em falhas críticas
- `scheduler`
  - avaliação de automações
  - disparo de campanhas
  - watchdog do worker
  - limpeza de temporários

Estrutura principal:

```text
apps/
  web-app/
  wa-worker/
  scheduler/
packages/
  core/
storage/
  chromium-profile/whatsapp/
  database/
  logs/
  media/
  screenshots/
  temp/
  uploads/
```

## Principais módulos

- Dashboard
- Inbox em 3 colunas
- CRM de contatos
- Automações por categoria
- Campaign Builder com drag and drop
- Logs
- Saúde do Sistema
- Configurações

## Banco de dados

Schema SQLite com migrations para:

- `contacts`
- `tags`
- `contact_tags`
- `conversations`
- `messages`
- `automations`
- `automation_actions`
- `automation_runs`
- `automation_contact_state`
- `campaigns`
- `campaign_steps`
- `campaign_recipients`
- `reminders`
- `media_assets`
- `jobs`
- `app_settings`
- `system_logs`
- `worker_state`

## Observabilidade

- logs estruturados em `storage/logs/*.log`
- eventos persistidos em `system_logs`
- `/health`
- `/logs`
- `/worker/metrics`
- seção visual `#/health`
- correlation id nas operações críticas do worker/scheduler
- screenshots automáticas em falha crítica
- dump HTML opcional via `.env`
- contagem de falhas consecutivas do worker
- status `degraded`, `disconnected`, `error` e `restarting`

## Requisitos

- macOS
- Node.js 22+
- npm 10+

## Instalação

```bash
cp .env.example .env
npm install
npx playwright install chromium
npm run db:migrate
npm run db:seed
```

## Desenvolvimento

Sobe os 3 processos:

```bash
npm run dev
```

Interface local:

- `http://127.0.0.1:3000`

Rotas do painel usam hash router, por exemplo:

- `http://127.0.0.1:3000/#/`
- `http://127.0.0.1:3000/#/inbox`
- `http://127.0.0.1:3000/#/health`

## Produção local

Build:

```bash
npm run build
```

Subida via PM2 runtime:

```bash
npm run start
```

O arquivo [`ecosystem.config.cjs`](/Users/gabrielbraga/Projetos/nuoma-wpp/ecosystem.config.cjs) já inclui:

- restart por memória
- restart agendado do `wa-worker`
- 3 processos separados

## Primeiro uso do WhatsApp

1. Garanta `CHROMIUM_HEADLESS=false` no `.env`.
2. Suba o worker:
   ```bash
   npm run start --workspace @nuoma/wa-worker
   ```
3. Escaneie o QR code no Chromium persistente.
4. O perfil fica salvo em `storage/chromium-profile/whatsapp`.

Importante:

- o worker nunca usa o perfil pessoal do navegador
- se a autenticação cair, campanhas ativas são pausadas automaticamente pelo scheduler

## Endpoints principais

- `GET /contacts`
- `POST /contacts`
- `GET /contacts/:id`
- `PATCH /contacts/:id`
- `DELETE /contacts/:id`
- `GET /tags`
- `POST /tags`
- `PATCH /tags/:id`
- `DELETE /tags/:id`
- `GET /conversations`
- `GET /conversations/:id`
- `GET /conversations/:id/messages`
- `GET /automations`
- `POST /automations`
- `PATCH /automations/:id`
- `POST /automations/:id/toggle`
- `GET /campaigns`
- `POST /campaigns`
- `GET /campaigns/:id`
- `PATCH /campaigns/:id`
- `POST /campaigns/:id/activate`
- `POST /campaigns/:id/pause`
- `POST /campaigns/:id/cancel`
- `POST /campaigns/:id/import-recipients`
- `GET /campaigns/:id/recipients`
- `POST /uploads/media`
- `POST /uploads/csv`
- `GET /health`
- `GET /logs`
- `GET /worker/metrics`
- `GET /settings`
- `PATCH /settings`

## Guardrails implementados

- follow-up exige tags configuradas
- follow-up bloqueia contato com tag `nao_insistir`
- campanhas bloqueiam contatos com tag `nao_insistir`
- campanhas respeitam janela de envio
- automações respeitam janela de envio
- intervalo mínimo por automação
- delays aleatórios configuráveis
- pausa de campanhas se o worker perder autenticação
- estado `degraded` após falhas repetidas de locator
- screenshots e dumps em falhas críticas

## Seed

O seed cria:

- contatos fake
- tags padrão
- automação de follow-up
- automação de pós-procedimento
- campanha draft

## Diretórios úteis

- banco: [`storage/database/nuoma.db`](/Users/gabrielbraga/Projetos/nuoma-wpp/storage/database/nuoma.db)
- logs: [`storage/logs`](/Users/gabrielbraga/Projetos/nuoma-wpp/storage/logs)
- screenshots: [`storage/screenshots`](/Users/gabrielbraga/Projetos/nuoma-wpp/storage/screenshots)
- uploads: [`storage/uploads`](/Users/gabrielbraga/Projetos/nuoma-wpp/storage/uploads)

## Observações práticas

- o worker foi validado em bootstrap local com Playwright e já grava artifacts de autenticação ausente
- como o WhatsApp Web muda seletores com o tempo, o estado `degraded` e os artifacts foram priorizados para facilitar manutenção
- o importador CSV já faz preview, mapeamento simples e importação para campanha
