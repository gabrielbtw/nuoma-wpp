# Full Real Audit Status

Data: 2026-06-12.
Ultima atualizacao desta rodada: 2026-06-12 03:50 -03.

Escopo pedido: validar tela a tela/menu a menu e provar fluxos reais de campanha,
automacao, chatbot, sincronizacao e worker com prints. Esta pagina e o diario
de cobertura; ela deve ficar atualizada a cada rodada.

## Estado Atual

| Frente                   | Status   | Evidencia                                                                                                                                                                                    | Lacuna                                                                                                                       |
| ------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Campanha multimidia real | Validado | Campanha real WhatsApp `#250`, recipient `5579`, jobs `3066-3073`, 8 steps completos, `EVENTOS 23`, `OK 8`, `FALHAS 0`, audio nativo `25s`, prints finais salvos.                            | Nenhuma lacuna aberta para o canario WhatsApp desta rodada. `IG nao aplicavel` registrado porque este smoke e WhatsApp-only. |
| Campanha/FlowBuilder UI  | Validado | `test:v210-campaigns`, `test:v210-flow-builders`, `test:v210-campaign-builder-mobile`; matriz visual `/campaigns` desktop/mobile limpa; prova real multimidia coberta pelo novo smoke.       | Nenhuma lacuna visual aberta nesta rodada.                                                                                   |
| Automacao                | Validado | `automation-engine-daemon.test.ts` prova `message_received`, `tag_applied`, `tag_removed` e `campaign_completed`; `test:v29-automation-trigger` passou com `blocking=0` e prints novos.      | Nenhuma lacuna aberta nos gatilhos declarados em contrato nesta rodada.                                                      |
| Chatbot                  | Validado | Daemon inbound agora enfileira `chatbot_reply`; API test prova `inbound -> regra ativa -> job`; worker test prova consumo WhatsApp/Instagram; smoke UI A/B passou com `sendJobsDelta=0`.     | Nenhuma lacuna aberta no produtor/consumer de `chatbot_reply`; UI continua dry-run sem envio real.                           |
| Sync/worker/overlay      | Validado | `test:v211-overlay-suite` passou no-send com CDP e `sendJobsDelta=0`; `v211-overlay-campaign-data` agora termina `status=ok`; Instagram live read-only provado na sessao Chrome for Testing. | Sync Instagram real segue desabilitado no worker desta auditoria; fixture/read-only esta validado sem envio.                 |
| Prints finais            | Validado | Matriz final tela-a-tela/menu-a-menu gerou 26 prints desktop/mobile em `/tmp/nuoma-full-audit/menu-matrix/current`; todos com `wait=ok` e `a11y_blocking=0`.                                 | Nenhuma lacuna aberta nos prints finais da matriz visual.                                                                    |

## Smoke Real De Campanha Multimidia

Comando protegido:

```bash
CAMPAIGN_REAL_MEDIA_SEND=SIM \
CAMPAIGN_REAL_MEDIA_ALLOWED_PHONE=5531982066263 \
SMOKE_PHONE=5531982066263 \
npm run test:v2-full-campaign-real-media
```

Se houver recipient de smoke antigo travando o canario, e somente depois de
confirmar que sao linhas de smoke, usar:

```bash
CAMPAIGN_REAL_MEDIA_SEND=SIM \
CAMPAIGN_REAL_MEDIA_CANCEL_STALE_SMOKE=SIM \
CAMPAIGN_REAL_MEDIA_ALLOWED_PHONE=5531982066263 \
SMOKE_PHONE=5531982066263 \
npm run test:v2-full-campaign-real-media
```

O smoke:

- exige `CAMPAIGN_REAL_MEDIA_SEND=SIM`;
- exige `SMOKE_PHONE` igual ao canario permitido;
- cria assets reais via `media.upload`;
- cria campanha via `campaigns.create`;
- ativa via `campaigns.update`;
- dispara via `campaigns.execute` com `dryRun=false`;
- espera jobs `campaign_step` reais completarem;
- valida eventos `sender.campaign_step.completed`;
- captura print do WhatsApp e da pagina de campanhas;
- grava prints fora do repo em `/tmp/nuoma-full-audit/campaign-real-media`.

