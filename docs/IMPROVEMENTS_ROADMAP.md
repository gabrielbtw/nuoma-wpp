# Nuoma WPP — Roadmap de Melhorias (V1 + V2)

Documento canônico das **402 melhorias** identificadas no scan de Abril 2026, divididas em:

- **V1** (`/Users/gabrielbraga/Projetos/nuoma-wpp`) — referência de patches mínimos (17 itens), **não executar agora por decisão do owner**
- **V2** (`/Users/gabrielbraga/Projetos/nuoma-wpp-v2`) — greenfield, 16 fases, 370 itens + R3F opcional

Convenções:

- `id` — V1.N ou V2.fase.N
- `dep` — depende de outro item ou fase
- `cat` — categoria: `bug` | `perf` | `redesign` | `feature` | `doc` | `devex` | `infra` | `migration` | `security`
- `arquivo` — caminho relevante (V1) ou novo path V2
- `IC-1`, `IC-2` — Invariant Constraints (áudio + multi-step sender), invioláveis

Plano fonte: [`/Users/gabrielbraga/.claude/plans/eu-quero-que-voc-cryptic-lobster.md`](../../.claude/plans/eu-quero-que-voc-cryptic-lobster.md).

---

## V1 — Patches mínimos (17 itens) — não executar agora

**Status em 2026-04-30**: cancelado/adiado por decisão do owner. V1 fica congelado em manutenção mínima: não aplicar V1.1-V1.17 antes das provas do V2. Estes itens ficam preservados apenas como referência técnica caso algum incidente obrigue hotfix no V1.

Continuam invioláveis mesmo sem os patches: **IC-1 áudio** e **IC-2 multi-step sender**.

| id | título | dep | cat | escopo |
|---|---|---|---|---|
| **V1.1** | Dedup key com expiração | — | bug | Adicionar coluna `dedupe_expires_at INTEGER` em `jobs`. Default `+24h` para `send-message`. `enqueueJob` deixa de bloquear se key expirou. Arquivo: `packages/core/src/repositories/job-repository.ts:23-27` + nova migration. |
| **V1.2** | Watchdog backoff exponencial | — | bug | Substituir restart sem rate-limit por backoff (1m → 2m → 4m → 8m, cap 30m, reset em 1h estável). Arquivo: `apps/scheduler/src/index.ts:73-104`. |
| **V1.3** | `listConversations()` paginação cursor | — | perf | Default 50, cursor `after_id`. Arquivo: `apps/web-app/src/server/routes/conversations.ts:28-45` + repo. |
| **V1.4** | `listMessagesForConversation` paginação | — | perf | Cursor `before_id`, default 50. Frontend infinite scroll. Mesmo path. |
| **V1.5** | Watchdog quarantine após 5 falhas seguidas | V1.2 | bug | Após `consecutiveFailures >= 5`, status `quarantined`, alerta UI, parar restart. |
| **V1.6** | Race fix em campaign recipient updates | — | bug | `WHERE status='processing'` no UPDATE de `markCampaignRecipient(Failed|Validated)`. |
| **V1.7** | Índice `idx_jobs_due` | — | perf | `(status, scheduled_at)` filtrado pra `pending`. Nova migration. |
| **V1.8** | Índice `idx_messages_conv_created` | — | perf | `(conversation_id, created_at DESC)`. Lista de mensagens fica O(log n). |
| **V1.9** | `clearInterval` em SIGTERM/SIGINT | — | bug | 4 timers do worker + cycle do scheduler. Arquivos: `apps/wa-worker/src/worker.ts:197-230`, `apps/scheduler/src/index.ts:165`. |
| **V1.10** | Backup S3 diário | — | infra | Cron 02h BRT empacota `nuoma.db` + `chromium-profile/` em `.tar.gz`, sobe para `s3://nuoma-files/nuoma-wpp/yyyy-mm-dd/`. Lifecycle 30 dias. Credenciais via env. |
| **V1.11** | Memory pressure monitor | — | infra | Script bash externo + Web Push alert quando swap > 60% ou RSS > 1500MB. |
| **V1.12** | Resource limits PM2 | — | infra | `max_memory_restart=1500M` em ecosystem. Restart automático antes de OOM. |
| **V1.13** | `error_json` estruturado em `failJob` | — | devex | Coluna nova com `{ name, stack, code, context }`. Substitui `error_message` plano. |
| **V1.14** | Auditor de dedup keys travadas | V1.1 | devex | Script `scripts/v1/audit-stuck-dedup.ts` lista keys em pending/processing > 24h e oferece limpeza interativa. |
| **V1.15** | Runbook V1 hotfix | — | doc | `docs/runbooks/V1_PATCH_HOTFIX.md` curto: como aplicar hotfix sem quebrar V2 em desenvolvimento. |
| **V1.16** | Anti-regressão: áudio + multi-step sender [IC-1, IC-2] | — | doc | Documentar em `CLAUDE.md` que pipeline de áudio (`worker.ts:1474+`) e otimização "skip-navigation entre steps" (commit `910615f`) **NÃO podem ser tocadas** durante coexistência V1+V2. Bloco `<critical>` no CLAUDE.md. |
| **V1.17** | Smoke test mensal manual | V1.16 | devex | Enviar áudio + foto + texto pra contato de teste; cronometrar tempo total. Se regredir vs baseline → revert. |

---

## Fase 0 de Prova — 4 Spikes técnicos (gate de aprovação)

**Adicionada após crítica do owner em Abril 2026.** Antes de criar `nuoma-wpp-v2/` ou comprometer com qualquer item V2 abaixo, executar 4 spikes técnicos. Detalhes em [`docs/architecture/V2_SPIKES.md`](architecture/V2_SPIKES.md).

| id | título | timebox | bloqueia |
|---|---|---|---|
| **G.1** | Spike 1 — CDP observer captura msg real <3s (p50<1s, p95<3s, zero perda/dup em 50 msgs) | 3 dias | toda Fase V2.6, ADR 0007 |
| **G.2** | Spike 2 — `Page.startScreencast` latência <300ms, bandwidth <3 Mbps, estável 10min | 3 dias | toda Fase V2.12, parte ADR 0007 |
| **G.3** | Spike 3 — Áudio do V1 portado literal em container Docker funciona [IC-1] | 2 dias | V2.5.21, ADR 0010 |
| **G.4** | Spike 4 — Migration dryrun lê SQLite V1 + schema Drizzle válido + contagens batem | 2 dias | toda Fase V2.3, ADR 0005 |

### Ajuste G.1 — 2026-04-30

Rodada parcial do Spike 1 ficou **AMARELA**: CDP + binding + SQLite funcionaram com p95 de 2 ms, mas a cobertura foi só 4 `message-added` de 50 esperadas. Antes de aprovar G.1, executar uma subfase obrigatória:

Regra crítica adicionada após análise do owner: **`unread`/badge nunca é fonte de verdade**, só sinal de prioridade. Uma conversa pode ser marcada como lida por outro aparelho antes do worker ver as mensagens; portanto o sync correto precisa reconciliar **DOM observado + ledger persistido**, independentemente de unread.

