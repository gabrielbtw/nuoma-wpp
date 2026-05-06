# Implementation Status

Fonte operacional curta para `/implementation`. O historico detalhado de
execucoes fica no git; este arquivo deve mostrar apenas estado atual,
pendencias, versoes fechadas e evidencias que ainda importam para decisao.

## Snapshot

- **Linha atual:** V2 standalone em `/Users/gabrielbraga/Projetos/nuoma-wpp-v2`.
- **M principais:** 37 marcadores, de `M0` ate `M36`.
- **M/sub-M conhecidos:** 106 IDs quando contamos `M0.1`, `M35.2`, etc.
- **Pendencia aberta:** 1 hotfix corretivo, `M30.3`.
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

- [x] **V2.1-V2.4 Foundations** — Monorepo, API, web, auth, contratos,
  SQLite/Drizzle e shell autenticado.
- [x] **V2.5 Sender runtime** — Fila duravel, DLQ, envio real WhatsApp de texto,
  voz nativa, documento, imagem, video, album e `campaign_step`, com allowlist,
  auditoria, external id e guardas contra destino errado.
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
  audit timeline, automations/chatbots builders e historico A/B `M28.1`.
- [x] **V2.11 Overlay WhatsApp + smokes reais** — Overlay Shadow DOM/FAB/painel,
  telefone, ponte `window.__nuomaApi`, auditoria, guardas de mutacao, inbound
  real, midia real, reuse de aba unica e `M29`, `M32`-`M36`, `M35.1`, `M35.2`.
- [x] **V2.12 Remote rendering CDP minimo** — Screenshot via CDP, sessao curta e
  dispatch de click/keydown/text quando habilitado.
- [x] **V2.13 Stream global** — `/api/events` com canais `inbox` e `system`,
  cursor/heartbeat e consumo pela Inbox.
- [x] **Remarketing seguro** — Console de disparo com dry-run forte, confirmacao
  textual, guardrails por telefone/status/canal/allowlist/supressao/duplicidade,
  fila serial por telefone e eventos `sender.campaign_step.started|failed|completed`.

## Parcial

- [~] **V2.7 API surface IG** — `conversations.listUnified` fica parcial porque
  Instagram segue fora do fluxo cotidiano ate iniciativa explicita.

## Falta

- [ ] **M30.3 Hotfix: contexto 24h real no WhatsApp antes de automacao** — A
  rodada real da automacao Neferpeel BH validou inbound recente no banco, mas
  nao confirmou nem aplicou o contexto real de mensagens temporarias 24h no
  WhatsApp Web. Corrigir para abrir/verificar o menu do chat no WhatsApp,
  aplicar 24h antes do primeiro step, capturar evidencia visual/estado, manter a
  sequencia sem refresh por step e restaurar a configuracao final prevista
  somente apos conclusao segura.

## Evidencias Recentes

- **2026-05-06 / M30.3 aberto:** batch
  `campaign:40:recipient:298:24h:1778093175183`, jobs `267..271`, completou com
  `navigationMode=reused-open-chat`, audio nativo `37s`, album `4/4`,
  `pageCount=1` e zero jobs ativos, mas nao ficou no contexto real de 24h do
  WhatsApp. Esse ponto bloqueia considerar automacao/remarketing definitivo.
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
