# ADR 0012 — Precisão de timestamp de mensagens do WhatsApp Web

## Status

Aceita para V2 após o probe G.1c em 2026-04-30.

## Contexto

O produto precisa preservar data e horário de cada mensagem. A hipótese inicial era usar `data-pre-plain-text` e, quando ele não trouxesse segundo, abrir `Dados da mensagem` como fallback.

No Spike 1 G.1c, o harness abriu uma mensagem real no WhatsApp Web Business para `5531982066263` e inspecionou o drawer `[data-testid="drawer-right"]`:

- mensagem: outgoing `Teste`, `data-id=2A9EFB00F4F65D254D43`;
- `data-pre-plain-text`: `[11:21, 30/04/2026] Nuoma:`;
- painel `Dados da mensagem`: status `Lida -` e `Entregue Hoje às 11:21`;
- nenhum texto ou atributo visível expôs `hora:minuto:segundo`.

## Decisão

V2 não deve inventar segundo do horário exibido pelo WhatsApp.

Persistir separadamente:

- `wa_display_date`: data exibida/extraída do WhatsApp quando disponível;
- `wa_display_time`: hora exibida/extraída do WhatsApp quando disponível;
- `wa_display_timestamp_precision`: `second`, `minute` ou `unknown`;
- `message_second`: preenchido somente quando o WhatsApp expuser segundo real;
- `wa_inferred_second`: segundo sintético, opcional, usado apenas para ordenar mensagens quando o WhatsApp só expõe minuto;
- `wa_inferred_second_source`: fonte da inferência, por exemplo `dom_order_within_minute`;
- `observed_at_utc`: timestamp UTC do handler CDP/worker com segundo e milissegundo reais de captura.

Para o WhatsApp Web Business observado em 2026-04-30, o valor normal será `wa_display_timestamp_precision='minute'`, `message_second=NULL`, `wa_inferred_second` preenchido quando houver ordem DOM confiável e `observed_at_utc` preenchido.

### Ordenação dentro do mesmo minuto

Quando várias mensagens da mesma conversa compartilham o mesmo `wa_display_date + hora:minuto`, o V2 deve construir uma timeline sintética baseada na ordem do DOM do WhatsApp:

- agrupar por `conversation_id`, `wa_display_date`, hora e minuto;
- ordenar pelo `data-id`/posição DOM na conversa, do mais antigo para o mais recente;
- se houver até 60 mensagens no grupo, atribuir `wa_inferred_second` de forma crescente até `59`, deixando a mensagem mais recente como `59`, a anterior como `58`, a anterior como `57`, e assim por diante;
- exemplo com 3 mensagens em `11:21`: antiga `11:21:57`, intermediária `11:21:58`, recente `11:21:59`;
- se houver mais de 60 mensagens no mesmo minuto, manter `wa_inferred_second` limitado a `0..59` e usar também um `intra_minute_order`/sequência interna para desempate estável.

Esse segundo inferido nunca vira `message_second`. Ele é uma chave de timeline/sort, não uma afirmação de horário real emitido pelo WhatsApp.

## Consequências

- A UI pode mostrar o horário do WhatsApp com fidelidade, sem falsa precisão.
- Auditoria usa `observed_at_utc`; ordenação visual dentro da mesma janela de minuto usa `wa_inferred_second` + ordem DOM quando disponível.
- Deduplicação não depende de segundo: o identificador canônico continua sendo `data-id`.
- O sync não deve abrir `Dados da mensagem` apenas para buscar segundo enquanto o WhatsApp não expuser esse dado.
- Se uma versão futura do WhatsApp Web passar a expor segundos, o observer pode preencher `message_second` e mudar a precisão para `second` sem quebrar contratos existentes.
