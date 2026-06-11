# Spike 4 — Migration dry-run V1 SQLite

## Status

VERDE

Executado em 2026-04-30T17:33:22.993Z. Duração: 2562ms.

## Fonte

- Source DB: `/Users/gabrielbraga/Projetos/nuoma-wpp/storage/database/nuoma.db`
- Snapshot: `/Users/gabrielbraga/Projetos/nuoma-wpp/experiments/spike-4-migration/snapshots/v1-snapshot.db`
- Snapshot method: `sqlite-backup`
- DB size: 203.534.336 bytes
- WAL size no momento do snapshot: 0 bytes

## Totais

- Linhas escaneadas: 488.511
- Linhas importáveis no dry-run: 422.963
- Linhas puladas por regra: 65.548
- Orphans totais: 334.158
- Orphans críticos: 40.786
- JSON inválidos: 0
- Tabelas obrigatórias ausentes: nenhuma

## Tabelas

| tabela | existe | scanned | importavel | skipped | orphans |
|---|---:|---:|---:|---:|---:|
| `contacts` | sim | 12.958 | 12.958 | 0 | 0 |
| `conversations` | sim | 1.803 | 1.803 | 0 | 0 |
| `messages` | sim | 3.826 | 3.826 | 0 | 0 |
| `jobs` | sim | 3.809 | 0 | 3.809 | 0 |
| `campaigns` | sim | 10 | 10 | 0 | 0 |
| `campaign_steps` | sim | 65 | 65 | 0 | 0 |
| `campaign_recipients` | sim | 10 | 10 | 0 | 10 |
| `campaign_executions` | sim | 0 | 0 | 0 | 0 |
| `automations` | sim | 3 | 3 | 0 | 0 |
| `automation_actions` | sim | 16 | 16 | 0 | 0 |
| `automation_contact_state` | sim | 159 | 155 | 4 | 4 |
| `automation_runs` | sim | 243 | 231 | 12 | 13 |
| `tags` | sim | 12 | 12 | 0 | 0 |
| `contact_tags` | sim | 33.489 | 13.108 | 20.381 | 20.381 |
| `contact_channels` | sim | 33.330 | 12.952 | 20.378 | 20.378 |
| `contact_history` | sim | 38.190 | 17.226 | 20.964 | 20.964 |
| `attendants` | sim | 1 | 1 | 0 | 0 |
| `chatbots` | sim | 2 | 2 | 0 | 0 |
| `chatbot_rules` | sim | 5 | 5 | 0 | 0 |
| `media_assets` | sim | 1 | 1 | 0 | 0 |
| `audit_logs` | sim | 280.103 | 280.103 | 0 | 272.408 |
| `system_logs` | sim | 80.476 | 80.476 | 0 | 0 |
| `reminders` | sim | 0 | 0 | 0 | 0 |

## Orphans

| `campaign_recipients` | `contacts` | contact_id->id | 10 |
| `automation_contact_state` | `contacts` | contact_id->id | 4 |
| `automation_runs` | `conversations` | conversation_id->id | 1 |
| `automation_runs` | `contacts` | contact_id->id | 12 |
| `contact_tags` | `contacts` | contact_id->id | 20.381 |
| `contact_channels` | `contacts` | contact_id->id | 20.378 |
| `contact_history` | `contacts` | contact_id->id | 20.964 |
| `audit_logs` | `conversations` | conversation_id->id | 77.113 |
| `audit_logs` | `contacts` | contact_id->id | 195.295 |

## Política Simulada

| tabela | skipped | warnings/set-null |
|---|---|---|
| `contacts` | - | contacts-without-phone: 63 |
| `messages` | - | messages-without-external-id: 3.687 |
| `jobs` | job-failed-history: 581; job-done-history: 3.225; job-cancelled-history: 3 | - |
| `campaign_recipients` | - | set-null-orphan-contact-id: 10 |
| `automation_contact_state` | orphan-contact-id: 4 | - |
| `automation_runs` | orphan-contact-id: 12 | - |
| `contact_tags` | orphan-contact-id: 20.381 | - |
| `contact_channels` | orphan-contact-id: 20.378 | - |
| `contact_history` | orphan-contact-id: 20.964 | - |
| `audit_logs` | - | drop-orphan-contact-reference: 195.295; drop-orphan-conversation-reference: 77.113 |

## Politica Aceita

- 3687 messages sem external_id: manter NULL permitido e confiar no reconcile V2 para dedupe futuro.
- 63 contacts sem phone: aceito. V2 permite phone NULL porque contatos podem existir só por Instagram.
- 61739 linhas dependentes de contatos/parents apagados serao puladas no import operacional.
- 272418 referencias orfas serao preservadas com FK nula/removida, principalmente em recipients e audit_logs.
- 293372 orphans em tabelas historicas/auditoria: preservar sem FK forte ou com FK nula, sem bloquear o import.
- Etapa de estabilizacao V2 deve rodar resync geral para reconstruir estado operacional recente apos o import.

## Samples E Tipos

Samples redigidos e validação de tipos por coluna estão em `reports/dryrun.json`.
