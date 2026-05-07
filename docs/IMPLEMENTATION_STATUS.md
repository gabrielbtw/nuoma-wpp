# Implementation Status

Fonte operacional curta para `/implementation`. O historico detalhado de
execucoes fica no git; este arquivo deve mostrar apenas estado atual,
pendencias, versoes fechadas e evidencias que ainda importam para decisao.

## Snapshot

- **Linha atual:** V2 standalone em `/Users/gabrielbraga/Projetos/nuoma-wpp-v2`.
- **M principais:** 37 marcadores, de `M0` ate `M36`.
- **M/sub-M conhecidos:** 106 IDs quando contamos `M0.1`, `M35.2`, etc.
- **Pendencia aberta:** nenhuma hotfix corretiva aberta apos o fechamento de
  `M30.3`; V2.13-V2.15 e remarketing em lote real estao implementados.
- **Politica de smoke real:** todo envio real deve confirmar destino/canal e
  anexar evidencia visual. Quando for WhatsApp-only, registrar `IG nao_aplicavel`.

## Convencao De Versao

| Tipo | Uso | Exemplo |
| --- | --- | --- |
| `V2.x` | Versao/marco de produto | `V2.11 Overlay WhatsApp` |
| `V2.x.y` | Entrega incremental dentro da versao | `V2.11.7 Overlay API binding` |
| `M<n>` | Marco operacional de execucao/smoke | `M35` |
| `M<n>.<m>` | Hotfix, subversao ou follow-up rastreavel | `M30.3`, `M35.2` |

## Feito

- [x] **V2.1 Foundations** — Monorepo Turborepo/npm workspaces, TypeScript
  strict compartilhado, apps `api/web/worker`, packages `config/contracts/db/ui`,
  ADRs base e smoke `test:v21-foundations`.
- [x] **V2.2-V2.4 Domain/API/Auth** — Contratos, API health, SQLite/Drizzle,
  auth local, cookies httpOnly/CSRF, refresh e shell autenticado, com smoke
  `test:v24-api-auth`.
- [x] **V2.5 Sender runtime** — Fila duravel, DLQ, envio real WhatsApp de texto,
  voz nativa, documento, imagem, video, album e `campaign_step`, com allowlist,
  auditoria, external id, claim guard sem runtime e smoke
  `test:v25-sender-runtime`.
- [x] **V2.6 Sync engine** — Observer CDP, reconcile forçado, historico bounded,
  captura de foto de perfil, candidatos de anexos e protecoes contra roteamento
  para conversa errada.
- [x] **V2.7 API surface/storage** — Routers principais, CRUDs seguros, upload
  de midia/CRM, push, embed, streaming seguro, busca FTS5 e `M22.2` de cache S3
  autenticado.
- [x] **V2.8 Base visual** — Design system Cartographic Operations, shell mobile,
  push settings, command palette, motion com reduced-motion e smoke a11y.
- [x] **V2.9 Inbox** — Timeline glass, realtime, virtualizacao, media cards,
  status/read receipts, composer com midia/voz/emoji/quick replies, atalhos,
  filtros, busca, tags/notas/lembretes e smokes E2E.
- [x] **V2.10 Campanhas, automacoes e chatbots** — Builder visual, dry-run,
  scheduler interno opt-in, stats por step, A/B, evergreen, pause/resume,
  audit timeline materializada por recipient/job, historico de chatbot por
  mensagem, automations/chatbots builders e historico A/B `M28.1`.
- [x] **V2.11 Overlay WhatsApp + smokes reais** — Overlay Shadow DOM/FAB/painel,
  telefone, ponte `window.__nuomaApi`, auditoria, guardas de mutacao, inbound
  real, midia real, reuse de aba unica e `M29`, `M32`-`M36`, `M35.1`, `M35.2`.
- [x] **V2.12 Remote rendering CDP minimo** — Screenshot via CDP, sessao curta e
  dispatch de click/keydown/text quando habilitado.
- [x] **V2.13 Stream global** — `/api/events` com canais `inbox` e `system`,
  cursor/heartbeat, consumo pela Inbox e smoke direcionado
  `test:v213-global-events`.
- [x] **V2.14 Operacao local-first** — Backup SQLite, backup opcional do
  profile Chromium, verificacao de backup, ensaio de restore e restore aplicado
  com confirmacao forte em `scripts/v214-backup-restore.mjs`, coberto por
  `test:v214-backup-restore`.
- [x] **V2.15 Migracao/cutover V1 -> V2** — Preflight nao destrutivo e cutover
  operacional idempotente em `scripts/v215-cutover-preflight.mjs` e
  `scripts/v215-cutover-apply.mjs`. O apply faz backup pre-cutover, bloqueia
  jobs ativos, exige `V215_CONFIRM_CUTOVER=SIM` e importa tags, contatos,
  conversas, mensagens, midias, campanhas e recipients sem apagar dados V2.
