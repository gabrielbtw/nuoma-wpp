# V1 → V2 — Mapa de migração de dados

Documento de referência para Spike 4 + ferramenta de migração futura. Lista cada tabela operacional do V1 e como deve ser mapeada para o schema V2.

**Status**: Spike 4a executado em 2026-04-30. Resultado VERDE com politica aceita: dry-run leu 488.511 linhas em 2.257ms, schema Drizzle candidato compilou e nao houve JSON invalido nem tabela obrigatoria ausente. Orphans ligados a contatos apagados sao pulados ou preservados como evento/auditoria sem FK forte conforme a tabela; depois a estabilizacao V2 roda resync geral. Ver `experiments/spike-4-migration/REPORT.md`.

Implementacao operacional V2.15:

- App/CLI: `apps/migration/src/index.ts`.
- Comandos: `npm run migration:v215:preflight`, `npm run migration:v215:dry-run`, `npm run migration:v215:apply`, `npm run migration:v215:validate`.
- Runbook: `docs/migration/CUTOVER_PLAN.md` e `docs/runbooks/CUTOVER_ROLLBACK.md`.
- Skill interativa: `.claude/skills/v1-to-v2-data-import.md`.

## Princípios

1. **V1 SQLite é read-only** durante migração. Sempre trabalhar numa cópia.
2. **`user_id` injetado**: V1 nao tem multi-user; toda linha vira `user_id=1` por default, ou `V215_TARGET_USER_ID`.
3. **`data_lake_*`, AI tables, tabelas fora do escopo do produto** são **ignoradas**.
4. **External IDs preservados** quando existem (`wa_chat_id`, `external_thread_id`, `external_id` em messages). Mensagens sem `external_id` ficam com `NULL`, mantendo o source row em `raw_json`.
5. **FKs com `ON DELETE CASCADE`** no V2 — durante import, valida que todos os parents existem; orphans operacionais sao pulados, historicos viram evento/auditoria sem FK forte.
6. **IDs V2 sao novos**: o schema V2 usa autoincrement; a correspondencia V1->V2 fica em `metadata_json`, `raw_json`, notas de migracao ou payload/evento legado.

## Tabelas mapeadas

### `users` (nova no V2)

V1 não tem. Cria 1 linha:

```sql
INSERT INTO users (id, email, password_hash, role, display_name, created_at)
VALUES (1, '<owner-email>', '<bcrypt-hash-from-env>', 'admin', 'Gabriel', CURRENT_TIMESTAMP);
```

Na implementacao V2.15, o import reutiliza `V215_TARGET_USER_ID` se existir. Se o usuario alvo nao existir, cria um admin placeholder local para permitir import em clone; producao deve ter admin criado previamente.

### `contacts`

V1 → V2: 1:1, com adição de `user_id=1`.

| V1 (campo)   | V2 (campo)             | Notas                                                                                    |
| ------------ | ---------------------- | ---------------------------------------------------------------------------------------- |
| `id`         | metadata/raw source id | V2 gera novo id; source id preservado em nota/metadado.                                  |
| —            | `user_id`              | injeta `1`                                                                               |
| `phone`      | `phone`                | nullable; contato pode existir só por Instagram. UNIQUE deve ignorar NULL por `user_id`. |
| `name`       | `name`                 |                                                                                          |
| `email`      | `email`                |                                                                                          |
| `cpf`        | `cpf`                  |                                                                                          |
| `instagram`  | `instagram`            |                                                                                          |
| `status`     | `status`               | enum mantido                                                                             |
| `notes`      | `notes`                |                                                                                          |
| `created_at` | `created_at`           |                                                                                          |
| `updated_at` | `updated_at`           |                                                                                          |

Orphans esperados: nenhum (contacts é raiz).

### `conversations`

| V1                   | V2                     | Notas                                                  |
| -------------------- | ---------------------- | ------------------------------------------------------ |
| `id`                 | metadata/raw source id | V2 gera novo id; source id preservado em raw/metadado. |
| —                    | `user_id`              | injeta `1`                                             |
| `wa_chat_id`         | `external_thread_id`   | unifica nomenclatura WA+IG                             |
| `channel`            | `channel`              | enum                                                   |
| `external_thread_id` | `external_thread_id`   | se existe e ≠ `wa_chat_id`, mantém este valor          |
| `contact_id`         | `contact_id`           | FK                                                     |
| `internal_status`    | `internal_status`      |                                                        |
| `last_message_at`    | `last_message_at`      |                                                        |
| `unread_count`       | `unread_count`         | reset > 100 (já tratado no commit 6a090d8)             |

Orphans possíveis: conversations com `contact_id` apontando pra contact que não existe → importar conversa com `contact_id=NULL` quando houver identificador externo; não criar contato fantasma.

### `messages`

| V1                | V2                     | Notas                                                    |
| ----------------- | ---------------------- | -------------------------------------------------------- |
| `id`              | metadata/raw source id | V2 gera novo id; source id preservado em `raw_json`.     |
| `conversation_id` | `conversation_id`      | FK                                                       |
| `external_id`     | `external_id`          | **canônico** no V2 (UNIQUE composto com conversation_id) |
| `direction`       | `direction`            | enum                                                     |
| `content_type`    | `content_type`         | enum                                                     |
| `body`            | `body`                 |                                                          |
| `media_path`      | `media_path`           | path relativo a uploads                                  |
| `status`          | `status`               | enum                                                     |
| `created_at`      | `created_at`           |                                                          |