| id | título | critério |
|---|---|---|
| **G.1a** | Endurecer harness CDP observer | Capturar snapshot inicial dos bubbles visíveis, reanexar observer quando `#main` trocar, manter captura passiva global, abrir `5531982066263` apenas como alvo de envio controlado, melhorar extração de `body`, `direction`, chat id e timestamp completo (`data`, `hora`, `minuto`, `segundo`). Também provar reconcile sem depender de unread: fingerprint da sidebar, snapshot do chat aberto vs DB e tentativa de backfill anterior quando os bubbles visíveis já estiverem sincronizados. |
| **G.1b** | Repetir rodada de 50 mensagens | Executado em 2026-04-30: 54/50 mensagens, p50 3ms, p95 17ms, max 26ms, 0 duplicatas e 0 erros de observer. Motor de evento aprovado; extração ainda amarela (`direction` desconhecido em 52/54, data/hora ausentes em 15/54), exigindo hardening antes de liberar sync V2 completo. |
| **G.1c** | Provar fallback de detalhes da mensagem para timestamp com segundo | Concluído em 2026-04-30: `Dados da mensagem` real no WhatsApp Web Business expôs `Hoje às 11:21` e `data-pre-plain-text` expôs `[11:21, 30/04/2026]`, sem segundos. Decisão ADR 0012: persistir horário exibido pelo WPP com `timestamp_precision='minute'`, manter `messageSecond=NULL`, gravar `observed_at_utc` com segundo/milissegundo real de captura e criar `wa_inferred_second` para timeline dentro do mesmo minuto. |
| **G.1d** | Hardening de extração de metadados | Concluído em 2026-04-30: rodada curta com mensagens novas em `5531982066263` capturou 31/30 `message-added`, p50 178ms, p95 201ms, 0 duplicatas, 0 erros, `unknown direction 0/31`, `missing date 0/31`, `missing time 0/31`. Snapshots também ficaram com `unknown direction 0/32`, `missing date 0/32`, `missing time 0/32`. |
| **G.1e** | Rodada canônica final com observer corrigido | Concluído em 2026-04-30: 62/50 `message-added`, p50 1ms, p95 4ms, max 15ms, 0 duplicatas, 0 erros, `unknown direction 0/62`, `missing date 0/62`, `missing time 0/62`, snapshots `unknown direction 0/55`, `missing date 0/55`, `missing time 0/55`. Probe de detalhes no mesmo DB confirmou 0 segundos expostos e ativou ADR 0012. G.1 aprovado para ADR 0007/V2.6. |
| **G.2a** | Screencast CDP local + input back | Concluído em 2026-04-30: criado `experiments/spike-2-screencast/`; frame bruto WhatsApp 1470x707 capturado via WebSocket; input back abriu conversa clicada sem enviar mensagens; latência click→frame 183ms/137ms; bandwidth passiva 10s 1,88 Mbps; estabilidade 600,02s com 1.601 frames, média 2,30 Mbps, 0 closes e 0 errors. G.2 aprovado localmente para ADR 0007/V2.12; repetir em host remoto real antes de UX hosted final. |
| **G.3a** | Harness e payload dry-run de áudio | Concluído em 2026-04-30: criado `experiments/spike-3-voice/` com geração de WAVs 3s/30s/120s, snapshots `.bin`, metadados `.json`, Dockerfile e modo `send` bloqueado para qualquer alvo diferente de `5531982066263`. Dry-run local validou WAV PCM 48kHz mono 16-bit e `ffprobe` retornou erro 0.000ms nas 3 durações. Spike 3 segue AMARELO até E2E real no WhatsApp + Docker/Xvfb. |
| **G.3b** | E2E real de voice nativo local | Concluído em 2026-04-30: `TARGET_PHONE=5531982066263 npm run send` enviou 3s/30s/120s, todos `delivered=true`, com evidência de voice nativo e duração exibida 3s/30s/120s (`displayErrorMs=0`). Harness calibrado para não inflar duração com wait fixo `duração + 2s`. |
| **G.3c** | Docker/Xvfb dry-run | Concluído em 2026-04-30: `docker build -t nuoma-spike-3-voice .` e `docker run --rm nuoma-spike-3-voice` passaram com Node 22, Playwright image, Chromium, Xvfb e `ffprobe`. Pendência para verde hosted absoluto: rodar `--send` dentro de container com perfil WhatsApp autenticado. |
| **G.4a** | Migration dry-run SQLite V1 | Concluído em 2026-04-30: criado `experiments/spike-4-migration/`; snapshot via `sqlite-backup`; 488.511 linhas escaneadas em 2.257ms; 422.963 importáveis; 65.548 puladas por regra; 0 JSON inválidos; nenhuma tabela obrigatória ausente; schema Drizzle candidato compila. Status VERDE com política aceita: `contacts.phone` nullable para contatos só Instagram; pular dependentes órfãos de contatos apagados; preservar recipients por telefone com `contact_id=NULL`; manter `messages.external_id` nullable; preservar audit logs sem FK forte; rodar resync geral na estabilização. |

Desenho obrigatório para o sync V2:

- DB é ledger/dedup (`external_id`, `newest_external_id`, `oldest_external_id`), não oráculo de completude.
- DOM do WhatsApp é a verdade observada no momento; toda conversa aberta gera snapshot dos bubbles visíveis e `insertOrIgnore`.
- `#pane-side` gera fingerprint por conversa (`title`, `lastPreview`, `sidebarTime`, `unreadCount`, `lastMessageAt` quando disponível). Mudança de fingerprint agenda probe mesmo com `unreadCount = 0`.
- Ao abrir uma conversa, se todos os bubbles visíveis já existem no DB, o worker deve rolar uma janela para cima e tentar capturar mensagens anteriores até encontrar fronteira já conhecida ou bater orçamento.
- Separar três loops: realtime observer, reconcile/hot-window e historical backfill. Unread só aumenta prioridade dentro do hot-window.
- Timestamp de mensagem é requisito de produto: persistir data + hora exibida pelo WhatsApp e precisão declarada. Primeiro tentar `data-pre-plain-text`; o probe G.1c confirmou que o WhatsApp Web Business atual só expõe precisão de minuto também em `Dados da mensagem`. Portanto, V2 deve salvar `timestamp_precision='minute'`, deixar `messageSecond` nulo quando o WhatsApp não expuser segundo, gravar `observed_at_utc` com segundo/milissegundo real da captura e derivar `wa_inferred_second` pela ordem DOM para ordenar mensagens dentro do mesmo minuto. Regra: no grupo conversa+data+hora:minuto, a mensagem mais recente recebe segundo sintético `59`, a anterior `58`, a anterior `57`, etc.; se houver mais de 60 mensagens no mesmo minuto, usar também sequência intra-minuto para desempate.

**Decisão pós-4-spikes:**

- 4 verdes → cria `nuoma-wpp-v2/`, inicia V2.1.
- 3 verdes + 1 amarelo → avalia o amarelo; se não-bloqueador, segue.
- 2+ amarelos OU 1 vermelho → **NÃO inicia V2**. Re-avalia.

**Skills criadas pra apoiar os spikes** (viram ferramentas permanentes mesmo se spikes falharem):

- [`wa-cdp-sync-spike`](../.claude/skills/wa-cdp-sync-spike.md) (Spike 1)
- [`wa-voice-regression`](../.claude/skills/wa-voice-regression.md) (Spike 3)
- [`v1-to-v2-migration-dryrun`](../.claude/skills/v1-to-v2-migration-dryrun.md) (Spike 4)
- [`wa-session-runbook`](../.claude/skills/wa-session-runbook.md) (apoio operacional)
- [`nuoma-worker-observability`](../.claude/skills/nuoma-worker-observability.md) (jobs travados, dedupe, DLQ — usável já no V1)
- [`nuoma-cutover-checklist`](../.claude/skills/nuoma-cutover-checklist.md) (pré-cutover real lá na frente)

---

## V2 — Greenfield blueprint (370 itens) — *gated pelos 4 spikes acima*

### V2 Fase 1 — Foundations (30 itens)

Setup do monorepo. Dir novo `nuoma-wpp-v2/`. Sem feature de produto.