- [x] **Remarketing seguro** — Console de disparo com dry-run forte, confirmacao
  textual, guardrails por telefone/status/canal/allowlist/supressao/duplicidade,
  fila serial por telefone e eventos `sender.campaign_step.started|failed|completed`.
- [x] **Remarketing em lote real** — Console aceita lote de telefones, valida
  lote inteiro antes de criar recipients/jobs, bloqueia lote parcial, exige
  allowlist e `temporaryMessages` M30.3 `24h/90d`, e registra evento
  `campaign.remarketing_batch.dispatched` com `executionMode=whatsapp_real`.
- [x] **M30.3 Contexto real 24h no WhatsApp** — Worker CDP abre/reusa o chat
  correto, aplica/verifica mensagens temporarias 24h antes do primeiro step,
  bloqueia envio quando nao consegue provar o estado, mantem a janela nos steps
  intermediarios e restaura 90d apos conclusao segura com eventos
  `sender.temporary_messages.audit` em `executionMode=whatsapp_real`.

## Parcial

- [~] **V2.7 API surface IG** — `conversations.listUnified` fica parcial porque
  Instagram segue fora do fluxo cotidiano ate iniciativa explicita.

## Falta

Nenhuma pendencia operacional `V2.*` aberta neste checkpoint. Instagram/DM
segue fora do fluxo cotidiano ate iniciativa explicita.

## Evidencias Recentes

- **2026-05-07 / V2.1 fechado 100%:** criado `npm run test:v21-foundations`
  para validar workspaces, scripts raiz, Turbo tasks, aliases TS, ADRs e
  arquivos-base dos apps/packages. Evidencia esperada:
  `v21-foundations|workspaces=7|rootFiles=10|aliases=8|status=closed`.
- **2026-05-07 / V2.4 fechado 100%:** criado `npm run test:v24-api-auth` para
  validar `/health`, login tRPC, cookies, `auth.me`, refresh e bloqueio CSRF.
  Evidencia: `v24-api-auth|health=ok|login=ok|refresh=ok|csrf=ok|status=closed`.
- **2026-05-07 / V2.5 fechado 100%:** criado `npm run test:v25-sender-runtime`
  para validar que jobs de envio nao sao claimados sem runtime, envio permitido
  registra auditoria, alvo fora da allowlist vai para DLQ e nenhum envio ocorre
  no bloqueio. Evidencia:
  `v25-sender-runtime|claim_guard=ok|send=ok|allowlist_block=ok|dlq=ok|status=closed`.
- **2026-05-07 / V2.10 hardening fechado 100%:** corrigido falso positivo do
  checkpoint: recipients de campanha agora mantem `metadata.auditTrail`
  materializado por scheduler/job/worker/temporary-message audit, a listagem de
  campanhas mescla essa trilha com `system_events`, e chatbots ganharam
  `chatbots.evaluateMessage` + `chatbots.executionHistory` para persistir
  historico por mensagem sem criar job. Evidencia:
  `npm run test:v210-hardening`.
- **2026-05-07 / Remarketing em lote real fechado:** adicionados
  `campaigns.remarketingBatchReady` e `campaigns.remarketingBatchDispatch`,
  painel `V2.10.36` na tela de campanhas, confirmacao `DISPARAR LOTE <n>`,
  bloqueio de telefone rejeitado/duplicado/fora da allowlist e exigencia de
  `temporaryMessages` `24h/90d`. Evidencias:
  `npm run test:v210-remarketing-batch-real`, `npm run test:v2-screen-smoke`
  e prints em
  `data/v2-screen-smoke-2026-05-07T05-29-30-647Z/REPORT.md`.
- **2026-05-07 / V2.11 fechado 100%:** `npm run test:v211-overlay-suite`
  passou unit/FAB/painel/telefone/API no WhatsApp real. Evidencias principais:
  `v211-overlay-phone|wppPhone=5531982066263|wppSource=title-conversation|sendJobsDelta=0|m=34`
  e
  `v211-overlay-api|wppApi=online|wppMethod=contactSummary|wppPhone=5531982066263|wppMode=worker-cdp-binding|m=35`.
  O overlay agora ignora controles do header como `Dados do perfil`, hidrata
  contato salvo por titulo/conversa e preserva o bridge CDP em reinjecoes.
- **2026-05-07 / V2.12 fechado 100%:** `npm run test:v212-streaming-cdp`
  passou unit + smoke forte CDP com screenshot e input relay:
  `v212-streaming-cdp-strong|target=https://web.whatsapp.com/|bytes=977390|click=accepted|keydown=accepted|status=passed`.
