# V2 — Spikes técnicos (Fase 0 de Prova)

Documento operacional para validar as 4 hipóteses críticas do V2 **antes** de criar o repo `nuoma-wpp-v2/` ou comprometer com stack/arquitetura.

Cada spike tem: **objetivo**, **critério de aceitação**, **escopo (o que faz)**, **fora de escopo (o que não faz)**, **artefato esperado**, **tempo limite (timebox)**, **decisão pós-spike**.

Skills relacionadas (a criar): [`wa-cdp-sync-spike`](../../.claude/skills/wa-cdp-sync-spike.md), [`wa-voice-regression`](../../.claude/skills/wa-voice-regression.md), [`v1-to-v2-migration-dryrun`](../../.claude/skills/v1-to-v2-migration-dryrun.md).

---

## Spike 1 — CDP observer captura mensagem real <3s

### Objetivo

Provar que dá pra detectar uma mensagem chegando no WhatsApp Web e gravá-la em DB em **<3 segundos**, usando MutationObserver injetado via CDP, com `data-id` do bubble como dedup canônico.

### Critério de aceitação

- 50 mensagens reais (5 lotes de 10, em 5 conversas diferentes, ao longo de 30 minutos) detectadas e gravadas.
- **Latência p50 < 1s, p95 < 3s** medida como `db.created_at - dom.timestamp`.
- **Zero duplicatas** (cada `data-id` aparece 1× em `messages`).
- **Zero perdas** confirmadas via comparação manual com a tela do WhatsApp.
- Funciona com msgs de texto, imagem, áudio, encaminhada, editada.

### Escopo

- Branch experimental do V1 OU playground em `experiments/spike-1-cdp-observer/`.
- Conecta CDP ao `127.0.0.1:9222` (já exposto pelo Playwright do V1).
- Injeta script via `Page.addScriptToEvaluateOnNewDocument` que:
  - Registra `MutationObserver` em `#main` e `#pane-side`.
  - Para cada bubble novo, lê `data-id`, `data-pre-plain-text`, `direction`, body inner.
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
