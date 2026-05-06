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
| 1 | `M30.3` | hotfix | aberto | Contexto 24h real aplicado e evidenciado no WhatsApp antes de automacao/remarketing. |

## M30.3 Hotfix

**Problema:** a rodada real da automacao Neferpeel BH confirmou inbound recente
no banco, mas nao confirmou/aplicou o contexto real de mensagens temporarias 24h
no WhatsApp Web antes do primeiro step.

**Escopo tecnico:**

- Abrir o chat alvo sem criar aba nova e sem refresh por step.
- Confirmar destino/canal antes de qualquer envio.
- Abrir/verificar o menu real de mensagens temporarias do WhatsApp.
- Aplicar 24h quando a automacao exigir esse contexto.
- Capturar evidencia visual/estado antes do primeiro step.
- Executar a sequencia serialmente, com intervalo maximo de 5s entre steps,
  exceto audio longo.
- Restaurar a configuracao final prevista somente depois da conclusao segura.

**Criterio de aceite:**

- Smoke real WhatsApp-only com `IG nao_aplicavel`.
- Print do WhatsApp mostrando o destino correto e o estado de mensagens
  temporarias 24h antes do primeiro envio.
- Jobs da campanha completam sem aba extra e sem refresh por mensagem.
- Banco e UI refletem jobs/mensagens atualizados.
- Zero jobs ativos ao final e nenhum completed fora da allowlist.

## Depois Do M30.3

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
