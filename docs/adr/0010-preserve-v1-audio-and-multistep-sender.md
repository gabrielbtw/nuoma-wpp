# ADR 0010 — Preservar áudio (IC-1) e multi-step sender (IC-2) do V1

## Status

Aceita. **Contratos não-negociáveis**.

## Contexto

Usuário declarou explicitamente que dois aspectos do V1 estão "PERFEITOS" e não podem regredir:

1. **Áudio (voice recording)**: implementação atual em [`apps/wa-worker/src/worker.ts:1474+`](../../apps/wa-worker/src/worker.ts) usando Web Audio API injection + ffprobe pra duração + WAV 48kHz mono 16-bit. Resultado: voice messages aparecem no WhatsApp como **voice nativas**, não como anexo de áudio. Resolvida nos commits `25c075c` e `73d4322`.
2. **Multi-step sender**: otimização que evita `goto()`/click no chat entre steps consecutivos do mesmo destinatário. Resolvida no commit `910615f` ("speed up photo send after audio - skip re-navigation").

Ambas são vantagens competitivas operacionais. Reescrever do zero significa risco de regressão.

## Decisão

V2 **porta literal** essas duas implementações:

### IC-1 — Áudio

Item V2.5.21 implementa:

- **Web Audio API injection** via CDP `Page.addScriptToEvaluateOnNewDocument` (substitui o `addInitScript` do Playwright no V1, mas mesmo conceito).
- **Captura PCM** com `AudioContext.createMediaStreamSource`.
- **Encode WAV 48kHz mono 16-bit** antes de injetar no MediaSource.
- **Duração exata via ffprobe** (binário shipped no container Docker).
- Sem `bringToFront()` durante gravação.
- Sem relaunch de browser pra mandar voice.

Tests obrigatórios pra aceitar V2 em produção:

- E2E: enviar áudio de 3s, 30s, 2min — todos com duração correta no WhatsApp.
- Unit: ffprobe retorna duração com erro <50ms vs duração real.
- Regression: snapshot do payload final (header WAV + sample rate + bit depth) bate com V1.

### IC-2 — Multi-step sender

Item V2.5.22 implementa:

- Estado em memória do worker: `currentConversationId`, `lastInteractionAt`.
- Quando próximo job é mesmo `conversationId` E scheduled em <30s: pula `goto()`/click no chat. Vai direto pra digitar texto / anexar mídia.
- Quando muda destinatário: navega pra próxima conversa diretamente (não volta pra home do WhatsApp).
- Re-navega só quando: trocou destinatário + ficou idle >30s.
- Métrica `sender_navigation_skipped_count` exposta em `/system/metrics`.

Item V2.10.11 garante que o Campaign scheduler **enfileira jobs do mesmo recipient com `scheduled_at` próximos** (intra-batch ≤8s) — sem isso, IC-2 não vale nada (sender ficaria idle entre steps).

Tests obrigatórios:

- E2E: campanha com 3 steps (foto + áudio + texto) pro mesmo contato → cronometra tempo total. V2 ≤ V1.
- E2E: campanha com 5 destinatários × 2 steps → naveg sequencial sem re-home.
- Métrica: `sender_navigation_skipped_count` > 0 em campanha multi-step.

## Anti-regressão V1

Itens V1.16 e V1.17 garantem que enquanto V1 e V2 coexistem:

- `CLAUDE.md` do V1 marca pipeline de áudio + skip-navigation com bloco `<critical>` "NÃO MEXER".
- Smoke test mensal manual valida tempo total da campanha multi-step pro contato de teste.

## Consequências

- **Bom**: Garantia de que V2 não regride numa parte que o user valoriza muito.
- **Custo**: Tests E2E adicionais. Estudo do diff dos commits `25c075c`, `73d4322`, `910615f`, `f344094` antes de portar.
- **Bind**: Implementação V2 fica acoplada a Web Audio API + ffprobe binário. Aceitável.

## Referências

- Commits V1: `25c075c`, `73d4322`, `910615f`, `f344094`.
- Roadmap V2.5.21, V2.5.22, V2.10.11–15, V1.16, V1.17.
- Plano: [`/Users/gabrielbraga/.claude/plans/eu-quero-que-voc-cryptic-lobster.md`](../../.claude/plans/eu-quero-que-voc-cryptic-lobster.md)