### Resultado validado

Primeira rodada real corrigida e aprovada:

```bash
CAMPAIGN_REAL_MEDIA_SEND=SIM \
CAMPAIGN_REAL_MEDIA_ALLOWED_PHONE=5531982066263 \
SMOKE_PHONE=5531982066263 \
SMOKE_TOKEN=FCMR-1781241858913 \
SMOKE_LONG_AUDIO_MS=25000 \
npm run test:v2-full-campaign-real-media
```

Resultado:

- campanha: `#250`;
- recipient: `5579`;
- jobs: `3066,3067,3068,3069,3070,3071,3072,3073`;
- steps completos: `tmp-24`, `text-main`, `message-main`, `link-main`,
  `image-main`, `video-main`, `pdf-main`, `audio-long-main`;
- scheduler: 8 jobs criados na execucao real;
- WhatsApp: video, PDF e audio longo visiveis na conversa canario;
- worker event: `audioNative=1`, `audioDurationEvent=25`;
- app: aba `Campanhas / Destinatarios` mostra `EVENTOS 23`, `OK 8`,
  `FALHAS 0` e estatisticas por step;
- print WhatsApp:
  `/tmp/nuoma-full-audit/campaign-real-media/FCMR-1781241858913-whatsapp-campaign.png`;
- print app:
  `/tmp/nuoma-full-audit/campaign-real-media/FCMR-1781241858913-campaigns-app.png`;
- `IG nao aplicavel`: validacao WhatsApp-only sem envio Instagram.

Prova reexecutavel sem novo envio real:

```bash
CAMPAIGN_REAL_MEDIA_SEND=SIM \
CAMPAIGN_REAL_MEDIA_PROOF_CAMPAIGN_ID=250 \
CAMPAIGN_REAL_MEDIA_ALLOWED_PHONE=5531982066263 \
SMOKE_PHONE=5531982066263 \
SMOKE_TOKEN=FCMR-1781241858913 \
SMOKE_LONG_AUDIO_MS=25000 \
npm run test:v2-full-campaign-real-media
```

Ultima reexecucao `proof-only`: passou em 2026-06-12 03:47 -03 e regenerou
os prints finais sem reenviar mensagens:
`status=completed`, `campaign=250`, `recipient=5579`, jobs `3066-3073`,
`audioNative=1`, `audioDurationEvent=25`, `ig=nao_aplicavel`.

## Matriz Visual Tela A Tela

Comando final:

```bash
rm -rf /tmp/nuoma-full-audit/menu-matrix/current
V2_SCREEN_SMOKE_DIR=/tmp/nuoma-full-audit/menu-matrix/current \
npm run test:v2-screen-smoke
```

Resultado final:

- `v2-screen-smoke|items=26`;
- relatorio:
  `/tmp/nuoma-full-audit/menu-matrix/current/REPORT.md`;
- 13 telas desktop `1440x980` e 13 telas mobile `390x844`;
- todas as rotas com `wait=ok`;
- todas as rotas autenticadas com `a11y_blocking=0`;
- campanha segura validada no painel de lote:
  `campaign=264`, `canDispatch=true`, `accepted=1`, `plannedJobs=2`,
  `temp=24h/90d`;