Orphans possíveis: messages com `conversation_id` órfão → reporta. Mensagens sem `external_id` (V1 antigos): preserva como NULL no V2; nova UNIQUE constraint permite NULL múltiplos.

### `jobs`

| V1              | V2                  | Notas                                                                                                        |
| --------------- | ------------------- | ------------------------------------------------------------------------------------------------------------ |
| `id`            | `id`                | preserva                                                                                                     |
| —               | `user_id`           | injeta `1`                                                                                                   |
| `type`          | `type`              | enum (alguns tipos podem renomear na transição — ex.: `send-assisted-message` vira `send-instagram-message`) |
| `status`        | `status`            | enum                                                                                                         |
| `payload_json`  | `payload_json`      | mantém JSON                                                                                                  |
| `dedupe_key`    | `dedupe_key`        | preserva                                                                                                     |
| —               | `dedupe_expires_at` | injeta `+24h` se status='pending'/'processing'; NULL se 'done'/'failed'                                      |
| `attempts`      | `attempts`          |                                                                                                              |
| `max_attempts`  | `max_attempts`      |                                                                                                              |
| `scheduled_at`  | `scheduled_at`      |                                                                                                              |
| `locked_at`     | `locked_at`         |                                                                                                              |
| `locked_by`     | `locked_by`         |                                                                                                              |
| `error_message` | `error_message`     | mantém                                                                                                       |
| —               | `error_json`        | NULL (V1 não tem stack estruturada)                                                                          |
| `finished_at`   | `finished_at`       |                                                                                                              |
| `created_at`    | `created_at`        |                                                                                                              |
| `updated_at`    | `updated_at`        |                                                                                                              |

**Decisao**: importar so jobs vivos (`pending`, `processing`, `queued`, `running`). Jobs `done`/`failed` ficam no V1 como historico (V1 vira read-only apos cutover).

### `campaigns` + `campaign_recipients` + `campaign_executions`

V1 tem tanto `campaign_recipients` (novo) quanto `campaign_executions` (legado). V2 unifica em `campaign_recipients` com `step_index`.

Implementacao: `campaign_steps` e embutido em `campaigns.steps_json`; `campaign_recipients` vira tabela V2; `campaign_executions` legado vira `system_events` com `type='v215.legacy.campaign_execution'`.

### `automations` + `automation_runs` + `automation_contact_state`

`automations` vira tabela V2 com `trigger_json`, `condition_json`, `actions_json` e metadado de origem.

`automation_actions` e embutido em `automations.actions_json`. `automation_runs` e `automation_contact_state` viram `system_events` legados para preservar historico sem criar tabelas novas.

### `tags` + `contact_tags`

1:1. `user_id` em `tags` (não em `contact_tags` que é tabela de junção).

`tags.normalized_name` UNIQUE por `user_id` + `normalized_name` (não global).

### `contact_channels`

1:1. `user_id` injetado.

### `attendants`

1:1 por email/nome, com novo id V2.

### `chatbots` + `chatbot_rules`

`chatbots` e `chatbot_rules` migram para tabelas V2 com novo id e metadado de origem.

### `media_assets`

1:1 por SHA256. Files fisicos em `storage/uploads/` sao copiados para `V215_MEDIA_TARGET_ROOT` quando existem; ausentes geram warning no relatorio e mantem o `storage_path` original.

### `audit_logs`

Preserva como `audit_logs` V2 com `actor_user_id=V215_TARGET_USER_ID`; referencias orfas ficam em JSON de origem.

### `system_events`

`system_logs` e `system_events` antigos viram `system_events` V2 com payload contendo `{ v1: { sourceTable, sourceId } }`.

### `worker_state`

NÃO migra. V2 começa com worker_state limpo.

### `reminders`

1:1 com novo id V2. A origem fica nas notas de migracao para idempotencia.

## Tabelas IGNORADAS

- `data_lake_*` (todas) — fora do escopo do produto V2.
- `data_lake_sources`, `data_lake_assets`, `data_lake_reports`.
- Qualquer tabela `_test`, `_old`, `_backup`.

## Decisões pendentes (esperando Spike 4)

- [x] `campaign_executions` legacy: tabela existe, mas está vazia no snapshot de 2026-04-30.
- [x] 3.687 `messages` sem `external_id`: manter `external_id` nullable e confiar no reconcile V2 para dedupe futuro.
- [x] 63 `contacts` sem `phone`: aceito. V2 permite `phone=NULL` porque contato pode existir só por Instagram.
- [x] Orphans: pular dependentes operacionais de contatos apagados (`contact_tags`, `contact_channels`, `contact_history`, `automation_*`) em vez de criar contatos fantasma.
- [x] `campaign_recipients` com `contact_id` órfão: preservar por telefone e importar com `contact_id=NULL`.
- [x] `audit_logs` com referências órfãs: preservar histórico sem FK forte ou zerar FK, porque são 272.408 referências órfãs históricas.
- [x] Estabilização: rodar resync geral após import para reconstruir estado operacional recente.
- [x] Performance: dry-run completo em 2.257ms contra DB de 203.534.336 bytes, abaixo do limite de 60s.

## Pós-cutover

V1 fica em modo read-only. Backup completo do V1 em `s3://nuoma-files/nuoma-wpp/v1-frozen-<timestamp>/`. Depois de 30 dias estável no V2, V1 pode ser arquivado offline.
