# Implementation Status

Fonte operacional curta para `/implementation`. O historico detalhado de
execucoes fica no git; este arquivo deve mostrar apenas estado atual,
pendencias, versoes fechadas e evidencias que ainda importam para decisao.

## Snapshot

- **Linha atual:** V2 standalone em `/Users/gabrielbraga/Projetos/nuoma-wpp-v2`.
- **M principais:** 37 marcadores, de `M0` ate `M36`.
- **M/sub-M conhecidos:** 106 IDs quando contamos `M0.1`, `M35.2`, etc.
- **Pendencia aberta:** nenhuma hotfix corretiva aberta apos o fechamento de
  `M30.3`; remarketing em lote real e cutover seguem como proximos itens
  condicionais.
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
- [x] **M30.3 Contexto real 24h no WhatsApp** — Worker CDP abre/reusa o chat
  correto, aplica/verifica mensagens temporarias 24h antes do primeiro step,
  bloqueia envio quando nao consegue provar o estado, mantem a janela nos steps
  intermediarios e restaura 90d apos conclusao segura com eventos
  `sender.temporary_messages.audit` em `executionMode=whatsapp_real`.

## Parcial

- [~] **V2.7 API surface IG** — `conversations.listUnified` fica parcial porque
  Instagram segue fora do fluxo cotidiano ate iniciativa explicita.

## Falta

- [ ] **Remarketing em lote real** — Proximo item condicional apos M30.3; deve
  reutilizar os guardas reais de contexto temporario, allowlist e auditoria.
- [ ] **Cutover operacional** — Segue condicionado a uma rodada em lote real
  lisa e com evidencias completas.

## Evidencias Recentes

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
  (`aria-checked=true` / `checked`) em vez de aceitar texto solto no painel.
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
