# Implementation Plan

Plano operacional curto da V2. Use este arquivo para decidir a proxima acao.
Use `IMPLEMENTATION_STATUS.md` para o painel atual e para os checkboxes que a
tela `/implementation` consome.

## Convencao

- `V2.x` e versao/marco de produto.
- `V2.x.y` e entrega incremental dentro da versao.
- `M<n>` e marco operacional usado para execucao/smoke.
- `M<n>.<m>` e hotfix/subversao quando corrige um gap especifico de um marco
  ja entregue.

## Prioridade Atual

| Ordem | ID | Tipo | Status | Entrega esperada |
| --- | --- | --- | --- | --- |
| 1 | Remarketing em lote real | proximo condicional | liberado apos M30.3 | Rodada em lote com os mesmos guardas de contexto real e allowlist/cutover. |

## V2.1 Foundations Fechado

**Resultado:** fechado 100% em 2026-05-07.

**Escopo consolidado:**

- Monorepo Turborepo com npm workspaces `apps/*` e `packages/*`.
- Apps base: `api`, `web`, `worker`.
- Packages base: `config`, `contracts`, `db`, `ui`.
- TypeScript strict compartilhado em `tsconfig.base.json`.
- Aliases `@nuoma/*` para apps/packages fundamentais.
- ADRs de stack, estrutura, feature folders e SQLite/Drizzle.
- Smoke oficial: `npm run test:v21-foundations`.

**Criterio de aceite cumprido:**

- `npm run test:v21-foundations`.
- `npm run typecheck`.
- `npm run lint`.

## V2.10 Hardening Campanhas/Chatbots Fechado

**Resultado:** fechado 100% em 2026-05-07.

**Escopo consolidado:**

- Auditoria materializada em `campaign_recipients.metadata.auditTrail` para
  enfileiramento, inicio, conclusao, falha, skip e eventos de mensagens
  temporarias.
- `campaigns.list` mescla `system_events` com `auditTrail`, preservando
  timeline auditavel mesmo quando o evento operacional antigo saiu da janela de
  consulta.
- `chatbots.evaluateMessage` persiste execucao por mensagem em
  `system_events` sem criar job e registra exposicao A/B quando houver variante.
- `chatbots.executionHistory` permite consultar historico por chatbot, regra,
  conversa ou mensagem.

**Criterio de aceite cumprido:**

- `npm run test:v210-hardening`.
- `npm run typecheck`.

## V2.11 Overlay WhatsApp Fechado

**Resultado:** fechado 100% em 2026-05-07.

**Escopo consolidado:**

- Overlay Shadow DOM no WhatsApp com FAB, painel e estados reais.
- Detector de conversa resiliente a contato salvo: ignora controles do header
  como `Dados do perfil`, usa titulo real do chat e hidrata telefone por
  conversa/titulo quando o `data-id` do WhatsApp esta opaco.
- Ponte `window.__nuomaApi` via Runtime.addBinding com guardas de mutacao,
  auditoria e reuso seguro em reinjecoes/restarts CDP.
- Smokes reais WhatsApp-only registrando `IG nao_aplicavel` e `sendJobsDelta=0`.

**Criterio de aceite cumprido:**

- `npm run test:v211-overlay-suite`.
- Evidencias: `v211-overlay-phone|wppSource=title-conversation|m=34` e
  `v211-overlay-api|wppMode=worker-cdp-binding|m=35`.

## V2.12 Remote Rendering CDP Fechado

**Resultado:** fechado 100% em 2026-05-07.

**Escopo consolidado:**

- Streaming/screenshot CDP autenticado com sessao curta.
- Dispatch seguro de `click`, `keydown` e texto quando habilitado.
- Smoke forte contra WhatsApp Web real com screenshot local.

**Criterio de aceite cumprido:**

- `npm run test:v212-streaming-cdp`.
- Evidencia:
  `v212-streaming-cdp-strong|target=https://web.whatsapp.com/|click=accepted|keydown=accepted|status=passed`.

## V2.13 Stream Global Fechado

**Resultado:** fechado 100% em 2026-05-07.

**Escopo consolidado:**

- `/api/events` entrega canais `system` e `inbox` em SSE unico.
- Suporte a cursor `sinceSystemEventId`, heartbeat e evento `events-ready`.
- Inbox consome o canal global e invalida/reordena a conversa afetada.

**Criterio de aceite cumprido:**

- `npm run test:v213-global-events`.
- Smoke forte existente para ambiente local completo:
  `npm run test:v213-global-events-strong`.

## V2.14 Operacao Local-First Fechado

**Resultado:** fechado 100% em 2026-05-07.

**Escopo consolidado:**

- `scripts/v214-backup-restore.mjs` com modos `backup`, `verify`,
  `restore-dry-run` e `restore`.
- Backup SQLite via API nativa do `better-sqlite3`.
- Backup opcional do profile Chromium via tarball.
- Validacao `PRAGMA quick_check`, tabelas obrigatorias e ensaio de restore em
  diretorio temporario.
- Restore real exige `V214_CONFIRM_RESTORE=SIM` e cria backup pre-restore.

**Criterio de aceite cumprido:**

- `npm run test:v214-backup-restore`.
- Evidencia:
  `v214-backup-restore-smoke|backup=ok|verify=ok|restore=ok|status=closed`.

## V2.15 Migracao/Cutover Fechado

**Resultado:** implementacao fechada 100% em 2026-05-07; a execucao real do
cutover continua sendo uma acao operacional explicitamente confirmada.

