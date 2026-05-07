# V2 tRPC Procedures

Status: V2.7 API surface auditada em 2026-05-04.

## Root Routers

- `auth`: login, sessão, refresh, troca/reset de senha.
- `users`: listagem, detalhe, criação, update e desativação admin.
- `contacts`: listagem, busca, detalhe, criação, importação, update e soft delete.
- `conversations`: listagem, listagem unificada WhatsApp/Instagram/System, detalhe, criação, update, arquivamento, force sync e histórico.
- `messages`: CRUD base, timeline por conversa e enqueue de envio.
- `quickReplies`: respostas rápidas salvas, busca, criação, update, soft delete e contador de uso.
- `campaigns`: listagem com métricas/timeline, detalhe, criação, update, arquivamento, elegibilidade por conversa, execute seguro e tick scheduler.
- `automations`: listagem, detalhe, criação, update, elegibilidade por conversa, teste seco e trigger manual seguro.
- `chatbots`: listagem, detalhe, criação, update, arquivamento/restauração, regras, desativação de regra, teste seco de regra e histórico A/B de variantes.
- `tags`: listagem, criação, update e delete.
- `attendants`: listagem, criação e update admin.
- `jobs`: listagem, DLQ, retry e cleanup.
- `system`: health, events e métricas operacionais para implantação.
- `implementation`: status visual do roadmap.
- `media`: registro/dedup de assets por SHA256, upload físico multipart, detalhe, update, soft delete e listagem.
- `push`: subscribe, unsubscribe e teste com entrega web-push quando VAPID estiver configurado.
- `embed`: resumo de contato, automações elegíveis, dispatch seguro e nota por telefone.
- `streaming`: screencast CDP opt-in com captura PNG e relay seguro de input por sessão curta.
- `/api/events`: SSE global autenticado por cookie com canais `inbox` e `system`, envelopes `nuoma-event`, replay de `system_events` por cursor e heartbeat único.

## Segurança

- Procedures de leitura operacional usam sessão autenticada.
- Mutations usam CSRF.
- Jobs/admin/system sensíveis exigem role `admin`.
- `messages.send` e `messages.sendVoice` têm hard guard para `5531982066263` e depois aplicam `API_SEND_POLICY_MODE`/`API_SEND_ALLOWED_PHONES` antes de enfileirar job; `campaigns.execute` e `automations.trigger` só aceitam override cliente `allowedPhone` quando ele é o canário `5531982066263`; envio real continua protegido no worker por `WA_SEND_POLICY_MODE`, `WA_SEND_ALLOWED_PHONES`/`WA_SEND_ALLOWED_PHONE`, rate limit persistido e guarda do chat ativo.
- `streaming.*` só controla browser quando `API_STREAMING_ENABLED=true`, existe sessão explícita de screencast e o usuário é admin.
- `/api/events` exige cookie de acesso, aceita `channels=system,inbox` e cursor `sinceSystemEventId` ou `Last-Event-ID: system:<id>`; o cliente deve filtrar pelo campo `channel` do envelope.
- `push.test` tenta entrega real via Web Push quando `API_WEB_PUSH_VAPID_PUBLIC_KEY` e `API_WEB_PUSH_VAPID_PRIVATE_KEY` existem; sem VAPID, registra evento local em modo seguro `event-only`.

## V2.7 Coverage

