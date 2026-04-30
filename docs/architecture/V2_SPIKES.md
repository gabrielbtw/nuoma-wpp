# V2 — Spikes técnicos (Fase 0 de Prova)

Documento operacional para validar as 4 hipóteses críticas do V2 **antes** de criar o repo `nuoma-wpp-v2/` ou comprometer com stack/arquitetura.

Cada spike tem: **objetivo**, **critério de aceitação**, **escopo (o que faz)**, **fora de escopo (o que não faz)**, **artefato esperado**, **tempo limite (timebox)**, **decisão pós-spike**.

Skills relacionadas (a criar): [`wa-cdp-sync-spike`](../../.claude/skills/wa-cdp-sync-spike.md), [`wa-voice-regression`](../../.claude/skills/wa-voice-regression.md), [`v1-to-v2-migration-dryrun`](../../.claude/skills/v1-to-v2-migration-dryrun.md).

---

## Spike 1 — CDP observer captura mensagem real <3s

### Objetivo

Provar que dá pra detectar uma mensagem chegando no WhatsApp Web e gravá-la em DB em **<3 segundos**, usando MutationObserver injetado via CDP, com `data-id` do bubble como dedup canônico.

### Ajuste após rodada parcial de 2026-04-30

A primeira rodada capturou eventos reais com baixa latência, mas só 4 `message-added` de 50 esperadas. Antes de repetir a rodada completa, o harness deve:

- capturar snapshot inicial dos bubbles visíveis após abrir a conversa;
- reanexar observers quando o WhatsApp substituir `#main`;
- manter captura passiva global;
- usar `5531982066263` apenas como alvo permitido para envio ativo de teste;
- melhorar extração de `body`, `direction`, chat id e timestamp completo (`data`, `hora`, `minuto`, `segundo`) a partir do DOM e `data-id`;
- separar métricas de mensagens novas, snapshot inicial e eventos de sidebar.

Correção arquitetural obrigatória: `unread`/badge é apenas sinal de prioridade, nunca sinal de completude. O WhatsApp pode marcar a conversa como lida em outro aparelho antes do worker sincronizar. O spike só pode ficar verde se o harness provar um reconcile independente de unread:

- cada conversa aberta emite snapshot dos bubbles visíveis e compara com o SQLite temporário;
- quando todos os bubbles visíveis já existem, o harness tenta uma janela de backfill anterior;
- mudanças no `#pane-side` são tratadas por fingerprint (`title`, preview, horário, unreadCount), não apenas por badge;
- o relatório separa perdas reais de mensagens ainda não visitadas por limite de orçamento.
- timestamp completo é requisito: se `data-pre-plain-text` trouxer só precisão de minuto, o relatório deve ficar amarelo e apontar fallback por detalhes da mensagem para capturar segundo.

### Resultado G.1b em 2026-04-30

Rodada com `TARGET_PHONE=5531982066263` capturou 54 mensagens para 50 esperadas, com p50 3ms, p95 17ms, max 26ms, 0 duplicatas e 0 erros de observer. Isso aprova o motor de evento CDP para latência/cobertura.

G.1d foi executado em seguida e corrigiu o bloqueio de metadados: rodada curta com mensagens novas em `5531982066263` capturou 31/30 `message-added`, p50 178ms, p95 201ms, 0 duplicatas, 0 erros, `unknown direction 0/31`, `missing date 0/31`, `missing time 0/31`. Snapshots visíveis também ficaram em `unknown direction 0/32`, `missing date 0/32`, `missing time 0/32`.

Rodada canônica final G.1e em 2026-04-30, com observer corrigido: 62/50 `message-added`, p50 1ms, p95 4ms, max 15ms, 0 duplicatas, 0 erros, `unknown direction 0/62`, `missing date 0/62`, `missing time 0/62`, snapshots `unknown direction 0/55`, `missing date 0/55`, `missing time 0/55`. Probe de detalhes no mesmo DB confirmou 0 segundos expostos, então aplica ADR 0012. Decisão: Spike 1 aprovado para ADR 0007/V2.6.

### G.1c — Probe de detalhes da mensagem

