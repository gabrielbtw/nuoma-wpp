---
name: v1-to-v2-data-import
description: Importar ou validar dados V1->V2 com backup, dry-run, apply aprovado e verificacao por contagem/identidade.
user_invocable: true
---

# /v1-to-v2-data-import

Use para importacao, backfill ou verificacao de dados entre V1 e V2.

## Contrato

- V1 e somente leitura.
- V2 recebe inserts/updates apenas apos backup e dry-run.
- Identidade de contato prioriza `phone`, `phone_e164` e `wa_jid`.
- Ambiguidade de telefone BR deve ser registrada no relatorio, nao corrigida
  silenciosamente.

## Sequencia

1. Confirmar paths de DB/storage e stack ativa.
2. Fazer backup do destino.
3. Rodar dry-run com relatorio.
4. Revisar novos, duplicados, rejeitados e orfaos.
5. Aplicar somente com confirmacao explicita.
6. Rodar dry-run pos-apply ate `new=0` ou justificar diferenca.

## Validacao

- `npm run migration:v215:preflight`
- `npm run migration:v215:dry-run`
- `npm run migration:v215:validate`
- Testes/smokes especificos do importador alterado.
