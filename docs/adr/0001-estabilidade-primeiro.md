# ADR 0001 - Estabilidade primeiro na Rodada 1

## Status

Aceita

## Contexto

O projeto opera como CRM interno com automacao multicanal. Os fluxos mais sensiveis hoje sao campanhas, integracao com Instagram e o worker do WhatsApp.

Nesta rodada, a prioridade definida foi estabilidade operacional. Tambem ficou travado que nao devemos alterar o comportamento das integracoes nem o estilo visual do produto. O `data lake` foi explicitamente retirado do escopo.

## Decisao

Durante a Rodada 1:

- permitir apenas limpeza segura e melhorias locais de legibilidade
- manter contratos publicos, rotas, payloads, tabelas e integracoes sem alteracao
- melhorar checks de higiene e previsibilidade de testes
- produzir documentacao estrutural para time misto

## Consequencias

- ganhamos uma base mais limpa sem aumentar risco operacional
- refactors mais profundos ficam adiados para uma rodada posterior
- problemas estruturais conhecidos continuam documentados, mas nao sao atacados nesta fase
- qualquer mudanca em Instagram, WhatsApp ou `data lake` depende de uma iniciativa dedicada