- prints finais:
  - `/tmp/nuoma-full-audit/menu-matrix/current/desktop-01-v24-login.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/desktop-02-v28-dashboard.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/desktop-03-v29-inbox.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/desktop-04-v27-contacts.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/desktop-05-v210-campaigns-remarketing.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/desktop-06-v210-automations.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/desktop-07-v210-chatbots.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/desktop-08-v25-jobs.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/desktop-08b-v211-operations.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/desktop-09-v2-implementation.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/desktop-10-m37-evidence-center.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/desktop-11-v28-settings.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/desktop-12-v28-components.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/mobile-01-v24-login.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/mobile-02-v28-dashboard.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/mobile-03-v29-inbox.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/mobile-04-v27-contacts.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/mobile-05-v210-campaigns-remarketing.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/mobile-06-v210-automations.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/mobile-07-v210-chatbots.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/mobile-08-v25-jobs.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/mobile-08b-v211-operations.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/mobile-09-v2-implementation.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/mobile-10-m37-evidence-center.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/mobile-11-v28-settings.png`;
  - `/tmp/nuoma-full-audit/menu-matrix/current/mobile-12-v28-components.png`.

Correcoes aplicadas para fechar a matriz:

- `tests/v2-screen-smoke-matrix.mjs` agora gera desktop e mobile fora do repo,
  usa `dashboard-operational-metrics`, captura erros visiveis de app, valida
  a11y por rota e faz carregamento real de cada rota para evitar falso positivo
  de `axe` com CSS variables apos navegacao artificial por `history.pushState`.
- `apps/web/src/pages/SettingsPage.tsx` ganhou `data-testid="settings-page"`
  para marcador estavel no mobile.
- `apps/web/src/inbox/MessageTimeline.tsx` e `apps/web/src/pages/JobsPage.tsx`
  receberam foco/label em regioes rolaveis.
- Contraste ajustado em `apps/web/src/features/automations/AutomationsScreen.tsx`,
  `apps/web/src/styles/pages/compat-workspaces.css` e
  `apps/web/src/styles/tokens.css`.

### Bugs encontrados e corrigidos nesta rodada

- `send_document` podia falhar em WhatsApp Business quando o menu visual nao
  expunha input de documento. Correcao em
  `apps/worker/src/sync/cdp.ts`: tentativa primario via API interna do
  WhatsApp para documento, mantendo fluxo visual como fallback e melhorando
  deteccao de preview.
- A auditoria de campanha classificava telefone numerico em
  `recipientNormalizedValue` como Instagram e gravava `targetKey=ig:<phone>`.
  Correcao em `apps/worker/src/job-handlers.ts`: telefone normalizado tem
  precedencia e agora gera `targetKey=wa:<phone>`.
- A captura do app mirava a aba de disparo e nao provava o resultado real.
  Correcao em `tests/v2-full-campaign-real-media-smoke.mjs`: captura agora usa
  `campaigns?tab=recipients` e exige campanha, eventos, OK e falhas antes do
  print.

Validacoes executadas depois das correcoes:

- `node --check tests/v2-full-campaign-real-media-smoke.mjs`;
- `npm run format:check -- --ignore-unknown tests/v2-full-campaign-real-media-smoke.mjs docs/maintenance/FULL_REAL_AUDIT_STATUS.md package.json apps/worker/src/sync/cdp.ts apps/worker/src/job-handlers.ts`;
- `npm run typecheck --workspace @nuoma/worker`;
- `npm run test --workspace @nuoma/worker -- src/job-loop.test.ts -t "campaign document"`;
- `CAMPAIGN_REAL_MEDIA_SEND=SIM CAMPAIGN_REAL_MEDIA_PROOF_CAMPAIGN_ID=250 ... npm run test:v2-full-campaign-real-media`.

## Automacao, Chatbot, Overlay e Sync

### Automacao

Comando executado:

```bash
APP_SCREENSHOT_PATH=/tmp/nuoma-full-audit/automation/v29-automation-trigger-app.png \
WPP_SCREENSHOT_PATH=/tmp/nuoma-full-audit/automation/v29-automation-trigger-wpp.png \
npm run test:v29-automation-trigger
```

Resultado:

- `conversation=32472`;
- `options=1`;
- `blocking=0`;
- dispatch real permaneceu bloqueado para telefone nao allowlistado;
- preview dry-run retornou que criaria Job sem criar envio real;
- prints:
  - `/tmp/nuoma-full-audit/automation/v29-automation-trigger-app.png`;
  - `/tmp/nuoma-full-audit/automation/v29-automation-trigger-wpp.png`.