| id | título | dep | cat |
|---|---|---|---|
| V2.1.1 | Criar dir `~/Projetos/nuoma-wpp-v2/` | — | infra |
| V2.1.2 | `git init` + `.gitignore` + `.gitattributes` | V2.1.1 | infra |
| V2.1.3 | `package.json` raiz com Bun workspaces | V2.1.2 | infra |
| V2.1.4 | `turbo.json` pipelines (build, dev, test, typecheck, lint) | V2.1.3 | infra |
| V2.1.5 | `tsconfig.json` raiz + `tsconfig.base.json` strict + paths | V2.1.3 | infra |
| V2.1.6 | ESLint + Prettier curados | V2.1.3 | devex |
| V2.1.7 | `bunfig.toml` | V2.1.3 | infra |
| V2.1.8 | `.editorconfig` | — | devex |
| V2.1.9 | `.env.example` documentado | V2.1.3 | doc |
| V2.1.10 | Pre-commit hook (simple-git-hooks) typecheck + lint | V2.1.6 | devex |
| V2.1.11 | Script ssh deploy local em `infra/scripts/deploy.sh` | V2.1.3 | infra |
| V2.1.12 | ADR-001 stack choice | — | doc |
| V2.1.13 | ADR-002 monorepo structure | — | doc |
| V2.1.14 | ADR-003 feature-based folders | — | doc |
| V2.1.15 | ADR-004 SQLite + Drizzle | — | doc |
| V2.1.16 | ADR-005 tRPC | — | doc |
| V2.1.17 | ADR-006 CDP-native sync | — | doc |
| V2.1.18 | ADR-007 Liquid Glass DS | — | doc |
| V2.1.19 | ADR-008 Auth strategy | — | doc |
| V2.1.20 | Pino setup + structured fields convention | V2.1.3 | infra |
| V2.1.21 | Vitest workspaces config | V2.1.4 | devex |
| V2.1.22 | README dev local + deploy | — | doc |
| V2.1.23 | `docs/V2_DEVELOPMENT.md` onboarding | V2.1.22 | doc |
| V2.1.24 | Skeleton apps/api, apps/web, apps/worker, packages/* | V2.1.3 | infra |
| V2.1.25 | Health check inicial GET / na api | V2.1.24 | feature |
| V2.1.26 | Dev script `bun dev` via turbo concurrently | V2.1.4 | devex |
| V2.1.27 | Dockerfiles em `infra/docker/` (Bun base alpine) | V2.1.24 | infra |
| V2.1.28 | `docker-compose.yml` api + web + worker + caddy | V2.1.27 | infra |
| V2.1.29 | `docker-compose.dev.yml` overrides hot reload | V2.1.28 | infra |
| V2.1.30 | `docs/V2_DEPLOYMENT.md` esqueleto | — | doc |

### V2 Fase 2 — Domain core (20 itens)

Tipos puros + Zod em `packages/contracts/`.

| id | título | dep | cat |
|---|---|---|---|
| V2.2.1 | Schema `User` (id, email, role, displayName, createdAt) | V2.1.24 | feature |
| V2.2.2 | Schema `Contact` com user_id | V2.2.1 | feature |
| V2.2.3 | Schema `Conversation` (channel, externalThreadId, lastMessageAt) | V2.2.2 | feature |
| V2.2.4 | Schema `Message` (externalId, direction, contentType, status) | V2.2.3 | feature |
| V2.2.5 | Schema `Campaign` com nested steps | V2.2.2 | feature |
| V2.2.6 | Schema `Automation` (triggers, exclusions, actions) | V2.2.2 | feature |
| V2.2.7 | Schemas `Tag`, `Attendant`, `Chatbot`, `ChatbotRule` | V2.2.2 | feature |
| V2.2.8 | Schema `Job` (type, status, payload, dedupeKey, dedupeExpiresAt) | — | feature |
| V2.2.9 | Schema `MediaAsset` | — | feature |
| V2.2.10 | Schema `Reminder` | V2.2.2 | feature |
| V2.2.11 | Enums (ChannelType, MessageDirection, JobStatus, JobType, Role) | — | feature |
| V2.2.12 | Schemas inputs (Create*Input, Update*Input) separados de leitura | V2.2.1-10 | feature |
| V2.2.13 | Schemas filters (List*Filter) | V2.2.1-10 | feature |
| V2.2.14 | Schema paginação cursor `{ cursor, limit, direction }` | — | feature |
| V2.2.15 | Schema erro padrão `AppError` | — | feature |
| V2.2.16 | Re-exports limpos `packages/contracts/src/index.ts` | V2.2.1-15 | devex |
| V2.2.17 | Test fixtures por entidade | V2.2.16 | devex |
| V2.2.18 | Doc `docs/architecture/V2_DATA_MODEL.md` com ER | V2.2.16 | doc |
| V2.2.19 | Tests Vitest validando schemas vs fixtures | V2.2.17 | devex |
| V2.2.20 | Lint custom: erro em `z.any()` sem TODO | V2.2.16 | devex |

### V2 Fase 3 — Persistence (25 itens)

Drizzle + migrations + repos.

| id | título | dep | cat |
|---|---|---|---|
| V2.3.1 | `packages/db/src/schema.ts` mirror dos Zod schemas | V2.2.16 | feature |
| V2.3.2 | `drizzle.config.ts` SQLite | V2.3.1 | infra |
| V2.3.3 | Migration inicial via `drizzle generate` | V2.3.2 | infra |
| V2.3.4 | Seed admin user_id=1 | V2.3.3 | feature |
| V2.3.5 | `usersRepo` (find, create, update, list) | V2.3.1 | feature |
| V2.3.6 | `contactsRepo` cursor + filtros + soft delete | V2.3.1 | feature |
| V2.3.7 | `conversationsRepo` | V2.3.1 | feature |
| V2.3.8 | `messagesRepo` com `insertOrIgnore` (ON CONFLICT externalId) | V2.3.1 | feature |
| V2.3.9 | `campaignsRepo` | V2.3.1 | feature |
| V2.3.10 | `automationsRepo` | V2.3.1 | feature |
| V2.3.11 | `tagsRepo` | V2.3.1 | feature |
| V2.3.12 | `attendantsRepo` | V2.3.1 | feature |
| V2.3.13 | `chatbotsRepo` | V2.3.1 | feature |
| V2.3.14 | `jobsRepo.claimDueJobs` IMMEDIATE transaction + dedupeExpiresAt | V2.3.1 | feature |
| V2.3.15 | `auditLogsRepo` (actor, target_table, target_id, before/after) | V2.3.1 | feature |
| V2.3.16 | `systemEventsRepo` | V2.3.1 | feature |
| V2.3.17 | `pushSubscriptionsRepo` | V2.3.1 | feature |
| V2.3.18 | `mediaAssetsRepo` SHA256 dedup | V2.3.1 | feature |
| V2.3.19 | Migration índices compostos `(user_id, hot_field)` | V2.3.3 | perf |
| V2.3.20 | Migration FK `onDelete: cascade` | V2.3.3 | feature |
| V2.3.21 | WAL mode + busy_timeout on connection init | V2.3.1 | infra |
| V2.3.22 | Função `backupTo(path)` | V2.3.1 | infra |
| V2.3.23 | Tests integration Vitest com DB temp | V2.3.5-18 | devex |
| V2.3.24 | `docs/architecture/V2_DATA_MODEL.md` finalizado com schema real | V2.3.1 | doc |
| V2.3.25 | Skill `v2-scaffold-feature` ganha gerador de repo | V2.3.6 | devex |

### V2 Fase 4 — Auth + Users (20 itens)

| id | título | dep | cat |
|---|---|---|---|
| V2.4.1 | Hash Argon2id via `argon2` | V2.3.5 | security |
| V2.4.2 | JWT signing via `jose` | — | security |
| V2.4.3 | Cookie httpOnly + Secure + SameSite=Lax | V2.4.2 | security |
| V2.4.4 | Refresh token rotation | V2.4.2 | security |
| V2.4.5 | Procedures `auth.{login,logout,refresh,me,changePassword}` | V2.4.1-4 | feature |
| V2.4.6 | Recovery flow: requestReset → email → resetPassword | V2.4.5 | feature |
| V2.4.7 | Email via SES env-configurable | V2.4.6 | infra |
| V2.4.8 | Rate limit auth procedures | V2.4.5 | security |
| V2.4.9 | Middleware `requireAuth` em procedures protegidas | V2.4.5 | security |
| V2.4.10 | Middleware `requireRole(role)` admin | V2.4.5 | security |
| V2.4.11 | Audit log automático login/logout/password change | V2.3.15 | security |
| V2.4.12 | CSRF double-submit token mutations | V2.4.3 | security |
| V2.4.13 | Frontend `useAuth()` + `<AuthProvider />` | V2.4.5 | feature |
| V2.4.14 | Página `/login` Liquid Glass | V2.8.4 | redesign |
| V2.4.15 | Página `/recover` Liquid Glass | V2.4.6 | redesign |
| V2.4.16 | Auto-redirect rotas autenticadas | V2.4.13 | feature |
| V2.4.17 | Persistência sessão JWT refresh transparente | V2.4.4 | feature |
| V2.4.18 | Settings → "Trocar senha" | V2.4.5 | feature |
| V2.4.19 | Doc `docs/architecture/V2_AUTH.md` | — | doc |
| V2.4.20 | Tests E2E Playwright auth flow | V2.4.13 | devex |

### V2 Fase 5 — Job queue + Worker base (25 itens)

**Inclui IC-1 (áudio) e IC-2 (multi-step sender) — invioláveis.**

| id | título | dep | cat |
|---|---|---|---|
| V2.5.1 | Worker boot Playwright launchPersistentContext + Xvfb | V2.1.27 | infra |
| V2.5.2 | `infra/xvfb.ts` start `Xvfb :99 -screen 0 1366x768x24` se headless=false e container | V2.5.1 | infra |
| V2.5.3 | Browser launch flags otimizadas RAM | V2.5.1 | perf |
| V2.5.4 | Profile dir `/data/chromium-profile` (volume) | V2.5.1 | infra |
| V2.5.5 | Job loop claim 1 por vez | V2.3.14 | feature |
| V2.5.6 | Job types `send-message`, `send-instagram-message`, `validate-recipient`, `sync-inbox-force`, `restart-worker` | — | feature |
| V2.5.7 | Retry strategy por tipo (linear send-message, exponential validate) | V2.5.5 | feature |
| V2.5.8 | DLQ `jobs_dead` table + retry manual | V2.3.1 | feature |
| V2.5.9 | Job priority field (0-9) | V2.3.1 | feature |
| V2.5.10 | Heartbeat worker_state | V2.3.16 | infra |
| V2.5.11 | Graceful shutdown SIGTERM/SIGINT | V2.5.5 | bug |
| V2.5.12 | Memory pressure check + browser restart | V2.5.1 | infra |
| V2.5.13 | Watchdog scheduler com backoff exponencial | V2.5.10 | infra |
| V2.5.14 | Lock global scheduler single instance | V2.3.1 | bug |
| V2.5.15 | Tests integration: fila vazia, 100 jobs, race 2 workers mock | V2.5.5 | devex |
| V2.5.16 | Doc `docs/architecture/V2_JOB_QUEUE.md` | — | doc |
| V2.5.17 | Skill `dedupe-key-audit` (V1+V2) | — | devex |
| V2.5.18 | Métricas job latency, throughput, fail rate | V2.5.5 | infra |
| V2.5.19 | Endpoint admin `/api/admin/jobs/dead` lista DLQ + retentar | V2.5.8 | feature |
| V2.5.20 | Endpoint `/api/admin/jobs/cleanup` arquiva done > 30 dias | V2.5.5 | infra |
| **V2.5.21 [IC-1]** | Voice recording engine — porta literal V1 | V2.5.1 | feature |
| | → Web Audio API injection via `addScriptToEvaluateOnNewDocument`, captura PCM, encode WAV 48kHz mono 16-bit, ffprobe duração exata, MediaSource feed pra WhatsApp aceitar como voice nativo. Tests E2E + snapshot do payload obrigatórios. Sem regressão vs V1. | | |
| **V2.5.22 [IC-2]** | Sender multi-step sem reload entre steps | V2.5.5 | perf |
| | → Quando próximo job é mesmo conversationId e scheduled <30s, pula re-navigation; quando muda destinatário, vai direto pra próxima conversa sem voltar pra home; estado em memória `currentConversationId + lastInteractionAt`; métrica `sender_navigation_skipped_count`. | | |
| | → Futuro: suportar pre/post actions parametrizadas por conversa, incluindo ajuste de mensagens temporárias no WhatsApp antes/depois de steps de campanha/automação. Escopo obrigatório é por chat/conversa individual; nunca alterar o padrão global do WhatsApp. Essa navegação não pode quebrar o reaproveitamento de conversa do IC-2. | | |
| V2.5.23 | Sender pipeline mídia com biblioteca pré-cached → fileChooser.setFiles direto | V2.5.5 | perf |
| V2.5.24 | Sender retorna `external_id` do bubble enviado via observer | V2.6.4 | feature |
| V2.5.25 | ADR-009 documenta IC-1 e IC-2 como contratos não-negociáveis | — | doc |

### V2 Fase 6 — Sync engine CDP-native (25 itens)

Coração do V2. Resolve sync trust desde dia 1.

Invariante de arquitetura: `unread`/badge é apenas heurística de prioridade. O sync V2 não pode depender de unread para decidir se uma conversa está completa, porque leitura em outro aparelho pode zerar o badge antes da sincronização local.

| id | título | dep | cat |
|---|---|---|---|
| V2.6.1 | Connect CDP via `chrome-remote-interface` em `127.0.0.1:9223` | V2.5.1 | feature |
| V2.6.2 | `Page.addScriptToEvaluateOnNewDocument` injeta observer | V2.6.1 | feature |
| V2.6.3 | Observer captura `data-id` de cada bubble | V2.6.2 | feature |
| | → Também captura timestamp da mensagem (`data`, `hora`, `minuto`, `timestamp_precision`) e `observed_at_utc` com segundo/milissegundo. `messageSecond` só é preenchido quando o WhatsApp expõe segundo real; G.1c confirmou que o fallback de detalhes não expõe segundo no WhatsApp Web Business atual. Para timeline, derivar `wa_inferred_second` por ordem DOM dentro do mesmo minuto: mais recente `59`, anterior `58`, anterior `57`, etc. | | |
| V2.6.4 | `Runtime.addBinding` cria `window.__nuomaSync` | V2.6.2 | feature |
| V2.6.5 | Eventos: message-added/updated/removed, conv-unread, chat-opened, delivery-status | V2.6.4 | feature |
| V2.6.6 | Handler `onMessageAdded` → messagesRepo.insertOrIgnore | V2.3.8 | feature |
| V2.6.7 | Handler `onDeliveryStatusChanged` atualiza messages.status | V2.3.8 | feature |
| V2.6.8 | Reconcile hot-window a cada 60s sem depender de unread | V2.6.6 | bug |
| | → Revisita conversas recentes/ativas, conversas com fingerprint de sidebar alterado, campanhas ativas e chats com unread > 0. Unread só prioriza a fila; não é condição de elegibilidade. Ao abrir chat, compara snapshot visível vs DB e, se tudo já existir, faz uma janela curta de backfill anterior. | | |
| V2.6.9 | Métrica `sync_event_latency_ms` exposed | V2.6.6 | infra |
| V2.6.10 | Métrica `sync_safety_net_picked_up_count` (alerta se >0) | V2.6.8 | infra |
| V2.6.11 | Smart trigger: fingerprint mudou no #pane-side → re-extrai aquele chat | V2.6.4 | feature |
| | → Fingerprint mínimo: título/phone, preview, horário da sidebar, unreadCount e marcador de canal. Qualquer mudança agenda reconcile mesmo quando unread continua zero. | | |
| V2.6.12 | Procedure `sync.forceConversation(convId)` | V2.6.6 | feature |
| V2.6.13 | Detector DOM-WA-changed → push notification admin | V2.6.4 | infra |
| V2.6.14 | Edge case msgs encaminhadas (prefixo) | V2.6.6 | bug |
| V2.6.15 | Edge case msgs editadas mantém histórico | V2.6.6 | bug |
| V2.6.16 | Edge case msgs deletadas → `deleted_at` flag | V2.6.6 | bug |
| V2.6.17 | Edge cases reactions, replies, polls, location | V2.6.6 | feature |
| V2.6.18 | Instagram observer no DM (mesmo pattern) | V2.6.2 | feature |
| V2.6.19 | Skill `cdp-event-recorder` grava `.jsonl`, replay no Vitest | — | devex |
| V2.6.20 | Tests fixture HTML estática `tests/fixtures/wa-web.html` + observer | V2.6.2 | devex |
| V2.6.21 | Tests integration WA real Chromium isolado, simula DOM mutation | V2.6.6 | devex |
| V2.6.22 | Pubsub interno emite após cada handler | V2.6.6 | feature |
| V2.6.23 | Doc `docs/architecture/V2_SYNC_ENGINE.md` com diagrama + edge cases | — | doc |
| V2.6.24 | Skill `wa-flow-trace` (V1+V2) com filtro por phone | — | devex |
| V2.6.25 | Auditor automático verifica safety net pickup count | V2.6.10 | infra |

### V2 Fase 7 — API surface tRPC (30 itens)

| id | título | dep | cat |
|---|---|---|---|
| V2.7.1 | Routers: auth, users, contacts, conversations, messages, campaigns, automations, chatbots, tags, attendants, jobs, system, embed, streaming, push, media | V2.4.5, V2.3.* | feature |
| V2.7.2 | Procedures CRUD `contacts.*` (list cursor, get, create, update, delete soft) | V2.3.6 | feature |
| V2.7.3 | Procedures CRUD `conversations.*` | V2.3.7 | feature |
| V2.7.4 | Procedures CRUD `messages.*` | V2.3.8 | feature |
| V2.7.5 | Procedures CRUD `campaigns.*` | V2.3.9 | feature |
| V2.7.6 | Procedures CRUD `automations.*` | V2.3.10 | feature |
| V2.7.7 | Procedures CRUD `tags.*` | V2.3.11 | feature |
| V2.7.8 | Procedures CRUD `attendants.*` | V2.3.12 | feature |
| V2.7.9 | Procedures CRUD `chatbots.*` | V2.3.13 | feature |
| V2.7.10 | Procedure `jobs.list` admin only | V2.3.14 | feature |
| V2.7.11 | `contacts.import` CSV upload + parse + dedup | V2.7.2 | feature |
| V2.7.12 | `contacts.search` full-text FTS5 SQLite | V2.7.2 | feature |
| V2.7.13 | `conversations.listUnified` (WA + IG mixed) | V2.7.3 | feature |
| V2.7.14 | `messages.send` enfileira job send-message | V2.5.6 | feature |
| V2.7.15 | `campaigns.execute` start campaign | V2.7.5 | feature |
| V2.7.16 | `campaigns.preview` dry run mostra recipients | V2.7.5 | feature |
| V2.7.17 | `automations.trigger` manual run pra contato | V2.7.6 | feature |
| V2.7.18 | `automations.test` testa rule sem disparar | V2.7.6 | feature |
| V2.7.19 | `chatbots.testRule` input phone+body, mostra match | V2.7.9 | feature |
| V2.7.20 | `embed.contactSummary(phone)` overlay no WPP | V2.7.2 | feature |
| V2.7.21 | `embed.eligibleAutomations(phone)` | V2.7.6 | feature |
| V2.7.22 | `embed.dispatchAutomation(automationId, phone)` | V2.7.17 | feature |
| V2.7.23 | `embed.addNote(phone, body)` | V2.7.2 | feature |
| V2.7.24 | `streaming.startScreencast` abre WS, retorna URL | V2.6.1 | feature |
| V2.7.25 | `streaming.dispatchInput` Input event relay | V2.7.24 | feature |
| V2.7.26 | `system.health`, `system.metrics`, `system.events` | V2.3.16 | feature |
| V2.7.27 | `push.subscribe`, `push.unsubscribe`, `push.test` | V2.3.17 | feature |
| V2.7.28 | `media.upload` multipart SHA256 dedup | V2.3.18 | feature |
| V2.7.29 | Doc `docs/api/V2_TRPC_PROCEDURES.md` autogerada | V2.7.1 | doc |
| V2.7.30 | Tests integration por procedure | V2.7.1-28 | devex |

### V2 Fase 8 — Cartographic Operations DS (com Liquid Glass selectivo) + Web shell (40 itens)

**Direção visual reconciliada** após carregar skills `frontend-design` e `react-three-fiber` + ler `.impeccable.md`:

- **Base do app** = "Cartographic Operations" (linhas de contorno, monospace pra dados, micro-grid backgrounds, signal dots em vez de badges, color-coding emerald=WA / amber=IG / blue=system) — conforme documentado em [`.impeccable.md`](../.impeccable.md).
- **Liquid Glass usado SELECTIVAMENTE** em camadas flutuantes/overlay: modais, sheets, command palette, status pills sobre o mapa, toasts, embed overlay no WPP. Nunca em cards de listagem ou cards de dashboard (esses ficam flat com borda de contorno).
- **Tipografia**: pareamento distintivo (não Inter/Roboto). Sugestão: **Söhne** ou **JetBrains Mono** pra dados + **Inter Display** ou **Söhne Breit** pra UI; testar **Berkeley Mono** ou **GT America** como alternativa premium. Decidir em V2.8.20.
- **Cor**: OKLCH com neutros tintados pro hue da marca (azul-cinza levemente esverdeado para reforçar mapas náuticos). Sem gradientes purple→cyan AI-style. Sem branco/preto puros.
- **Layout**: assimetria proposital (não centralização forçada). Spacing rítmico (clamp() em todos os tokens de espaçamento). Container queries pra componentes que vivem em painéis variáveis.
- **R3F** pra dashboard hero: mapa topográfico interativo onde contatos são pontos, campanhas são rotas, conversas são sinais — mission control vibe. Performance via instancing.

| id | título | dep | cat |
|---|---|---|---|
| V2.8.1 | `packages/ui/` setup tsup ou Vite library mode | V2.1.24 | infra |
| V2.8.2 | Tokens em `packages/ui/src/tokens/` (color OKLCH, spacing clamp, radius, blur, shadow, motion, contour) | V2.8.1 | redesign |
| V2.8.3 | Tailwind 4 plugin importa tokens | V2.8.2 | redesign |
| V2.8.4 | Theme provider light/dark/auto + tinted neutrals | V2.8.3 | redesign |
| V2.8.5 | `<Glass level={1\|2\|3\|modal\|floating}/>` primitive — uso selectivo apenas | V2.8.3 | redesign |
| V2.8.6 | `<Contour />` primitive — borda com efeito de linhas topográficas | V2.8.3 | redesign |
| V2.8.7 | `<MicroGrid />` primitive — background grid sutil pra contexto operacional | V2.8.3 | redesign |
| V2.8.8 | `<SignalDot status="active\|idle\|error\|degraded" />` — substitui Badge clássico | V2.8.5 | redesign |
| V2.8.9 | `<Button>` 6 variantes + 4 sizes + loading | V2.8.5 | redesign |
| V2.8.10 | `<Input>`, `<Textarea>`, `<Select>`, `<Switch>`, `<Checkbox>`, `<Radio>` | V2.8.5 | redesign |
| V2.8.11 | `<Dialog>` (glass), `<Sheet>` (glass), `<Popover>` (glass), `<Tooltip>`, `<DropdownMenu>` (glass) | V2.8.5 | redesign |
| V2.8.12 | `<Card>` flat com contour border (não glass!), `<Badge>`, `<Avatar>`, `<Tabs>`, `<Accordion>` | V2.8.6 | redesign |
| V2.8.13 | `<Toast>` glass floating com role="status" aria-live="polite" | V2.8.5 | redesign |
| V2.8.14 | `<EmptyState>`, `<ErrorState>`, `<LoadingState>` variants — usar contour drawing animation | V2.8.6 | redesign |
| V2.8.15 | `<KeyboardShortcut>`, `<VisuallyHidden>`, `<TimeAgo>` (monospace), `<ChannelIcon>` | V2.8.2 | redesign |
| V2.8.16 | `<Animate>` GSAP wrapper, respeita reduced-motion + ease-out-quart | V2.8.5 | redesign |
| V2.8.17 | Z-index layer system formal | V2.8.2 | redesign |
| V2.8.18 | Focus ring uniforme (não glow blur — outline 2px solid no estilo cartographic) | V2.8.2 | redesign |
| V2.8.19 | Skill `glass-token-apply` aplica tokens em qualquer componente | — | devex |
| V2.8.20 | Doc `docs/design-system/V2_TYPOGRAPHY.md` — decide pareamento de fontes (não-Inter) | V2.8.2 | doc |
| V2.8.21 | Página dev `/dev/components` preview (gated NODE_ENV=development) | V2.8.5-15 | devex |
| V2.8.22 | Tests visual regression Playwright | V2.8.21 | devex |
| V2.8.23 | Tests a11y `@axe-core/playwright` em /dev/components | V2.8.21 | devex |
| V2.8.24 | Doc `docs/design-system/V2_LIQUID_GLASS_TOKENS.md` (tokens + regras de uso selectivo) | V2.8.2 | doc |
| V2.8.25 | Doc `docs/design-system/V2_CARTOGRAPHIC_TOKENS.md` (contour, micro-grid, signal dots, monospace data) | V2.8.6 | doc |
| V2.8.26 | Doc `docs/design-system/V2_COMPONENT_INVENTORY.md` | V2.8.5-15 | doc |
| V2.8.27 | Doc `docs/design-system/V2_MOTION.md` GSAP patterns + reduced-motion | V2.8.16 | doc |
| V2.8.28 | Shell layout (sidebar + header + content) — sidebar com micro-grid background | V2.8.7 | redesign |
| V2.8.29 | Sidebar nav active glow + atalhos 1-9 (estilo mission-control HUD) | V2.8.16 | redesign |
| V2.8.30 | Mobile drawer | V2.8.28 | redesign |
| V2.8.31 | `cmd+k` command palette glass floating | V2.8.11 | feature |
| V2.8.32 | Channel session strip — signal dots em vez de badge clássico | V2.8.8 | redesign |
| V2.8.33 | TanStack Router setup file-based routes | V2.1.24 | infra |
| V2.8.34 | Layout outlet em `/`, redirect /login se sem auth | V2.4.16 | feature |
| V2.8.35 | Toast container global | V2.8.13 | infra |
| V2.8.36 | TanStack Query setup com tRPC | V2.7.1 | infra |
| V2.8.37 | Service worker `/sw.js` Web Push registrado | V2.13.11 | infra |
| V2.8.38 | Página /settings tabs (Geral, Aparência, Notificações, Integrações, Avançado) | V2.8.28 | feature |
| V2.8.39 | Tema setting + persistência user prefs | V2.8.4 | feature |
| V2.8.40 | Comandos paleta integrados routing — abrir página, criar contato, disparar | V2.8.31 | feature |

| id | título | dep | cat |
|---|---|---|---|
| V2.8.1 | `packages/ui/` setup tsup ou Vite library mode | V2.1.24 | infra |
| V2.8.2 | Tokens em `packages/ui/src/tokens/` (color, spacing, radius, blur, shadow, motion) | V2.8.1 | redesign |
| V2.8.3 | Tailwind 4 plugin importa tokens | V2.8.2 | redesign |
| V2.8.4 | Theme provider light/dark/auto | V2.8.3 | redesign |
| V2.8.5 | `<Glass level={1\|2\|3\|modal\|floating}/>` primitive | V2.8.3 | redesign |
| V2.8.6 | `<Button>` 6 variantes + 4 sizes + loading | V2.8.5 | redesign |
| V2.8.7 | `<Input>`, `<Textarea>`, `<Select>`, `<Switch>`, `<Checkbox>`, `<Radio>` | V2.8.5 | redesign |
| V2.8.8 | `<Dialog>`, `<Sheet>`, `<Popover>`, `<Tooltip>`, `<DropdownMenu>` (shadcn glass) | V2.8.5 | redesign |
| V2.8.9 | `<Card>`, `<Badge>`, `<Avatar>`, `<Tabs>`, `<Accordion>` | V2.8.5 | redesign |
| V2.8.10 | `<Toast>` com role="status" aria-live="polite" | V2.8.5 | redesign |
| V2.8.11 | `<EmptyState>`, `<ErrorState>`, `<LoadingState>` variants | V2.8.5 | redesign |
| V2.8.12 | `<KeyboardShortcut>`, `<VisuallyHidden>`, `<TimeAgo>`, `<ChannelIcon>` | V2.8.5 | redesign |
| V2.8.13 | `<Animate>` GSAP wrapper, respeita reduced-motion | V2.8.5 | redesign |
| V2.8.14 | Z-index layer system (`z-base/dropdown/overlay/drawer/modal/toast/critical`) | V2.8.2 | redesign |
| V2.8.15 | Focus ring uniforme | V2.8.2 | redesign |
| V2.8.16 | Skill `glass-token-apply` aplica tokens em qualquer componente | — | devex |
| V2.8.17 | Página dev `/dev/components` preview gated NODE_ENV=development | V2.8.5-13 | devex |
| V2.8.18 | Tests visual regression com Playwright | V2.8.17 | devex |
| V2.8.19 | Tests a11y `@axe-core/playwright` em /dev/components | V2.8.17 | devex |
| V2.8.20 | Doc `docs/design-system/V2_LIQUID_GLASS_TOKENS.md` | V2.8.2 | doc |
| V2.8.21 | Doc `docs/design-system/V2_COMPONENT_INVENTORY.md` | V2.8.5-13 | doc |
| V2.8.22 | Doc `docs/design-system/V2_MOTION.md` | V2.8.13 | doc |
| V2.8.23 | Shell layout (sidebar + header + content) glass | V2.8.5 | redesign |
| V2.8.24 | Sidebar nav active glow + atalhos 1-9 | V2.8.13 | redesign |
| V2.8.25 | Mobile drawer | V2.8.23 | redesign |
| V2.8.26 | `cmd+k` command palette | V2.8.8 | feature |
| V2.8.27 | Channel session strip — status pill glass | V2.8.5 | redesign |
| V2.8.28 | TanStack Router setup file-based routes | V2.1.24 | infra |
| V2.8.29 | Layout outlet em `/`, redirect /login se sem auth | V2.4.16 | feature |
| V2.8.30 | Toast container global | V2.8.10 | infra |
| V2.8.31 | TanStack Query setup com tRPC | V2.7.1 | infra |
| V2.8.32 | Service worker `/sw.js` Web Push registrado | V2.13.11 | infra |
| V2.8.33 | Página /settings tabs (Geral, Aparência, Notificações, Integrações, Avançado) | V2.8.23 | feature |
| V2.8.34 | Tema setting + persistência user prefs | V2.8.4 | feature |
| V2.8.35 | Comandos paleta integrados routing — abrir página, criar contato, disparar | V2.8.26 | feature |

### V2 Fase 9 — Inbox V2 (30 itens)

| id | título | dep | cat |
|---|---|---|---|
| V2.9.1 | Página /inbox 3-col grid (lista \| timeline \| sidebar) | V2.8.23 | redesign |
| V2.9.2 | Lista contatos virtualizada `@tanstack/react-virtual` | V2.7.13 | perf |
| V2.9.3 | Real-time SSE — `message-added` reordena lista | V2.13.4 | feature |
| V2.9.4 | Search + filter (canal, status, tags) | V2.7.12 | feature |
| V2.9.5 | Avatar real (foto WA via proxy worker) | V2.5.1 | feature |
| V2.9.6 | Timeline com glass bubble + gradient outgoing | V2.8.5 | redesign |
| V2.9.7 | Scroll sticky data dividers | V2.9.6 | redesign |
| V2.9.8 | Render mídia (image/video/audio/file) glass card | V2.8.9 | redesign |
| V2.9.9 | Ações por mensagem (copiar, encaminhar, reply UI) | V2.9.6 | feature |
| V2.9.10 | Read receipts visíveis ✓✓ azul via observer | V2.6.7 | feature |
| V2.9.11 | Status delivery animado (clock → check → double → blue) | V2.6.7 | redesign |
| V2.9.12 | Composer glass com 4 ações (foto, vídeo, áudio, doc) | V2.8.5 | redesign |
| V2.9.13 | Voice recording integrado (Web Audio + ffprobe) — IC-1 | V2.5.21 | feature |
| V2.9.14 | Emoji picker | V2.8.8 | feature |
| V2.9.15 | Quick replies salvos | V2.7.4 | feature |
| V2.9.16 | Dropdown "Disparar automação" search + filtro elegível | V2.7.21 | feature |
| V2.9.17 | Botão "Disparar campanha individual" | V2.7.15 | feature |
| V2.9.18 | Optimistic update em send | V2.9.16 | perf |
| V2.9.19 | Retry inline em msg falhada | V2.9.6 | feature |
| V2.9.20 | Indicator "fila com X jobs" | V2.7.10 | feature |
| V2.9.21 | Sidebar contato tabs (Detalhes \| Histórico \| Notas \| Tags \| Reminders) | V2.8.9 | redesign |
| V2.9.22 | Edição inline contato | V2.9.21 | feature |
| V2.9.23 | Tags drag-drop reordenar | V2.9.21 | feature |
| V2.9.24 | Notas markdown lite preview live | V2.9.21 | feature |
| V2.9.25 | Reminders pequenos (data + texto) | V2.7.* | feature |
| V2.9.26 | Filter chips top da timeline (data, tipo, com mídia) | V2.9.6 | feature |
| V2.9.27 | Search dentro da conversa cmd+f | V2.9.6 | feature |
| V2.9.28 | Atalhos j/k navegar, e edit, r reply, esc close | V2.8.12 | feature |
| V2.9.29 | Botão "Ressincronizar conversa" → sync.forceConversation | V2.6.12 | feature |
| V2.9.30 | Tests E2E inbox flow completo | V2.9.1-29 | devex |

### V2 Fase 10 — Campaigns + Automations + Chatbots V2 (35 itens)

**V2.10.11-V2.10.15 implementam IC-2 no scheduler de campanha.**

| id | título | dep | cat |
|---|---|---|---|
| V2.10.1 | Campaigns: builder wizard glass | V2.7.5 | redesign |
| V2.10.2 | CSV upload preview + validação | V2.7.11 | feature |
| V2.10.3 | Scheduler campaign tick com lock | V2.5.14 | feature |
| V2.10.4 | Recipients table virtualizada | V2.9.2 | perf |
| V2.10.5 | Workflow viewer com nodes glass + GSAP | V2.8.13 | redesign |
| V2.10.6 | Per-step stats | V2.7.5 | feature |
| V2.10.7 | A/B variants suporte | V2.7.5 | feature |
| V2.10.8 | Evergreen mode auto-avaliação | V2.7.5 | feature |
| V2.10.9 | Pause/resume campanha | V2.7.5 | feature |
| V2.10.10 | Audit per recipient | V2.3.15 | feature |
| | → Futuro: opção parametrizada por campanha/automação para executar em janela de mensagens temporárias. Parâmetros mínimos: `temporaryMessages.enabled`, `temporaryMessages.beforeSendDuration` (default `24h`), `temporaryMessages.afterCompletionDuration` (default `90d`), `temporaryMessages.restoreOnFailure` (default `true`). Fluxo esperado por chat/conversa: abrir chat, ajustar mensagens temporárias daquele chat para `beforeSendDuration`, voltar, enviar todos os steps previstos para aquela conversa, abrir detalhes/contato novamente e restaurar aquele chat para `afterCompletionDuration`. Em falha no meio, se `restoreOnFailure=true`, restaurar para `afterCompletionDuration` imediatamente antes de marcar retry/falha. Nunca alterar o padrão global do WhatsApp nem tentar restaurar "valor anterior"; a regra padrão confirmada é restaurar para `90d`. Precisa de auditoria por chat registrando parâmetros usados. | | |
| **V2.10.11 [IC-2]** | Campaign scheduler agrupa steps mesmo phone | V2.5.22 | perf |
| | → enfileira jobs com `scheduled_at` próximos (intra-batch ≤8s) pra que sender V2.5.22 reaproveite conversa aberta. Sem isso IC-2 não vale nada. | | |
| V2.10.12 | Per-recipient timeline com indicador "navegação reaproveitada" | V2.10.11 | feature |
| V2.10.13 | Métrica campanha: tempo total + economia skip-navigation | V2.5.22 | infra |
| V2.10.14 | Voice step na campanha (anexa áudio gravado) — IC-1 | V2.5.21 | feature |
| V2.10.15 | Voice template biblioteca (gravar 1x, reusar N) | V2.7.28 | feature |
| V2.10.16 | Automations visual builder drag-drop | V2.7.6 | redesign |
| V2.10.17 | Action registry extensível | V2.7.6 | feature |
| V2.10.18 | Rule tester | V2.7.18 | feature |
| V2.10.19 | Condition builder AND/OR | V2.7.6 | feature |
| V2.10.20 | Delay actions | V2.7.6 | feature |
| V2.10.21 | Branching | V2.7.6 | feature |
| V2.10.22 | Version history | V2.3.15 | feature |
| V2.10.23 | Templates galeria | V2.7.6 | feature |
| V2.10.24 | Preview do flow | V2.10.16 | feature |
| V2.10.25 | Doc automation actions | — | doc |
| V2.10.26 | Chatbot rule builder + regex tester inline | V2.7.9 | redesign |
| V2.10.27 | Priority drag-drop | V2.7.9 | feature |
| V2.10.28 | Response variants | V2.7.9 | feature |
| V2.10.29 | Fallback action | V2.7.9 | feature |
| V2.10.30 | Tag-on-match | V2.7.9 | feature |
| V2.10.31 | Status-change-on-match | V2.7.9 | feature |
| V2.10.32 | Attendant-notify | V2.7.9 | feature |
| V2.10.33 | Automation-trigger (chatbot dispara automation) | V2.7.17 | feature |
| V2.10.34 | Preview com simulação de input | V2.7.19 | feature |
| V2.10.35 | A/B test rules | V2.7.9 | feature |

### V2 Fase 11 — Embed overlay no WPP (20 itens)

| id | título | dep | cat |
|---|---|---|---|
| V2.11.1 | Script `apps/worker/src/features/overlay/inject.ts` injeta overlay quando WPP carrega | V2.6.2 | feature |
| V2.11.2 | Shadow DOM isolando estilos | V2.11.1 | feature |
| V2.11.3 | Tokens Liquid Glass compilados em string | V2.8.2 | redesign |
| V2.11.4 | FAB no header da conversa | V2.11.1 | redesign |
| V2.11.5 | Painel slide-in summary + automações + notas | V2.7.20-23 | redesign |
| V2.11.6 | Detecção telefone via observer | V2.11.1 | feature |
| V2.11.7 | `Runtime.addBinding` expõe `window.__nuomaApi` | V2.11.1 | feature |
| V2.11.8 | Backend procedures `embed.*` (já em V2.7.20-23) | V2.7.20 | feature |
| V2.11.9 | Indicador "sync ativo" piscando | V2.6.6 | redesign |
| V2.11.10 | Quick actions (tag, status, reminder) | V2.7.7 | feature |
| V2.11.11 | Histórico de automações disparadas pra esse contato | V2.7.21 | feature |
| V2.11.12 | Atalhos teclado dentro do overlay | V2.11.5 | feature |
| V2.11.13 | Versionamento overlay invalidar antigo se DOM WA mudar | V2.11.1 | infra |
| V2.11.14 | Detector DOM-WA-changed → alerta admin | V2.11.13 | infra |
| V2.11.15 | Modo debug (botão liga bordas vermelhas locators) | V2.11.6 | devex |
| V2.11.16 | `data-nuoma-*` attrs (não classes) | V2.11.1 | infra |
| V2.11.17 | Throttle observer 50ms debounce | V2.11.6 | perf |
| V2.11.18 | Não bloqueia send nativo do WA — additive | V2.11.5 | feature |
| V2.11.19 | Tests fixture HTML estática | V2.11.1 | devex |
| V2.11.20 | Hot reload dev rebuild + re-inject sem reload Chromium | V2.11.1 | devex |

### V2 Fase 12 — Remote rendering CDP+canvas (25 itens)

| id | título | dep | cat |
|---|---|---|---|
| V2.12.1 | Hono WS endpoint `/api/streaming/ws` | V2.7.24 | feature |
| V2.12.2 | Auth WS via JWT cookie | V2.4.3 | security |
| V2.12.3 | Lifecycle open/close/ping/pong | V2.12.1 | feature |
| V2.12.4 | Backend conecta CDP do worker rede interna | V2.6.1 | feature |
| V2.12.5 | `Page.startScreencast` JPEG q=80 max 1280x720 30fps | V2.12.4 | feature |
| V2.12.6 | Cada frame base64 → client | V2.12.5 | feature |
| V2.12.7 | `<RemoteCanvas />` recebe + draw rAF | V2.8.1 | feature |
| V2.12.8 | Captura mouse + keyboard envia eventos | V2.12.7 | feature |
| V2.12.9 | Backend traduz pra `Input.dispatchMouseEvent`/`KeyEvent` | V2.12.8 | feature |
| V2.12.10 | Multi-touch (pinch/pan) → wheel events | V2.12.8 | feature |
| V2.12.11 | Resize handler `Page.setDeviceMetricsOverride` | V2.12.4 | feature |
| V2.12.12 | Liquid Glass wrapper (status pill, fullscreen toggle) | V2.8.5 | redesign |
| V2.12.13 | QR scan via screenshot canvas QR | V2.12.5 | feature |
| V2.12.14 | `<QRScanCanvas />` exibe + instruções | V2.12.13 | redesign |
| V2.12.15 | Dispatch evento `wpp-authenticated` quando observer detecta `pane-side` | V2.6.4 | feature |
| V2.12.16 | Status visual: Conectado \| QR \| Reconectando \| Erro | V2.12.7 | redesign |
| V2.12.17 | Auto-reconnect backoff | V2.12.1 | infra |
| V2.12.18 | Métrica latência stream (frame timestamp vs render) | V2.12.6 | infra |
| V2.12.19 | Compressão adaptativa cair quality em links lentos | V2.12.5 | perf |
| V2.12.20 | Bandwidth indicator UI | V2.12.18 | infra |
| V2.12.21 | Suporte mobile (touch events mapeados) | V2.12.10 | feature |
| V2.12.22 | Tests E2E abrir streaming, simular click, validar evento Input | V2.12.7 | devex |
| V2.12.23 | Doc `docs/architecture/V2_REMOTE_RENDERING.md` | — | doc |
| V2.12.24 | Doc `docs/api/V2_CDP_PROTOCOL.md` | — | doc |
| V2.12.25 | Runbook `docs/runbooks/V2_QR_RESCAN.md` | — | doc |

### V2 Fase 13 — Real-time SSE + Web Push (15 itens)

| id | título | dep | cat |
|---|---|---|---|
| V2.13.1 | Hono SSE `/api/events/stream` | V2.1.24 | feature |
| V2.13.2 | Pubsub interno (EventEmitter) emite após handler | V2.6.22 | feature |
| V2.13.3 | Client filter `?channels=...` | V2.13.1 | feature |
| V2.13.4 | Frontend `useEventStream(channels)` hook | V2.13.1 | feature |
| V2.13.5 | Reconnect com backoff | V2.13.4 | infra |
| V2.13.6 | Fallback polling após 3 retries | V2.13.4 | bug |
| V2.13.7 | Métrica clients conectados, latência média | V2.13.1 | infra |
| V2.13.8 | VAPID keys env-configurable | — | security |
| V2.13.9 | Web Push subscribe → DB | V2.7.27 | feature |
| V2.13.10 | Push em eventos críticos (WPP off, msg falha, swap > 80%) | V2.13.9 | feature |
| V2.13.11 | Service worker `apps/web/public/sw.js` | V2.13.9 | infra |
| V2.13.12 | Settings → toggle por tipo de evento | V2.8.33 | feature |
| V2.13.13 | "Não perturbe" silencia em horário | V2.13.12 | feature |
| V2.13.14 | `push.test` debugar | V2.7.27 | devex |
| V2.13.15 | Doc `docs/architecture/V2_REALTIME.md` | — | doc |

### V2 Fase 14 — Deploy & infra (20 itens)

| id | título | dep | cat |
|---|---|---|---|
| V2.14.1 | Dockerfile api Bun base | V2.1.27 | infra |
| V2.14.2 | Dockerfile web (build → nginx static) | V2.1.27 | infra |
| V2.14.3 | Dockerfile worker (Chromium + Xvfb + Bun) | V2.1.27 | infra |
| V2.14.4 | docker-compose networks isolados | V2.14.1-3 | infra |
| V2.14.5 | Caddy entry novo domínio (subdomínio TBD) | V2.14.4 | infra |
| V2.14.6 | Swap 8GB host (config + /etc/fstab) | — | infra |
| V2.14.7 | Memory pressure cron + Web Push alert | V2.13.10 | infra |
| V2.14.8 | Resource limits (api 512M, web 256M, worker 1.8G) | V2.14.4 | infra |
| V2.14.9 | Healthcheck docker-compose | V2.14.4 | infra |
| V2.14.10 | Volume `nuoma-wpp-v2-storage` (DB + uploads) | V2.14.4 | infra |
| V2.14.11 | Volume `nuoma-wpp-v2-profile` (Chromium) | V2.14.4 | infra |
| V2.14.12 | Backup `scripts/backup.sh` → `s3://nuoma-files/nuoma-wpp-v2/yyyy-mm-dd/` (.tar.gz com SQLite + profile + uploads) | V2.14.10-11 | infra |
| V2.14.13 | S3 lifecycle 30 dias prefixo `nuoma-wpp-v2/`, IAM mínimo (s3:PutObject + s3:DeleteObject) | V2.14.12 | infra |
| V2.14.14 | `scripts/restore.sh` interativo | V2.14.12 | infra |
| V2.14.15 | `scripts/deploy.sh` rsync + ssh + compose pull | — | infra |
| V2.14.16 | Pre-deploy hook typecheck + tests | V2.14.15 | devex |
| V2.14.17 | Post-deploy hook health check + rollback | V2.14.15 | devex |
| V2.14.18 | Página `/admin/deploy-history` | V2.14.15 | feature |
| V2.14.19 | Rate limit Hono | V2.7.1 | security |
| V2.14.20 | CSP + Helmet headers | V2.7.1 | security |

### V2 Fase 14a — R3F Cartographic Hero (10 itens, opcional)

Skill `react-three-fiber` carregada. Mapa topográfico interativo no dashboard como diferenciação visual ("what app is this?" — confirmado pela `.impeccable.md`).

| id | título | dep | cat |
|---|---|---|---|
| V2.14a.1 | Setup R3F + Drei + Three.js em `apps/web/src/features/cartography/` | V2.8.1 | feature |
| V2.14a.2 | `<TopographicMap />` Canvas com OrbitControls (damping leve) e câmera ortográfica | V2.14a.1 | feature |
| V2.14a.3 | Geração procedural de contour lines via shader simplex noise | V2.14a.2 | feature |
| V2.14a.4 | Contatos como `instancedMesh` (até 50k pontos sem perder fps) | V2.14a.2 | perf |
| V2.14a.5 | Campanhas como bezier curves animadas entre pontos com dashOffset | V2.14a.4 | feature |
| V2.14a.6 | Conversas ativas como signal pulse em radar 3D | V2.14a.4 | feature |
| V2.14a.7 | `<ScrollControls>` + `useScroll` pra reveal sequencial das camadas | V2.14a.2 | feature |
| V2.14a.8 | Performance: `<AdaptiveDpr pixelated />` + `<PerformanceMonitor />` baixa qualidade em mobile | V2.14a.2 | perf |
| V2.14a.9 | Fallback 2D (SVG topo lines + circles) quando WebGL indisponível ou prefers-reduced-motion | V2.14a.2 | feature |
| V2.14a.10 | Doc `docs/design-system/V2_R3F_CARTOGRAPHY.md` com performance budget + composition guidelines | — | doc |

### V2 Fase 15 — Migração V1→V2 (15 itens)

| id | título | dep | cat |
|---|---|---|---|
| V2.15.1 | Tool `apps/migration/` script Bun standalone | V2.3.1 | migration |
| V2.15.2 | Lê SQLite V1 → escreve SQLite V2 com transformações | V2.15.1 | migration |
| V2.15.3 | Mapeamento `users` (cria user_id=1 admin) | V2.15.2 | migration |
| V2.15.4 | Mapeamento `contacts` preserva ID ou map table | V2.15.2 | migration |
| V2.15.5 | Mapeamento `conversations` + `messages` | V2.15.4 | migration |
| V2.15.6 | Mapeamento `campaigns` + recipients + executions | V2.15.4 | migration |
| V2.15.7 | Mapeamento `automations` + runs | V2.15.4 | migration |
| V2.15.8 | Mapeamento `tags` + `contact_tags` + `attendants` | V2.15.4 | migration |
| V2.15.9 | Mapeamento `chatbots` + rules | V2.15.4 | migration |
| V2.15.10 | Mapeamento `media_assets` (cópia física dos files) | V2.15.4 | migration |
| V2.15.11 | Skip `data_lake_*` (escopo data lake fora) | V2.15.2 | migration |
| V2.15.12 | Dry run mode reporta sem escrever | V2.15.2 | migration |
| V2.15.13 | Validation comparar contagens V1 vs V2 | V2.15.12 | migration |
| V2.15.14 | Rollback documentado em `docs/migration/CUTOVER_PLAN.md` | — | doc |
| V2.15.15 | Skill `v1-to-v2-data-import` interativa | — | devex |

---

## Sumário por categoria

| Categoria | V1 | V2 | Total |
|---|---|---|---|
| bug | 6 | 12 | 18 |
| perf | 4 | 13 | 17 |
| redesign | 0 | 53 | 53 |
| feature | 0 | 154 | 154 |
| doc | 1 | 32 | 33 |
| devex | 1 | 30 | 31 |
| infra | 3 | 38 | 41 |
| migration | 0 | 12 | 12 |
| security | 0 | 14 | 14 |
| **Total** | **15** | **358** | **373** |

(Nota: alguns itens contam dupla categoria mentalmente; as células acima são aproximadas).

## Sumário por fase

| Bloco | Itens |
|---|---|
| V1 patches | 17 |
| V2.1 Foundations | 30 |
| V2.2 Domain core | 20 |
| V2.3 Persistence | 25 |
| V2.4 Auth + Users | 20 |
| V2.5 Job queue + Worker (inclui IC-1, IC-2) | 25 |
| V2.6 Sync engine CDP | 25 |
| V2.7 API tRPC | 30 |
| V2.8 Liquid Glass DS + Web shell | 35 |
| V2.9 Inbox V2 | 30 |
| V2.10 Campaigns/Automations/Chatbots | 35 |
| V2.11 Embed overlay | 20 |
| V2.12 Remote rendering | 25 |
| V2.13 Real-time + Push | 15 |
| V2.14 Deploy & infra | 20 |
| V2.14a R3F Cartographic Hero (opcional) | 10 |
| V2.15 Migração V1→V2 | 15 |
| **Total** | **402** |

---

## Constraints invioláveis (relembrando)

### IC-1 — Áudio (PRESERVAR EXATAMENTE como V1)

Itens que tocam: **V1.16, V1.17, V2.5.21, V2.9.13, V2.10.14, V2.10.15** + ADR-009.

Implementação canônica vive em [`apps/wa-worker/src/worker.ts:1474+`](../apps/wa-worker/src/worker.ts) (V1). Características obrigatórias no V2:

- Web Audio API injection via CDP `addScriptToEvaluateOnNewDocument`
- Captura PCM, encode WAV 48kHz mono 16-bit
- ffprobe pra duração exata (não estimativa)
- MediaSource feed pro WhatsApp aceitar como voice nativo
- Sem `bringToFront()` durante gravação
- Sem relaunch de browser pra mandar voice
- Tests E2E + snapshot do payload final obrigatórios antes de aceitar V2 em produção

### IC-2 — Multi-step sender sem reload entre steps

Itens que tocam: **V1.16, V1.17, V2.5.22, V2.10.11, V2.10.12, V2.10.13** + ADR-009.

Otimização introduzida no commit `910615f` do V1. No V2:

- Mantém conversa do destinatário aberta entre steps consecutivos
- Pula `goto()`/click se próximo job é mesmo `conversationId` e scheduled <30s depois
- Quando muda destinatário, vai direto pra próxima conversa sem voltar pra home
- Estado em memória `currentConversationId + lastInteractionAt`
- Métrica `sender_navigation_skipped_count` exposta
- Tests E2E cronometram tempo total ≤ V1

### Outras coisas que estão funcionando bem no V1 (anti-regression)

- **Focus stealing fix** (commit `f344094`): `--window-position=-2000,-2000` offscreen. Manter no V2.
- **Sync stuck loop fix** (commit `6a090d8`): timeout 120s + reset unread > 100. Mantido como sanity check; safety net no V2.
- **Race condition em job claim**: `db.transaction("immediate", ...)` no V2 via Drizzle.
- **`dedupe_key` mecanismo** (com expiração V1.1): mantido no V2 desde dia 1.

---

## Ordem de execução recomendada

Atualizada em 2026-04-30 por decisão do owner: **não executar patches V1 agora**. A Fase 0 ativa passa a ser a **Fase 0 de Prova do V2**.

```
1. G.1-G.4                      (até 10 dias)  ← Fase 0 de Prova V2 ativa
2. V2.1                         (1 sprint)
3. V2.2 + V2.3 + V2.4           (2 sprints)    ← Backend usável
4. V2.5 + V2.6                  (2 sprints)    ← Worker + sync real-time
5. V2.7 + V2.8                  (2 sprints)    ← API + DS + shell
6. V2.9                         (1-2 sprints)  ← Inbox primary surface
7. V2.10                        (2-3 sprints)  ← Campaigns/Automations/Chatbots
8. V2.11 + V2.12                (2-3 sprints)  ← Embed + Streaming
9. V2.13 + V2.14                (1-2 sprints)  ← Real-time + Deploy
10. V2.15                       (1 sprint)     ← Cutover
```

**Total estimado V2 completo**: 15-20 sprints (~4-5 meses) com IA assistida + revisão do owner.

---

## Próximos passos

1. **Aprovação implícita**: este documento substitui PLANS.md como fonte de verdade do roadmap.
2. **Execução**: começar imediatamente pela Fase 0 de Prova do V2, iniciando pelo G.1 (CDP observer).
3. **Tracking**: cada item recebe um issue (GitHub local ou Linear se houver). ID do issue casa com `id` aqui.
4. **Métricas de progresso**: % completion por fase + burn-down semanal.
5. **Revisão trimestral**: re-priorizar fases conforme aprendizado.
