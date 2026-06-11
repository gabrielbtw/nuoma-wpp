# Spike 1 — Report

## Status

G.1b executado. Motor de evento aprovado em latência/cobertura/dedup; extração de `direction` e parte de `date/time` ainda precisa hardening antes de considerar o sync V2 completo como verde.

## Escopo do Teste

Por decisão do owner, o número abaixo é o **único alvo permitido para envio ativo de mensagens de teste**:

- `5531982066263` (`+55 31 9820-6263`)
- Contato/conversa no V1: `Gabriel Braga Nuoma`

A captura passiva continua global: mensagens/eventos vindos de outros números podem ser observados e contabilizados. A restrição é apenas: **não enviar mensagens de teste para outros números**.

O harness pode ser iniciado com `TARGET_PHONE=5531982066263 npm run run` para abrir o chat controlado automaticamente, sem filtrar a captura global.

## Smoke — 2026-04-30

Resultado: **passou**.

- CDP conectado em `127.0.0.1:9222`.
- Target encontrado: `https://web.whatsapp.com/`.
- WhatsApp carregado como `WhatsApp Business`.
- Observer injetado com sucesso.
- `#main`: encontrado.
- `#pane-side`: encontrado.
- `observer-ready`: 502 ms.
- `npm run typecheck`: passou.

Observação operacional: para expor o CDP, o `@nuoma/wa-worker` foi iniciado com limites de sync reduzidos e encerrado em seguida. Mesmo assim, o startup sync normal do V1 rodou uma vez e registrou 29 mensagens no SQLite do V1 antes do encerramento. O harness do spike escreveu apenas em `experiments/spike-1-cdp-observer/spike.db`.

## Full Capture

### Rodada parcial — 2026-04-30

Resultado: **AMARELO**.

Comando de análise:

```bash
npm run analyze -- --expected=50
```

Números:

- `message-added`: 4 / 50 esperadas.
- `message-removed`: 1.
- `delivery-status-changed`: 2.
- `observer errors`: 0.
- duplicatas bloqueadas: 0.
- latência p50: 2 ms.
- latência p95: 2 ms.

Leitura técnica:

- O caminho CDP -> binding -> SQLite está funcionando e com latência excelente.
- O observer capturou `data-id` e eventos reais no DOM.
- A captura ainda não é suficiente para aprovar G.1 porque perdeu parte das mensagens enviadas durante o teste.
- Antes de repetir 50 mensagens, o harness precisa ser endurecido para capturar mensagens visíveis já existentes, reanexar observers quando `#main` trocar e melhorar extração de body/direction.

## Full Capture Final

Executado em 2026-04-30 com `TARGET_PHONE=5531982066263`.

Comando:

```bash
npm run analyze -- --expected=50
```

Resultado:

- `Messages captured`: 54 / 50.
- `Visible snapshots captured`: 1547.
- `Snapshot complete events`: 61.
- `Duplicates blocked`: 0.
- `Observer errors`: 0.
- `message-updated events`: 563.
- `message-removed events`: 618.
- `delivery-status-changed events`: 175.
- `Sidebar row changes`: 44.
- `Unread changes`: 11.
- `Raw observer events`: 3217.
- Latência p50: 3 ms.
- Latência p95: 17 ms.
- Latência max: 26 ms.

Qualidade de extração:

- `unknown direction`: 52/54.
- `empty body`: 7/54.
- `missing date`: 15/54.
- `missing time`: 15/54.
- `missing second`: 54/54, esperado pelo ADR 0012.
- `minute precision only`: 39/54.

Leitura técnica:

- O motor CDP -> binding -> SQLite ficou verde para latência, volume, duplicata e erro de observer.
- O requisito de timestamp com segundo real foi substituído pela decisão ADR 0012: `messageSecond=NULL`, `observed_at_utc` real e `wa_inferred_second` para timeline.
- Ainda não é verde de produto para sync completo porque a inferência de `direction` falhou na maioria dos eventos e alguns eventos de mídia/álbum chegaram sem `date/time`.
- Próximo hardening obrigatório: derivar direction por `data-pre-plain-text`/autor (`Nuoma` vs contato), classes `message-in/out` no container correto e atributos de status; melhorar extração de timestamp em mídia/álbum.

## Verdict

**AMARELO técnico**. A cobertura/latência do observer passou na rodada de 50 mensagens, mas a extração de metadados ainda precisa correção antes de liberar a implementação definitiva do sync V2. G.1 não bloqueia mais por latência; bloqueia por `direction` e timestamp de mídia/álbum.

## G.1a Hardening — 2026-04-30

Implementado no harness, pendente de rodada real:

- `observer-script.js` agora emite `message-snapshot` para bubbles visíveis ao abrir/reattachar conversa.
- O observer reanexa quando o WhatsApp troca `#main` ou `#pane-side`.
- Sidebar passa a gerar fingerprint por linha (`title`, preview, horário, unreadCount, aria/text hash) e eventos `conversation-row-snapshot` / `conversation-row-changed`.
- `unread` deixa de ser condição de correção; é apenas sinal de prioridade.
- Quando todos os bubbles visíveis já são conhecidos na sessão do observer, o harness emite `backfill-probe-requested` e rola uma janela curta para cima.
- Eventos de mensagem agora incluem campos de timestamp quando o WhatsApp expõe: `messageDate`, `messageTime`, `messageHour`, `messageMinute`, `messageSecond`, `messageDayOfWeek` e precisão/fonte.
- Segundo real do WhatsApp não é obrigatório após ADR 0012: quando `data-pre-plain-text`/detalhes só expõem hora:minuto, V2 salva precisão `minute`, `messageSecond=NULL`, `observed_at_utc` real e `wa_inferred_second` para timeline.
- `run.ts` grava stream bruto em `observer_events`, sidebar em `sidebar_events` e mensagens/snapshots em `captured`.
- `analyze.ts` separa mensagens novas, snapshots, sidebar, probes de backfill e qualidade de extração (`direction`/`body`/timestamp completo).

Smoke real pós-hardening:

- CDP subiu em `127.0.0.1:9222`.
- O worker V1 executou sync de startup antes do smoke e inseriu 10 mensagens no DB V1; isso é efeito colateral conhecido do worker atual, não do harness do spike.
- `npm run smoke` passou com `smoke success — observer, snapshot and sidebar scan are live`.
- `npm run analyze -- --expected=4` passou a mostrar os novos contadores:
  - `Visible snapshots captured`: 11.
  - `Snapshot complete events`: 1.
  - `Sidebar row snapshots`: 69.
  - `Raw observer events`: 89.
  - `Observer errors`: 0.

Pendente para fechar G.1a/G.1b: rodar `TARGET_PHONE=5531982066263 npm run run`, enviar mensagens ativas somente para esse número e confirmar no `npm run analyze -- --expected=50` que a cobertura deixou de ficar abaixo do esperado.

## Mini-run G.1b — 2026-04-30

Rodada curta com `TARGET_PHONE=5531982066263`:

- Primeiro run: o chat alvo abriu com atraso; chegaram sinais de sidebar para 6 mensagens (`Oi`, `Teste`, `Vamos`, `Testar`, `Esse aplicadito vai ficar perfeito`, `Bora`), com unread subindo até 6.
- Diagnóstico: as mensagens estavam no DOM do `#main`, mas o WhatsApp adicionou/alterou `data-id` depois da mutation inicial. O observer antigo capturou sidebar, mas não emitiu `message-added`.
- Ajuste feito: observer agora observa atributo `data-id` e roda snapshot debounced de `#main` após mutations. Backfill ficou desligado por padrão (`ENABLE_BACKFILL_PROBE=1` para ligar), para não rolar a conversa durante teste de mensagem nova.
- Segundo run: não chegaram mensagens novas após o restart. A análise validou o novo caminho de captura sobre mensagens visíveis/hidratadas:
  - `Messages captured`: 29.
  - `Visible snapshots captured`: 61.
  - `Observer errors`: 0.
  - `p50`: 0 ms.
  - `p95`: 1 ms.
  - `missing second`: 29/29.
  - `minute precision only`: 25/29.

Conclusão da mini-run: G.1b ainda não está verde. O caminho de captura/reconcile ficou mais forte, mas timestamp completo não fecha pelo DOM atual: `data-pre-plain-text`/bubble text entrega data/hora em precisão de minuto para a maioria das mensagens e não entrega segundo. Próximo ajuste obrigatório: fallback de detalhes da mensagem para obter segundo, ou confirmar que o WhatsApp Web não expõe segundo em nenhum detalhe acessível.

## G.1c — Message Details Timestamp Probe

Resultado: **AMARELO técnico, decisão registrada**.

- `npm run inspect-details` executa `run.ts --inspect-details`.
- O runner abre `TARGET_PHONE`, escolhe uma mensagem visível, tenta abrir menu/dados/detalhes da mensagem e persiste o resultado em `message_detail_probes`.
- `analyze.ts` mostra total de probes e quantos expuseram segundos.
- O probe não envia mensagens nem altera configurações do chat.

Rodada real em `5531982066263`:

- Mensagem inspecionada: outgoing `Teste`, `data-id=2A9EFB00F4F65D254D43`.
- Menu correto aberto: `Dados da mensagem`.
- Painel correto identificado: `[data-testid="drawer-right"]` com título `Dados da mensagem`.
- Texto/atributos relevantes extraídos:
  - `data-pre-plain-text`: `[11:21, 30/04/2026] Nuoma:`
  - status `Lida`: `-`
  - status `Entregue`: `Hoje às 11:21`
- Segundos expostos: **não**.
- Candidatos de timestamp encontrados: `11:21`, `30/04/2026`.