- reexecucao depois dos gatilhos por evento:
  - `/tmp/nuoma-full-audit/automation/v29-automation-trigger-app-after-events.png`;
  - `/tmp/nuoma-full-audit/automation/v29-automation-trigger-wpp-after-events.png`.

Correcao aplicada:

- Ajuste de contraste no resultado do popover em
  `apps/web/src/inbox/ContactSidebar.tsx`. O texto `simulacao/elegivel`
  passou de `text-fg-dim` para `text-fg-muted`, resolvendo
  `color-contrast:serious` do Axe.

Correcao de produto aplicada:

- `apps/api/src/services/automation-event-dispatcher.ts` criado como
  dispatcher de eventos de dominio para automacoes.
- `apps/api/src/services/automation-engine-daemon.ts` agora processa
  `system_events` de `contact.tag_applied`, `contact.tag_removed` e
  `campaign.recipient_completed`, alem do cursor de mensagens inbound.
- `apps/api/src/trpc/routers/contacts.ts`,
  `apps/api/src/services/overlay-quick-actions.ts` e
  `apps/api/src/services/campaign-scheduler.ts` emitem eventos reais quando
  tags mudam ou recipient de campanha conclui.
- `apps/api/src/services/automation-engine-daemon.test.ts` agora tem 9 testes,
  cobrindo `message_received`, `tag_applied`, `tag_removed`,
  `campaign_completed` e `chatbot_reply` inbound.

Validacoes:

- `npm run test --workspace @nuoma/api -- src/services/automation-engine-daemon.test.ts`;
- `APP_SCREENSHOT_PATH=/tmp/nuoma-full-audit/automation/v29-automation-trigger-app-after-events.png WPP_SCREENSHOT_PATH=/tmp/nuoma-full-audit/automation/v29-automation-trigger-wpp-after-events.png npm run test:v29-automation-trigger`;
- `npm run test --workspace @nuoma/api -- src/services/campaign-scheduler.test.ts -t "completed|recipient"`;
- `npm run test --workspace @nuoma/api -- src/services/overlay-quick-actions.test.ts src/services/overlay-services.test.ts`.

### Chatbot

Comandos executados:

```bash
npm run test:chatbot-dry-run-validation

APP_SCREENSHOT_PATH=/tmp/nuoma-full-audit/chatbot/v210-chatbot-ab-rules-app.png \
WPP_SCREENSHOT_PATH=/tmp/nuoma-full-audit/chatbot/v210-chatbot-ab-rules-wpp.png \
npm run test:v210-chatbot-ab-rules
```

Resultado:

- `chatbot=40`;
- `rule=73`;
- `variants=2`;
- `selected=controle`;
- `sendJobsDelta=0`;
- `blocking=0`;
- `IG nao aplicavel`;
- prints:
  - `/tmp/nuoma-full-audit/chatbot/v210-chatbot-ab-rules-app.png`;
  - `/tmp/nuoma-full-audit/chatbot/v210-chatbot-ab-rules-wpp.png`;
  - `/tmp/nuoma-full-audit/chatbot/chatbots-after-batch-fix.png`.
- reexecucao depois do produtor inbound:
  - `/tmp/nuoma-full-audit/chatbot/v210-chatbot-ab-rules-app-after-inbound.png`;
  - `/tmp/nuoma-full-audit/chatbot/v210-chatbot-ab-rules-wpp-after-inbound.png`.

Correcoes aplicadas:

- `tests/v210-chatbot-ab-rules-smoke.mjs` agora preenche explicitamente o
  telefone canario, a mensagem de teste e seleciona o chatbot fixture. Isso
  preserva a decisao de produto de nao manter default pessoal no campo.