Antes da rodada verde de 50 mensagens, executar um probe no WhatsApp real que abre dados/detalhes de uma mensagem visível e registra o texto exposto pelo menu/painel. Objetivo: confirmar se o WhatsApp Web expõe `hora:minuto:segundo`.

- Se detalhes expuserem segundos: implementar fallback automático para mensagens sem `messageSecond`.
- Se detalhes não expuserem segundos: registrar ADR com limite técnico e salvar `wa_display_time` com precisão de minuto + `observed_at_utc` com segundo real de captura.
- O probe não deve enviar mensagens nem alterar configurações do chat.

Resultado em 2026-04-30: detalhes reais da mensagem no WhatsApp Web Business (`Dados da mensagem`, `[data-testid="drawer-right"]`) não expuseram segundos. Ver ADR 0012. A rodada verde de G.1 deve exigir `data` + `hora:minuto` do WhatsApp com precisão declarada, `observed_at_utc` com segundos/milissegundos e segundo sintético de timeline (`wa_inferred_second`) quando houver múltiplas mensagens no mesmo minuto; `messageSecond` só é preenchido se o WhatsApp passar a expor esse dado.

### Critério de aceitação

- 50 mensagens reais (5 lotes de 10, em 5 conversas diferentes, ao longo de 30 minutos) detectadas e gravadas.
- **Latência p50 < 1s, p95 < 3s** medida como `db.created_at - dom.timestamp`.
- **Zero duplicatas** (cada `data-id` aparece 1× em `messages`).
- **Zero perdas** confirmadas via comparação manual com a tela do WhatsApp.
- Funciona com msgs de texto, imagem, áudio, encaminhada, editada.
- Para cada mensagem capturada, registra `data`, `hora`, `minuto`, `timestamp_precision`, `observed_at_utc` com segundo/milissegundo e, quando a precisão do WhatsApp for minuto, `wa_inferred_second`/ordem intra-minuto para timeline. `messageSecond` é preenchido apenas quando o WhatsApp expõe segundo real; no WhatsApp Web Business testado em 2026-04-30, a precisão exibida foi de minuto.

### Escopo

- Branch experimental do V1 OU playground em `experiments/spike-1-cdp-observer/`.
- Conecta CDP ao `127.0.0.1:9222` (já exposto pelo Playwright do V1).
- Injeta script via `Page.addScriptToEvaluateOnNewDocument` que:
  - Registra `MutationObserver` em `#main` e `#pane-side`.
  - Para cada bubble novo, lê `data-id`, `data-pre-plain-text`, timestamp completo, `direction`, body inner.
  - Pusha via `window.__nuomaSync(payload)` que vira `Runtime.bindingCalled`.
- Node side recebe binding, chama um handler que:
  - Faz `INSERT OR IGNORE` num SQLite temporário (não toca DB do V1).
  - Loga `event.timestamp` e `db.inserted_at` em jsonl.
- Script de medição agrega o jsonl e calcula p50/p95.

### Fora de escopo

- NÃO mexe no DB do V1.
- NÃO desliga o sync polling existente.
- NÃO reescreve worker.
- NÃO tenta cobrir reactions, polls, location messages.

### Artefato esperado

- Script `experiments/spike-1-cdp-observer/run.ts`.
- Arquivo `experiments/spike-1-cdp-observer/metrics.jsonl`.
- Relatório curto em `experiments/spike-1-cdp-observer/REPORT.md` com p50/p95/duplicatas/perdas.

### Timebox

**3 dias úteis**.

### Decisão pós-spike

- ✅ **Verde** (p50<1s e p95<3s e zero duplicatas/perdas em 50 msgs): aprova ADR 0007 e libera item V2.6.x do roadmap.
- ⚠️ **Amarelo** (latência ok mas com 1-2 perdas/duplicatas): investiga edge cases, retest. Não bloqueia mas requer fix antes de avançar.
- ❌ **Vermelho** (latência inaceitável OU >5% perda): recua. Mantém V1 polling. Re-avalia em 3-6 meses ou explora alternativa (WebSocket interno do WPP, Baileys).

---

## Spike 2 — Page.startScreencast renderiza WhatsApp remoto com latência aceitável

### Objetivo