Conclusão: no WhatsApp Web Business observado em 2026-04-30, nem o DOM do bubble nem o painel de detalhes expõem `hora:minuto:segundo`. O V2 não deve fabricar `messageSecond` como se fosse horário exibido pelo WhatsApp. A decisão agora é persistir o horário exibido com `timestamp_precision='minute'`, manter `messageSecond=NULL`, gravar `observed_at_utc` com segundo/milissegundo real da captura para auditoria e derivar um segundo sintético de timeline (`wa_inferred_second`) pela ordem DOM dentro do mesmo minuto. Regra: mais recente `59`, anterior `58`, anterior `57`, etc. Ver ADR 0012.

Validação após ajuste do analyzer:

- `npm run typecheck`: passou.
- `npm run analyze -- --expected=1`: passou como rodada diagnóstica.
- `Message detail probes`: 8, sendo 0 com segundos.
- `details fallback`: 6 probes bem-sucedidos sem segundos; caminho ADR 0012 ativo.
- Observação: aprovação final de G.1 ainda exige uma rodada de 50 mensagens reais.

## G.1d — Metadata Extraction Hardening

Implementado em 2026-04-30:

- `direction` agora usa `deliveryStatus`/ícones de envio como evidência de outgoing.
- Autor de `data-pre-plain-text` agora classifica incoming/outgoing; `Nuoma` entra como self author conhecido.
- Quando o WhatsApp não fornece `data-pre-plain-text` em mídia/álbum/visualização única, o observer tenta extrair horário visível do bubble e data do separador anterior (`Hoje`, `Ontem`, data numérica ou dia da semana).
- Se não houver evidência de outgoing em conversa 1:1 e o nó ainda for bubble com `data-id`, o fallback classifica como incoming.
- `analyze.ts` agora mostra qualidade de extração também para snapshots visíveis, não só `message-added`.

Validação curta pós-patch:

```bash
npm run analyze -- --expected=0
```

Resultado:

- `Visible snapshots captured`: 88 eventos, 22 `data_id` únicos.
- `Snapshot extraction quality`: `unknown direction 0/22`, `missing date 0/22`, `missing time 0/22`.
- `Observer errors`: 0.

Rodada curta final com mensagens novas em `5531982066263`:

```bash
npm run analyze -- --expected=30
```

Resultado:

- `Messages captured`: 31 / 30.
- `unknown direction`: 0/31.
- `missing date`: 0/31.
- `missing time`: 0/31.
- `empty body`: 5/31 (mídia/itens sem texto útil).
- `Visible snapshots`: 377 eventos, 32 `data_id` únicos.
- `Snapshot extraction quality`: `unknown direction 0/32`, `missing date 0/32`, `missing time 0/32`.
- `Duplicates blocked`: 0.
- `Observer errors`: 0.
- `message-updated`: 49.
- `message-removed`: 57.
- `delivery-status-changed`: 28.
- Latência p50: 178 ms.
- Latência p95: 201 ms.
- Latência max: 202 ms.
- Probe G.1c no mesmo DB: `details-clicked`, 0 segundos expostos, caminho ADR 0012 ativo.

Conclusão: G.1d passou para metadados essenciais (`direction`, `date`, `time`) em `message-added` novo e em snapshots visíveis. Segundos continuam deliberadamente minute-precision via ADR 0012.

## G.1e — Final Canonical Run

Executado em 2026-04-30 com o observer corrigido e `TARGET_PHONE=5531982066263`.

Comando:

```bash
npm run analyze -- --expected=50
```

Resultado:

- `Messages captured`: 62 / 50.
- `Visible snapshots captured`: 412 eventos, 55 `data_id` únicos.
- `Snapshot complete events`: 22.
- `Duplicates blocked`: 0.
- `Observer errors`: 0.
- `message-updated events`: 94.
- `message-removed events`: 138.
- `delivery-status-changed events`: 139.
- `Sidebar row changes`: 16.
- `Raw observer events`: 980.
- `Message detail probes`: 1, 0 com segundos.
- Latência p50: 1 ms.
- Latência p95: 4 ms.
- Latência max: 15 ms.

Qualidade de extração:

- `unknown direction`: 0/62.
- `missing date`: 0/62.
- `missing time`: 0/62.
- `missing second`: 62/62, esperado por ADR 0012.
- `minute precision only`: 62/62.
- `Snapshot extraction quality`: `unknown direction 0/55`, `missing date 0/55`, `missing time 0/55`.

Veredito do analyzer:

```text
VERDE — latency/dedup targets met; WhatsApp display timestamp is minute-precision, use observed_at_utc per ADR 0012
```

Conclusão: Spike 1 aprovado para ADR 0007/V2.6. A engine CDP observer provou captura real <3s, sem duplicatas/erros, com metadados essenciais (`direction`, `date`, `time`) preenchidos. Segundos reais não são expostos pelo WhatsApp Web Business; seguir ADR 0012 (`messageSecond=NULL`, `observed_at_utc` real e `wa_inferred_second` para timeline).