- `apps/web/src/lib/trpc-provider.tsx` passou a usar `splitLink`: chamadas
  `chatbots.listRules` e `chatbots.summarizeVariantEvents` usam `httpLink`
  sem batch, enquanto o restante continua em `httpBatchLink` com `maxItems=4`.
  A rota Fastify/tRPC falhava com batch contendo procedimentos repetidos e a UI
  exibia `Algo deu errado / Unable to transform response from server` nos cards.

Correcao de produto aplicada:

- `apps/api/src/services/chatbot-trigger.ts` criado para avaliar chatbots ativos
  em mensagens inbound e enfileirar `chatbot_reply` real para acoes `send_step`
  de `text` e `link`.
- `apps/api/src/services/automation-engine-daemon.ts` chama esse produtor para
  cada inbound processado; o dry-run da UI permanece sem enqueue.
- Idempotencia usa `idempotencyKey({ kind: "chatbot_reply" })` e `dedupeKey`
  para nao duplicar jobs do mesmo inbound/regra/acao.

Validacoes:

- `npm run test --workspace @nuoma/api -- src/services/automation-engine-daemon.test.ts -t "chatbot_reply"`;
- `npm run test --workspace @nuoma/worker -- src/job-loop.test.ts -t "chatbot_reply"`;
- `npm run test:chatbot-dry-run-validation`;
- `APP_SCREENSHOT_PATH=/tmp/nuoma-full-audit/chatbot/v210-chatbot-ab-rules-app-after-inbound.png WPP_SCREENSHOT_PATH=/tmp/nuoma-full-audit/chatbot/v210-chatbot-ab-rules-wpp-after-inbound.png npm run test:v210-chatbot-ab-rules`.

### Overlay e Sync

Comando executado:

```bash
FIXTURE_SCREENSHOT_PATH=/tmp/nuoma-full-audit/overlay/v211-overlay-fab-fixture.png \
WPP_SCREENSHOT_PATH=/tmp/nuoma-full-audit/overlay/v211-overlay-fab-wpp.png \
FIXTURE_STATE_SCREENSHOT_PATH=/tmp/nuoma-full-audit/overlay/v211-overlay-panel-states-fixture.png \
WPP_STATE_SCREENSHOT_PATH=/tmp/nuoma-full-audit/overlay/v211-overlay-panel-states-wpp.png \
npm run test:v211-overlay-suite
```

Resultado:

- `test:v211-overlay-unit`: 37 testes passaram;
- `test:v211-overlay-contracts`: 5 testes passaram;
- `v211-overlay-fab`: `wppMounted=1`, `wppPhone=5531982066263`,
  `sendJobsDelta=0`;
- `v211-overlay-panel`: `wppPanel=1`, `wppSections=9`, `summary=1`,
  `automations=1`, `notes=1`, `sendJobsDelta=0`;
- `v211-overlay-phone`: `wppSource=wa-jid`, `wppPanel=1`, `sendJobsDelta=0`;
- `v211-overlay-api`: `wppApi=online`, `wppMethod=contactSummary`,
  `wppMode=worker-cdp-binding`, `sendJobsDelta=0`;
- `v211-overlay-campaign-data`: `status=ok`, `overlayEnabled=1`,
  `runnable=1`, `options=1`, `eligible=1`;
- prints:
  - `/tmp/nuoma-full-audit/overlay/v211-overlay-fab-wpp.png`;
  - `/tmp/nuoma-full-audit/overlay/v211-overlay-panel-states-wpp.png`;
  - `/tmp/nuoma-full-audit/overlay/v211-overlay-fab-fixture.png`.

Comandos seguros adicionais:

```bash
npm run test --workspace @nuoma/web -- src/automations/manual-trigger-validation.test.ts src/features/flow-builder/config/registries.test.ts src/features/flow-builder/canvas/graph.test.ts src/features/flow-builder/preview/simulate.test.ts src/flow-builder/lib/build-steps.test.ts src/flow-builder/lib/validation.test.ts

npm run test --workspace @nuoma/api -- src/services/automation-engine-daemon.test.ts src/services/overlay-services.test.ts src/services/overlay-quick-actions.test.ts

npm run test:v216-instagram-sync

npx tsx scripts/verify-sync.ts
```