Provar que dá pra streamar o Chromium do worker pra um navegador remoto via CDP `Page.startScreencast` + WebSocket relay + canvas, com latência **<300ms** em rede doméstica e bandwidth razoável (<3 Mbps média).

### Resultado G.2a em 2026-04-30

Harness criado em `experiments/spike-2-screencast/`:

- `server.ts`: HTTP + WebSocket relay conectado ao CDP;
- `client.html`: canvas render + mouse/wheel/keyboard forwarding;
- modo `start:launch` sobe Chromium persistente com perfil WhatsApp e CDP `9234`.

Validação local:

- frame bruto do WhatsApp Business Web capturado via WebSocket: 1470x707, ~51KB;
- input back funcionou via `Input.dispatchMouseEvent` e abriu conversa clicada no WhatsApp; nenhuma mensagem foi enviada;
- latência click→frame após `Page.bringToFront` + ACK não-bloqueante: 183ms e 137ms;
- bandwidth passiva 10s: 1,88 Mbps;
- estabilidade 600,02s: 1.601 frames, 172.610.955 bytes, média 2,30 Mbps, 0 closes, 0 errors.

Decisão: G.2 aprovado localmente para ADR 0007/V2.12. Antes de prometer UX hosted final, repetir entre Mac e host remoto real.

### Critério de aceitação

- WhatsApp Web rodando no Chromium do worker (Lightsail OU local).
- Frontend canvas renderizando o screencast em outro navegador (no Mac do owner).
- **Latência click→render <300ms** (medida com cronômetro visual: clicar, ver mudança).
- **Bandwidth média <3 Mbps** durante uso normal (medido via `chrome://net-export` ou Wireshark).
- Input back: clicar no canvas remoto abre conversa correta no Chromium.
- Screencast estável por 10 minutos sem reconnect espontâneo.

### Escopo

- Backend mínimo (Hono OU Fastify): WebSocket endpoint `/ws/screencast`.
- Conecta CDP ao Chromium do worker, ativa `Page.startScreencast` (JPEG q=80, max 1280×720, 30fps).
- Cada `Page.screencastFrame` event → encode base64 → envia ao client via WS.
- Client `<canvas>` renderiza frames em rAF.
- Captura mouse/keyboard do canvas, envia eventos por WS, backend traduz pra `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`.

### Fora de escopo

- NÃO inclui auth (assume rede confiável durante spike).
- NÃO inclui Liquid Glass wrapper.
- NÃO inclui mobile/touch.
- NÃO inclui multi-touch.
- NÃO trata reconnect com backoff (só identifica se cai ou não).

### Artefato esperado

- `experiments/spike-2-screencast/server.ts` (WS relay).
- `experiments/spike-2-screencast/client.html` (canvas + input capture).
- `experiments/spike-2-screencast/REPORT.md` com latência medida, screenshots, bandwidth.

### Timebox

**3 dias úteis**.

### Decisão pós-spike

- ✅ **Verde** (<300ms, bandwidth ok, estável 10min): aprova ADR 0007 (parte do streaming) e libera V2.12 do roadmap.
- ⚠️ **Amarelo** (latência 300-500ms): aceita pra V1 do produto remoto, planeja otimização (WebRTC) numa fase posterior.
- ❌ **Vermelho** (>500ms ou bandwidth >5 Mbps): recua pra noVNC como alternativa OU mantém WPP só local sem hosted V2.

---

## Spike 3 — Áudio do V1 portado literal funciona em ambiente V2 (IC-1)

### Objetivo

Garantir que a implementação de **voice recording** do V1 (Web Audio API injection + ffprobe + WAV 48kHz mono 16-bit) funciona em ambiente V2 (Node 22 + Playwright atualizado + Drizzle + ffprobe binário em container Docker), entregando voice nativa no WhatsApp.

### Resultado G.3a em 2026-04-30

Harness criado em `experiments/spike-3-voice/` com geração determinística de WAVs de 3s, 30s e 120s, snapshots `.bin`, metadados `.json`, `Dockerfile` e modo de envio real travado para o alvo permitido `5531982066263`.