**Escopo consolidado:**

- `scripts/v215-cutover-preflight.mjs` valida DBs V1/V2, schemas minimos,
  target user, jobs ativos, backup V2 e prova M30.3.
- `scripts/v215-cutover-apply.mjs` roda `dry-run` por padrao.
- `apply` exige `V215_CONFIRM_CUTOVER=SIM`, bloqueia V2 com jobs ativos, cria
  backup pre-cutover e importa de forma idempotente tags, contatos,
  contact_tags, midias, conversas, mensagens, campanhas e recipients.
- O apply nao apaga dados V2 existentes e registra `system_events` do cutover.

**Criterio de aceite cumprido:**

- `npm run test:v215-cutover-preflight`.
- `npm run test:v215-cutover-apply`.
- `npm run test:v213-v215-suite`.
- Preflight real local:
  `v215-cutover-preflight|v1Contacts=12958|v1Conversations=1803|v1Messages=3826|v2Contacts=124|v2ActiveJobs=0|blockers=0|warnings=2|status=ready`.
- Dry-run real local:
  `v215-cutover-apply|mode=dry-run|contacts=12958|conversations=1803|messages=3826|campaigns=10|recipients=10|blockers=0|status=ready`.

## M30.3 Hotfix Fechado

**Problema:** a rodada real da automacao Neferpeel BH confirmou inbound recente
no banco, mas nao confirmou/aplicou o contexto real de mensagens temporarias 24h
no WhatsApp Web antes do primeiro step.

**Resultado:** fechado em 2026-05-06. O worker aplica/verifica 24h no WhatsApp
real antes do primeiro step, bloqueia envio se nao provar esse estado, mantem a
aba unica nos steps seguintes e restaura 90d apos conclusao segura.

**Escopo tecnico:**

- Abrir o chat alvo sem criar aba nova e sem refresh por step.
- Confirmar destino/canal antes de qualquer envio.
- Abrir/verificar o menu real de mensagens temporarias do WhatsApp.
- Aplicar 24h quando a automacao exigir esse contexto.
- Capturar evidencia visual/estado antes do primeiro step.
- Executar a sequencia serialmente, com intervalo maximo de 5s entre steps,
  exceto audio longo.
- Restaurar a configuracao final prevista somente depois da conclusao segura.

**Criterio de aceite cumprido:**

- `M303_CONFIRM_NEFERPEEL_REAL=SIM M303_CAMPAIGN_ID=40
  M303_REQUIRED_BEFORE_PROOF_PATH=/Users/gabrielbraga/Projetos/nuoma-wpp-v2/data/m303-neferpeel-before-send-24h-proof-v5.png
  npm run test:m303-neferpeel-temporary-context`.
- Smoke real WhatsApp-only registrou `IG nao_aplicavel`.
- Print fonte de verdade salvo em
  `data/m303-neferpeel-before-send-24h-proof-v5.png`, mostrando o chat
  `Gabriel Braga Nuoma` e o painel real `Mensagens temporarias` com `24 horas`.
- Print fonte de verdade da restauracao salvo em
  `data/m303-neferpeel-after-restore-90d-proof.png`, mostrando o mesmo chat
  com o radio `90 dias` marcado.
- Prova visual completa do fluxo valido salva em
  `data/m303-full-wpp-proof-2026-05-06T21-36-58-297Z/`: `04` mostra
  `24 horas` marcado, `05` mostra o popup 24h apos sair do painel, `09`
  mostra a mensagem enviada as 18:37, `11` mostra `90 dias` marcado e `12`
  mostra o popup novo de 90 dias apos sair do painel.
- Smoke oficial reproduzivel:
  `M303_CONFIRM_WPP_REAL=SIM M303_WPP_PHONE=5531982066263 npm run test:m303-wpp-24-send-90-proof`.
  A rodada oficial versionada em
  `data/m303-wpp-24-send-90-proof-2026-05-07T03-44-55-491Z/` mostra `04`
  radio 24h, `05` popup 24h, `06` envio as 00:45, `08` radio 90d, `09`
  popup 90d e `10` painel reaberto com 90d marcado.
- Eventos reais `sender.temporary_messages.audit`:
  `before_send 24h verified=true` e `after_completion_restore 90d verified=true`.
- O verificador CDP agora aceita `verifiedDuration` somente quando consegue
  associar a opcao marcada (`aria-checked=true` / `checked`) ao label de
  duracao; texto solto no painel nao prova mais restauracao.
- O clique de duracao tambem prioriza o `input`/radio associado ao label; clicar
  apenas no texto da opcao nao e mais considerado suficiente.
- Zero jobs ativos ao final e nenhum completed fora da allowlist.

## Proximos Itens Condicionais

| Ordem | Tema | Condicao para abrir |
| --- | --- | --- |
| 1 | Remarketing em lote real | Somente depois do M30.3 passar em smoke forte. |
| 2 | Instagram/DM | Somente com iniciativa explicita; fora do fluxo cotidiano. |

## Regras De Manutencao

- Nao transformar este plano em diario de execucao.
- Ao fechar um item, mover o resultado resumido para `IMPLEMENTATION_STATUS.md`.
- Se surgir gap durante smoke real, criar `M<n>.<m>` em vez de reabrir uma versao
  inteira.
- Se o gap for de produto amplo, abrir nova `V2.x.y`; se for correcao pontual,
  abrir hotfix `M<n>.<m>`.
