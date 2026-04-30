# V1 → V2 — Mapa de migração de dados

Documento de referência para Spike 4 + ferramenta de migração futura. Lista cada tabela operacional do V1 e como deve ser mapeada para o schema V2.

**Status**: rascunho de Spike 4. Será preenchido com contagens reais e decisões pendentes durante o spike.

## Princípios

1. **V1 SQLite é read-only** durante migração. Sempre trabalhar numa cópia.
2. **`user_id` injetado**: V1 não tem multi-user; toda linha vira `user_id=1` (admin seeded no V2).
3. **`data_lake_*`, AI tables, tabelas fora do escopo do produto** são **ignoradas**.
4. **External IDs preservados** quando existem (`wa_chat_id`, `external_thread_id`, `external_id` em messages).
5. **FKs com `ON DELETE CASCADE`** no V2 — durante import, valida que todos os parents existem; orphans são reportados, não importados silenciosamente.
6. **Soft delete preservado**: linhas com `deleted_at` em V1 viram `deleted_at` em V2 (se a tabela tiver no V1; senão, não é introduzido pra esse import).

## Tabelas mapeadas

### `users` (nova no V2)

V1 não tem. Cria 1 linha:

```sql
INSERT INTO users (id, email, password_hash, role, display_name, created_at)
VALUES (1, '<owner-email>', '<bcrypt-hash-from-env>', 'admin', 'Gabriel', CURRENT_TIMESTAMP);
```

Email vem de prompt interativo durante migração. Password hash vem de prompt interativo + Argon2id.

### `contacts`

V1 → V2: 1:1, com adição de `user_id=1`.

| V1 (campo) | V2 (campo) | Notas |
|---|---|---|
| `id` | `id` | preserva |
| — | `user_id` | injeta `1` |
| `phone` | `phone` | mantém UNIQUE constraint condicional |
| `name` | `name` | |
| `email` | `email` | |
| `cpf` | `cpf` | |
| `instagram` | `instagram` | |
| `status` | `status` | enum mantido |
| `notes` | `notes` | |
| `created_at` | `created_at` | |
| `updated_at` | `updated_at` | |

Orphans esperados: nenhum (contacts é raiz).

### `conversations`

| V1 | V2 | Notas |
|---|---|---|
| `id` | `id` | preserva |
| — | `user_id` | injeta `1` |
| `wa_chat_id` | `external_thread_id` | unifica nomenclatura WA+IG |
| `channel` | `channel` | enum |
| `external_thread_id` | `external_thread_id` | se existe e ≠ `wa_chat_id`, mantém este valor |
| `contact_id` | `contact_id` | FK |
| `internal_status` | `internal_status` | |
| `last_message_at` | `last_message_at` | |
| `unread_count` | `unread_count` | reset > 100 (já tratado no commit 6a090d8) |

Orphans possíveis: conversations com `contact_id` apontando pra contact que não existe → reporta + opção de criar contato fantasma.

### `messages`

| V1 | V2 | Notas |
|---|---|---|
| `id` | `id` | preserva |
| `conversation_id` | `conversation_id` | FK |
| `external_id` | `external_id` | **canônico** no V2 (UNIQUE composto com conversation_id) |
| `direction` | `direction` | enum |
| `content_type` | `content_type` | enum |
| `body` | `body` | |
| `media_path` | `media_path` | path relativo a uploads |
| `status` | `status` | enum |
| `created_at` | `created_at` | |

Orphans possíveis: messages com `conversation_id` órfão → reporta. Mensagens sem `external_id` (V1 antigos): preserva como NULL no V2; nova UNIQUE constraint permite NULL múltiplos.

### `jobs`

| V1 | V2 | Notas |
|---|---|---|
| `id` | `id` | preserva |
| — | `user_id` | injeta `1` |
| `type` | `type` | enum (alguns tipos podem renomear na transição — ex.: `send-assisted-message` vira `send-instagram-message`) |
| `status` | `status` | enum |
| `payload_json` | `payload_json` | mantém JSON |
| `dedupe_key` | `dedupe_key` | preserva |
| — | `dedupe_expires_at` | injeta `+24h` se status='pending'/'processing'; NULL se 'done'/'failed' |
| `attempts` | `attempts` | |
| `max_attempts` | `max_attempts` | |
| `scheduled_at` | `scheduled_at` | |
| `locked_at` | `locked_at` | |
| `locked_by` | `locked_by` | |
| `error_message` | `error_message` | mantém |
| — | `error_json` | NULL (V1 não tem stack estruturada) |
| `finished_at` | `finished_at` | |
| `created_at` | `created_at` | |
| `updated_at` | `updated_at` | |

**Decisão**: importar só jobs com status `pending` ou `processing` (são os "vivos"). Jobs `done`/`failed` ficam no V1 como histórico (V1 vira read-only após cutover).

### `campaigns` + `campaign_recipients` + `campaign_executions`

V1 tem tanto `campaign_recipients` (novo) quanto `campaign_executions` (legado). V2 unifica em `campaign_recipients` com `step_index`.

Decisão pendente: como reconciliar quando o mesmo phone aparece nas duas tabelas? Spike 4 vai trazer isso à tona.

### `automations` + `automation_runs` + `automation_contact_state`

1:1. `user_id` injetado.

`automation_actions` (se existir como tabela separada) preserva integralmente.

### `tags` + `contact_tags`

1:1. `user_id` em `tags` (não em `contact_tags` que é tabela de junção).

`tags.normalized_name` UNIQUE por `user_id` + `normalized_name` (não global).

### `contact_channels`

1:1. `user_id` injetado.

### `attendants`

1:1.

### `chatbots` + `chatbot_rules`

1:1. `user_id` em `chatbots`.

### `media_assets`

1:1. `user_id` injetado. Files físicos em `storage/uploads/` precisam ser **copiados** pra `data/uploads/` do V2 (ou volume Docker compartilhado durante migração).

### `audit_logs`

Preserva integralmente. `actor_user_id` = 1 (todas as ações antigas viraram do admin).

### `system_events`

Preserva integralmente. Adiciona `migrated_from_v1=true` flag.

### `worker_state`

NÃO migra. V2 começa com worker_state limpo.

### `reminders`

1:1. `user_id` injetado.

## Tabelas IGNORADAS

- `data_lake_*` (todas) — fora do escopo do produto V2.
- `data_lake_sources`, `data_lake_assets`, `data_lake_reports`.
- Qualquer tabela `_test`, `_old`, `_backup`.

## Decisões pendentes (esperando Spike 4)

- [ ] Como tratar campaign_executions legacy com IDs que conflitam com campaign_recipients novos.
- [ ] Como tratar messages sem `external_id` que serão re-detectadas pelo sync V2 (insert OR ignore deve handle, mas validar).
- [ ] Estratégia de import: incremental (uma tabela por vez, com FK constraints diferidas) ou bulk (transação única)?
- [ ] Orphans: criar contacts fantasma com `name='Migration orphan'` ou pular?
- [ ] Limite de tamanho do DB final pós-import (estimar volume).

## Pós-cutover

V1 fica em modo read-only. Backup completo do V1 em `s3://nuoma-files/nuoma-wpp/v1-frozen-<timestamp>/`. Depois de 30 dias estável no V2, V1 pode ser arquivado offline.