Dry-run local passou: os 3 payloads foram validados como WAV PCM 48kHz mono 16-bit, com `ffprobe` retornando erro de 0.000ms para 3s, 30s e 120s. `npm run typecheck` também passou. Status do Spike 3 permanece **AMARELO** até executar o E2E real no WhatsApp e validar Docker/Xvfb.

### Resultado G.3b/G.3c em 2026-04-30

E2E local real executado com `TARGET_PHONE=5531982066263 npm run send`: 3s, 30s e 120s entregues com `delivered=true`, evidência de voice nativo e duração exibida de 3s/30s/120s (`displayErrorMs=0`). A primeira tentativa havia provado voice nativo, mas inflou a duração por herdar o wait `duração + 2s`; o harness foi calibrado para parar perto da duração real.

Docker validado para o pipeline seco: `docker build -t nuoma-spike-3-voice .` e `docker run --rm nuoma-spike-3-voice` passaram com Node 22, Playwright image, Chromium, Xvfb e `ffprobe`. Para marcar o Spike 3 como verde hosted absoluto, ainda falta executar o `--send` dentro de container com um perfil WhatsApp autenticado.

### Critério de aceitação

- Áudio de 3s, 30s, 2min enviados via spike → todos chegam no WhatsApp como **voice message nativo** (não anexo de áudio com ícone de arquivo).
- Duração exibida no WhatsApp bate com duração real (erro <50ms, validado com ffprobe externo).
- **Snapshot do payload final** (header WAV + sample rate + bit depth) bate byte-a-byte com o do V1.
- Funciona dentro de container Docker com Xvfb (simulação de produção).

### Escopo

- Branch experimental OU `experiments/spike-3-voice/`.
- Reutiliza diretamente o código de `apps/wa-worker/src/worker.ts:1474+` do V1 (cópia literal).
- Empacota em container Docker mínimo: Node 22 + Playwright + Chromium + Xvfb + ffprobe.
- Script `run-voice-test.ts` envia 3 áudios de durações diferentes pra um número de teste.
- Captura payload via inspect do `MediaSource` durante o envio.

### Fora de escopo

- NÃO migra pra Bun (V2 vai usar Node 22 mesmo).
- NÃO refatora a função (port literal).
- NÃO tenta otimizar; se funciona, está bom.

### Artefato esperado

- `experiments/spike-3-voice/Dockerfile`.
- `experiments/spike-3-voice/run-voice-test.ts`.
- `experiments/spike-3-voice/payloads/` (3 snapshots `.bin`).
- `experiments/spike-3-voice/REPORT.md`.

### Timebox

**2 dias úteis**.

### Decisão pós-spike

- ✅ **Verde** (3 áudios entregues como voice nativa, snapshots iguais): aprova ADR 0010 e item V2.5.21.
- ⚠️ **Amarelo** (entrega como anexo OU duração errada por <100ms): investiga edge case do container, possivelmente issue no ffprobe binário.
- ❌ **Vermelho** (não funciona em container ou diverge significativamente do V1): **bloqueador absoluto** para V2 hosted. Recua pra "V2 só local" ou re-avalia stack.

---

## Spike 4 — Migration dryrun lê SQLite V1 e mapeia tabelas corretamente

### Objetivo

Provar que dá pra ler o SQLite atual do V1 e gerar um mapa válido das entidades pra um schema V2 candidato (Drizzle), com contagens batendo e sem perda de FK.

### Resultado G.4a em 2026-04-30

Harness criado em `experiments/spike-4-migration/` com:

- snapshot SQLite via API de backup (`sqlite-backup`) sem tocar o DB V1;
- inspeção de tabelas operacionais, samples redigidos, validação de tipos e JSON;
- schema Drizzle candidato em `schema-v2-candidate.ts`;
- dry-run que percorre todas as linhas e simula política de import sem gravar.

Resultado contra `/Users/gabrielbraga/Projetos/nuoma-wpp/storage/database/nuoma.db`: 488.511 linhas escaneadas em 2.257ms, 422.963 importáveis, 65.548 puladas por regra, 0 JSON inválidos, nenhuma tabela obrigatória ausente, schema Drizzle compilando com `npm run typecheck`.