- **2026-05-07 / V2.13-V2.15 fechado 100%:** criado
  `npm run test:v213-v215-suite`, cobrindo stream global, backup/restore,
  preflight de cutover e apply idempotente. Evidencias:
  `v214-backup-restore-smoke|backup=ok|verify=ok|restore=ok|status=closed`,
  `v215-cutover-preflight-smoke|ready=ok|blocker=ok|status=closed` e
  `v215-cutover-apply-smoke|dryRun=ok|apply=ok|idempotent=ok|status=closed`.
  Rodada real de backup DB V2 local retornou
  `v214-backup-restore|mode=backup|verified=ok|profileBackup=skipped|status=closed`.
  Rodadas reais nao destrutivas nos DBs locais retornaram
  `v215-cutover-preflight|v1Contacts=12958|v1Conversations=1803|v1Messages=3826|v2Contacts=124|v2ActiveJobs=0|blockers=0|warnings=2|status=ready`
  e
  `v215-cutover-apply|mode=dry-run|contacts=12958|conversations=1803|messages=3826|campaigns=10|recipients=10|blockers=0|backup=not_created|status=ready`.
- **2026-05-06 / M30.3 aberto:** batch
  `campaign:40:recipient:298:24h:1778093175183`, jobs `267..271`, completou com
  `navigationMode=reused-open-chat`, audio nativo `37s`, album `4/4`,
  `pageCount=1` e zero jobs ativos, mas nao ficou no contexto real de 24h do
  WhatsApp. Esse ponto bloqueia considerar automacao/remarketing definitivo.
- **2026-05-06 / M30.3 implementado:** runtime CDP ganhou
  `ensureTemporaryMessages`, o `campaign_step` passa a bloquear envio quando
  nao consegue verificar 24h e o smoke `test:m303-neferpeel-temporary-context`
  valida a evidencia real apos execucao Neferpeel confirmada.
- **2026-05-06 / M30.3 fechado Neferpeel real:** campanha `40` registrou
  print fonte de verdade antes do envio em
  `data/m303-neferpeel-before-send-24h-proof-v5.png` com chat
  `Gabriel Braga Nuoma` e painel real `Mensagens temporarias` em `24 horas`;
  depois restaurou `90d` com `after_completion_restore verified=true` e print
  visual em `data/m303-neferpeel-after-restore-90d-proof.png` mostrando o radio
  `90 dias` marcado. O verificador CDP passou a exigir a opcao marcada
  (`aria-checked=true` / `checked`) em vez de aceitar texto solto no painel, e
  o clique da duracao passou a priorizar o input/radio real associado ao label.
  Prova completa em `data/m303-full-wpp-proof-2026-05-06T21-36-58-297Z/`:
  `04` radio 24h, `05` popup 24h, `09` envio as 18:37, `11` radio 90d,
  `12` popup 90 dias apos sair do painel.
- **2026-05-07 / M30.3 smoke oficial:** criado
  `npm run test:m303-wpp-24-send-90-proof`, protegido por
  `M303_CONFIRM_WPP_REAL=SIM`. Rodada real com
  `M303_WPP_PHONE=5531982066263` gerou
  `data/m303-wpp-24-send-90-proof-2026-05-07T03-44-55-491Z/`: `04` radio
  24h, `05` popup 24h mais recente, `06` envio as 00:45, `08` radio 90d,
  `09` popup 90d mais recente e `10` painel reaberto com 90d marcado.
  Smoke M30.3: `completed=5`, `failed=0`, `activeJobs=0`,
  `outsideAllowlist=0`, `IG nao_aplicavel`.
- **2026-05-06 / Remarketing seguro:** validado com typecheck dos workspaces
  `db`, `api`, `worker`, `web`, testes direcionados de DB/API/worker e build web.
- **2026-05-06 / Smokes fortes:** M22.2, M28.1, V2.12, V2.13 e V2.11 real
  inbound/midia passaram com prints app + WhatsApp; `IG nao_aplicavel` nos
  fluxos WhatsApp-only.
- **2026-05-06 / Aba unica sem refresh por mensagem:** campanha Neferpeel BH
  rodou em sequencia com `pageCount=1`, reuso do chat aberto e zero jobs ativos
  ao final.

## Manutencao

- Atualizar este arquivo apenas com estado atual, pendencias, smoke forte recente
  e versoes/hotfixes que mudam decisao.
- Registrar `M<n>.<m>` como hotfix/subversao quando for correcao pontual ou
  hardening derivado de um marco ja fechado.
- Evitar anexar diario completo de execucao aqui; detalhes antigos ficam
  recuperaveis pelo git.
