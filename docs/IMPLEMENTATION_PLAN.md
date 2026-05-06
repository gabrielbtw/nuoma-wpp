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
- Eventos reais `sender.temporary_messages.audit`:
  `before_send 24h verified=true` e `after_completion_restore 90d verified=true`.
- Zero jobs ativos ao final e nenhum completed fora da allowlist.

## Proximos Itens Condicionais

| Ordem | Tema | Condicao para abrir |
| --- | --- | --- |
| 2 | Remarketing em lote real | Somente depois do M30.3 passar em smoke forte. |
| 3 | Instagram/DM | Somente com iniciativa explicita; fora do fluxo cotidiano. |
| 4 | Cutover operacional | Somente depois de campanha real passar lisa e com evidencias completas. |

## Regras De Manutencao

- Nao transformar este plano em diario de execucao.
- Ao fechar um item, mover o resultado resumido para `IMPLEMENTATION_STATUS.md`.
- Se surgir gap durante smoke real, criar `M<n>.<m>` em vez de reabrir uma versao
  inteira.
- Se o gap for de produto amplo, abrir nova `V2.x.y`; se for correcao pontual,
  abrir hotfix `M<n>.<m>`.