Status atualizado após decisão do owner: **VERDE com política aceita**. Há 334.158 orphans brutos, incluindo 40.786 em tabelas operacionais dependentes de contatos apagados (`contact_tags`, `contact_channels`, `contact_history`, `automation_*`), mas a política final é pular dependentes órfãos no import operacional, preservar `campaign_recipients` por telefone com `contact_id=NULL`, manter `contacts.phone` nullable porque contatos futuros podem existir só por Instagram, manter `messages.external_id` nullable e preservar `audit_logs` sem FK forte ou com FK nula. A etapa de estabilização V2 deve rodar resync geral para reconstruir estado operacional recente após o import.

### Critério de aceitação

- Script lê `~/Projetos/nuoma-wpp/storage/database/nuoma.db` em modo read-only (cópia).
- Para cada tabela operacional (contacts, conversations, messages, jobs, campaigns, automations, tags, contact_tags, attendants, chatbots, chatbot_rules, media_assets, audit_logs), reporta:
  - Contagem de linhas.
  - Sample 5 linhas com types validados.
  - FK targets que **não** apontam pra nada (orphans).
- Schema Drizzle proposto compila sem erros.
- Migration dryrun executa em <60s contra DB de teste com volumes reais (~50k contatos esperados como teto).
- Relatório lista campos do V1 que não têm equivalente óbvio no V2 (decisões necessárias).

### Escopo

- Playground `experiments/spike-4-migration/`.
- `read-v1.ts` lê SQLite V1, agrega.
- `schema-v2-candidate.ts` propõe Drizzle schema (mirror das tabelas operacionais; ignora `data_lake_*`).
- `dryrun.ts` lê todas linhas, transforma em estruturas V2, **NÃO grava** em DB real.
- Compara contagens V1 vs transformações V2.
- Reporta orphans (FKs sem target).

### Fora de escopo

- NÃO implementa migração real.
- NÃO toca DB do V1.
- NÃO migra `data_lake_*`, AI tables, ou outros fora do escopo do produto.
- NÃO valida tRPC ou API surface — esse spike é só DB.

### Artefato esperado

- `experiments/spike-4-migration/read-v1.ts`.
- `experiments/spike-4-migration/schema-v2-candidate.ts`.
- `experiments/spike-4-migration/dryrun.ts`.
- `experiments/spike-4-migration/REPORT.md` com contagens, orphans, decisões pendentes.

### Timebox

**2 dias úteis**.

### Decisão pós-spike

- ✅ **Verde** (todas tabelas mapeáveis, <5% orphans aceitáveis, schema Drizzle válido): aprova ADR 0005 (Drizzle) e libera V2.3 do roadmap.
- ⚠️ **Amarelo** (algumas tabelas precisam decisão de UX antes de migrar — ex.: `campaign_executions` legacy com IDs duplicados): documenta decisões pendentes.
- ❌ **Vermelho** (Drizzle não suporta algum padrão crítico ou orphans massivos): recua pra SQL puro com helpers de tipo TypeScript próprios.

---

## Decisão geral pós-4-spikes

| Resultado | Ação |
|---|---|
| 4 verdes | Cria `nuoma-wpp-v2/`, inicia V2.1 Foundations. Aprova ADRs 0002, 0005, 0007, 0010. |
| 3 verdes + 1 amarelo | Avalia o amarelo: se não-bloqueador, segue. Se bloqueador, espera fix antes. |
| 2+ amarelos OU 1 vermelho | **NÃO inicia V2**. Re-avalia em sprint dedicada OU pivota estratégia (mais V1 patches, ou produto outro). |

## Ferramentas reutilizáveis

Os artefatos dos spikes (especialmente Spike 1 observer e Spike 4 dryrun) **viram skills permanentes** depois:

- Spike 1 → skill [`wa-cdp-sync-spike`](../../.claude/skills/wa-cdp-sync-spike.md)
- Spike 3 → skill [`wa-voice-regression`](../../.claude/skills/wa-voice-regression.md)
- Spike 4 → skill [`v1-to-v2-migration-dryrun`](../../.claude/skills/v1-to-v2-migration-dryrun.md)

Não é trabalho jogado fora — é fundação da rede de segurança operacional do produto.