| Item                                    | Status          | Evidência                                                                                                                                                     |
| --------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V2.7.1 routers principais               | Feito           | Root router expõe auth/users/contacts/conversations/messages/campaigns/automations/chatbots/tags/attendants/jobs/system/embed/streaming/push/media            |
| V2.7.1a users admin base                | Feito           | list/get/create/update/deactivate existem; deactivate usa `isActive=false`                                                                                    |
| V2.7.2 contacts CRUD base               | Feito           | list/get/create/update/delete soft existem                                                                                                                    |
| V2.7.3 conversations CRUD base          | Feito           | list/get/create/update/softDelete/restore existem; delete é arquivamento lógico                                                                               |
| V2.7.4 messages CRUD base               | Feito           | listByConversation/get/create/update/softDelete existem; `send` segue como enqueue separado                                                                   |
| V2.7.5 campaigns CRUD base              | Feito           | list/get/create/update/softDelete/restore existem; execute/tick ficam separados                                                                               |
| V2.7.6 automations CRUD base            | Feito           | list/get/create/update/softDelete/restore existem; trigger manual fica em V2.7.17                                                                             |
| V2.7.7 tags CRUD base                   | Feito           | list/create/update/delete existem                                                                                                                             |
| V2.7.8 attendants CRUD base             | Feito           | list/create/update admin existem                                                                                                                              |
| V2.7.9 chatbots CRUD base               | Feito           | list/get/create/update/softDelete/restore/listRules/createRule/updateRule/deleteRule existem                                                                  |
| V2.7.10 jobs.list                       | Feito           | `jobs.list` admin                                                                                                                                             |
| V2.7.11 contacts.import                 | Feito           | Importa `csv` ou `rows`, suporta `dryRun`, dedupe e update opcional                                                                                           |
| V2.7.12 contacts.search                 | Feito           | Busca usa FTS5 físico `contacts_fts` com triggers de sync e fallback LIKE se a migration ainda não existir                                                    |
| V2.7.13 conversations.listUnified       | Feito           | Retorna WhatsApp/Instagram/System em uma surface, filtra por canal, busca por titulo/thread/contato/telefone/@IG e devolve resumo por canal                   |
| V2.7.14 messages.send                   | Feito           | Enfileira `send_message`/`send_instagram_message`                                                                                                             |
| V2.7.15 campaigns.execute               | Feito           | `dryRun=true` por padrão; aceita `phones`, `contactIds` ou `conversationId`; execução real usa `API_SEND_POLICY_MODE`/`API_SEND_ALLOWED_PHONES` antes de criar recipients |
| V2.10.36 campaigns.remarketingBatchReady/Dispatch | Feito | Valida lote real inteiro antes de criar recipients/jobs, exige confirmacao `DISPARAR LOTE <n>`, allowlist, sem jobs/recipients ativos e `temporaryMessages` M30.3 `24h/90d`; registra `campaign.remarketing_batch.dispatched` |
| V2.7.16 campaigns.preview               | Feito           | `campaigns.tick({ dryRun: true })`                                                                                                                            |
| V2.7.17 automations.trigger             | Feito           | Trigger manual com `dryRun=true` por padrão; aceita `phone` ou `conversationId`; execução real usa a política `test`/`production` da API                      |
| V2.7.18 automations.test                | Feito           | Teste seco de elegibilidade sem enfileirar job                                                                                                                |
| V2.7.19 chatbots.testRule               | Feito           | Teste seco por `phone` + `body`, sem enfileirar job                                                                                                           |
| V2.7.19a chatbots A/B history           | Feito           | `recordVariantEvent`, `listVariantEvents` e `summarizeVariantEvents` persistem exposição/conversão por chatbot/regra/variante com dedupe por `sourceEventId` |
| V2.7.20 embed.contactSummary            | Feito           | Busca por telefone, conversas e últimas mensagens                                                                                                             |
| V2.7.21 embed.eligibleAutomations       | Feito           | Filtra automações ativas compatíveis com canal                                                                                                                |
| V2.7.22 embed.dispatchAutomation        | Feito           | Reusa trigger manual seguro com dry-run padrão                                                                                                                |
| V2.7.23 embed.addNote                   | Feito           | Anexa nota no contato por telefone                                                                                                                            |
| V2.7.24 streaming.startScreencast       | Feito           | Com `API_STREAMING_ENABLED=true`, conecta ao CDP, captura PNG por `Page.captureScreenshot`, retorna `sessionId`, `targetUrl` e expiração curta                |
| V2.7.25 streaming.dispatchInput         | Feito           | Com sessão ativa, relaya `click`, `keydown` e `text` via CDP; sem sessão ou streaming desligado retorna bloqueio seguro                                      |
| V2.7.26 system.health/metrics/events    | Feito           | Health público, events admin e metrics de implantação com fila, DLQ, workers, CDP/sessão WhatsApp, política de envio e eventos críticos                       |
| V2.13 global event stream               | Feito           | `/api/events` entrega canais `system` e `inbox` em SSE único, com replay incremental de `system_events`, `Last-Event-ID` e consumidor da Inbox migrado para o canal global |
| V2.7.27 push.subscribe/unsubscribe/test | Feito           | Persistência subscription, unsubscribe, `push.test` com Web Push real quando VAPID existe e fallback `event-only` sem VAPID                                   |
| V2.7.28 media.upload                    | Feito           | tRPC registra asset por SHA256; `/api/media/upload` recebe multipart real, grava arquivo físico, deduplica por SHA256 e cria `media_assets`                   |
| V2.7.29 docs                            | Feito           | Este documento                                                                                                                                                |
| V2.7.30 tests                           | Feito           | Suite API (`app`, scheduler e push delivery) e suite DB passam; cobre rotas operacionais, import/search, upload multipart, Web Push configurado e FTS5 físico |
| V2.7.31 CRM file storage                | Feito           | `/api/media/upload` aceita `crmOwnerKey` ou `conversationId` e grava no provider `local`/`s3` sob `/nuoma/files/crm/<phone-or-contact>/`; `/api/media/assets/:id` lê `s3://` por GET SigV4 com cache local privado |

## Extensões V2.9

| Item                                    | Status | Evidência                                                                                                                                             |
| --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| V2.9.16 automations.listForConversation | Feito  | Avalia automações para uma conversa, com busca, filtro `onlyEligible`, canal, janela 24h, preview dry-run e indicação de bloqueio real por allowlist. |
| V2.9.17 campaigns.listForConversation   | Feito  | Avalia campanhas para uma conversa, com busca, filtro `onlyEligible`, canal/status/telefone/dedupe e indicação de bloqueio real por allowlist.        |

## Validação

```bash
npm run typecheck --workspace @nuoma/db
npm run typecheck --workspace @nuoma/api
npm run test --workspace @nuoma/db -- src/repositories.test.ts
npm run test --workspace @nuoma/api -- src/app.test.ts
```