Resultados:

- Web: 6 arquivos, 29 testes passaram;
- API: `automation-engine-daemon.test.ts` passou com 9 testes; overlay quick
  actions/services e scheduler recipients tambem passaram;
- Instagram sync fixture: `v216-instagram-sync|session=connected|username=gabriell_braga|job=1|threadLimit=2`;
- WhatsApp sync verification: `npx tsx scripts/verify-sync.ts` passou em
  2026-06-12 03:47 -03, listando 200 conversas, 57 com mensagens, 0
  placeholders;
- `scripts/verify-sync.ts` foi atualizado para a schema V2 (`last_preview`,
  `raw_json`) e executou com sucesso contra `data/nuoma-v2.db`.

Provas e lacunas reais:

- Prova live read-only de Instagram Direct foi feita via CDP na sessao logada
  do Chrome for Testing, sem envio:
  `/tmp/nuoma-full-audit/instagram-live-readonly/instagram-direct-readonly.png`.
  A tela abriu `https://www.instagram.com/direct/t/110051807055981/`, titulo
  `(1) Instagram • Mensagens`, sem login wall e com sinais de conta/conversa
  (`studionuoma`, `Gabriel`, `gabriell_braga`).
- Existem `20` jobs `campaign_step` Instagram futuros (`2099-01-01`) ligados a
  campanha `200`; nao devem ser processados nesta auditoria.
- `tests/v211-overlay-campaign-data-smoke.ts` agora semeia fixture segura
  `overlayEnabled` quando necessario e termina `status=ok`, sem dispatch.

## Achados Que Nao Podem Ser Esquecidos

- Existem `campaign_step` antigos `queued` no banco local, agendados para
  `2099-01-01`, ligados a campanha Instagram antiga. Eles nao devem ser enviados
  por esta rodada.
- Existe recipient `queued` antigo para o telefone canario em campanha de smoke.
  O novo smoke detecta esse bloqueio e so cancela automaticamente se
  `CAMPAIGN_REAL_MEDIA_CANCEL_STALE_SMOKE=SIM` estiver definido.
- Chatbot tem produtor V2 confirmado para `inbound -> regra ativa -> enqueue
chatbot_reply` e worker confirmado como consumer.
- Automacao tem daemon real confirmado para `message_received`, `tag_applied`,
  `tag_removed` e `campaign_completed`.
- Instagram live/read-only e a matriz menu-a-menu foram fechados nesta rodada
  com prints fora do repo em `/tmp/nuoma-full-audit`.

## Validacao Final Repo-Wide

Rodada final executada em 2026-06-12 03:47-03:50 -03:

- `npm run lint`: passou, 10 tarefas;
- `npm run typecheck`: passou, 21 tarefas;
- `npm test`: passou, 17 tarefas, incluindo API, web, worker, DB, contracts e
  companions;
- `npm run build`: passou, 14 tarefas. Observacao: Safari Companion continua
  com `blocked_converter_unavailable`, mas o script aceita esse estado com
  `--allow-missing-converter` e a build repo-wide terminou com sucesso;
- `npm run build --workspace @nuoma/web`: passou;
- `npm run test --workspace @nuoma/api`: passou, 11 arquivos e 58 testes;
- matriz visual final: `v2-screen-smoke|items=26`, relatorio
  `/tmp/nuoma-full-audit/menu-matrix/current/REPORT.md`, sem `wait_warn`,
  `a11y_warn` ou erro visivel;
- campanha multimidia proof-only: passou sem novo envio real;
- overlay suite: passou com `v211-overlay-campaign-data ... status=ok`;
- sync: `test:v216-instagram-sync` passou e `verify-sync.ts` passou com 200
  conversas, 57 com mensagens e 0 placeholders.
