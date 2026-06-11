# ADR 0007 — Sync Híbrido Playwright + CDP (event-driven) V2

## Status

**Aceita para V2** após Spike 1. Resolve a desconfiança #1 do usuário no V1 (sync com lag e msgs sumindo/duplicando), com observer capturando mensagens reais abaixo do SLA de 3s no spike.

Crítica do owner aceita: "CDP-only é arriscado. Playwright/page objects para navegação e ações onde já é mais estável; CDP para observers, eventos, screencast e captura fina."

## Contexto

V1 sync polling (forward walk + backfill, 15s), fingerprint dedup baseado em `preText | direction | body[0..40]`. Problemas:

- Lag perceptível (~120s em sessão cheia, budget de 180s).
- Falso negativo: msgs com mesmo body em mesmo minuto pulam dedup.
- Falso positivo: pre-text mudando vira duplicata.
- Não detecta msgs editadas, deletadas, reactions.
- Status delivery (sent → delivered → read) por polling 2s × 15.

SLA alvo do user: **<3s** entre msg chegar no WPP e aparecer no Nuoma.

## Decisão (modelo híbrido)

V2 sync usa **Playwright como dono da sessão** + **CDP como camada de eventos/captura**. Não é "CDP toma conta de tudo". É divisão de responsabilidades:

### Playwright continua dono de:

- Launch persistent context (mantém perfil, cookies, sessão WPP).
- Navegação entre conversas (`page.click`, `page.goto`, `page.fill`).
- Ações de envio: clicar input, digitar, anexar mídia via `setInputFiles`.
- Recovery: detectar QR, relaunch browser, fechar modais.
- Page objects estáveis (já existe esse pattern parcial em V1).

### CDP é responsável por:

- **Observer injection** via `Page.addScriptToEvaluateOnNewDocument` em `#main` e `#pane-side`.
- **Push de eventos** via `Runtime.addBinding` + `Runtime.bindingCalled` (`window.__nuomaSync(...)` chama Node).
- **Screencast** (`Page.startScreencast`) pra render remoto no app hospedado.
- **Captura fina** quando precisa (screenshot da área do QR, properties de element).
- **Input dispatch remoto** (`Input.dispatchMouseEvent` / `Input.dispatchKeyEvent`) **apenas no fluxo de stream remoto** — em automação de campanha, continua Playwright API.

### Dedup definitivo

- **`data-id`** interno do bubble (Web Component identifier do WA Web) como external_id canônico.
- UNIQUE constraint composto `messages(conversation_id, external_id)`.
- Fallback ao fingerprint atual (`preText|direction|body[0..40]`) só quando `data-id` não existe (raríssimo).

### Pipelines

1. **Push pipeline** (event loop, ~100-200ms latência): observer → `Runtime.bindingCalled` → handler → `messagesRepo.insertOrIgnore(...)`.
2. **Safety net** (60s, leve): forward walk reduzido só nos chats com unread > 0. **Não é o motor**, é a rede de segurança que valida que o push pipeline não perdeu nada.
3. **Sob demanda**: usuário foca conversa no UI → dispatch `chat-focus(convId)` → worker injeta script que extrai bubbles visíveis daquela conversa imediatamente.

### Eventos capturados

- `message-added`, `message-updated`, `message-removed`
- `conversation-unread-changed`
- `chat-opened`, `chat-closed`
- `delivery-status-changed` (sent → delivered → read via mudança de classe `msg-check` → `-dblcheck` → `-ack`)

### Smart triggers

- Badge mudou no `#pane-side` → push pipeline já tinha capturado; safety net só confirma.
- DOM-WA-changed (locators principais sumiram >30s) → push notification ao admin.

## Consequências

- **Bom**: Latência <3s comprovável **se Spike 1 passar**. Falso pos/neg eliminados via `data-id`. Edge cases (editadas, deletadas, reactions) capturados via `message-updated`/`message-removed` events. Playwright continua sendo o cinto-de-segurança para navegação/ações onde é estável.
- **Risco real**: WA Web pode mudar nomes de classes ou estrutura interna. Mitigações: (1) `data-id` é mais estável que classes; (2) detector `DOM-WA-changed` alerta admin via Web Push; (3) safety net forward walk continua disponível como degradação aceitável.
- **Risco técnico-CDP**: `Page.startScreencast` é marcado como experimental nas docs do CDP. Mitigação: Spike 2 valida latência e estabilidade; se falhar, recua pra noVNC como antes considerado, OU mantém embed só local (sem hosted V2).
- **Custo**: Refactor do worker (page object pattern formal, isolar observer logic, safety net). Estimado em V2 fase 6 (~2 sprints), **gated por Spike 1**.

## Alternativas

- Manter polling otimizado: descartada — não atinge <3s.
- WebSocket interno do WA Web (Service Worker hijacking): descartada — instável, depende de internals que mudam frequente.
- Mocking total via API não-oficial (Baileys, whatsapp-web.js): descartada — Baileys é WebSocket reverse-engineered (alto risco ban), e usuário escolheu manter Web Browser por compliance.

## Referências

- [docs/architecture/V2_SYNC_ENGINE.md](../architecture/V2_SYNC_ENGINE.md) (a ser criado)
- Skill `cdp-event-recorder` em `.claude/skills/`
- Roadmap V2.6 (25 itens)
