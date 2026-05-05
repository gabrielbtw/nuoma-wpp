# Checkpoint V2 Base — 2026-05-05

Escopo: este checkpoint considera somente o repo `nuoma-wpp-v2`.

## Baseline git

- Commit inicial: `31004f8 chore: baseline nuoma wpp v2`.
- Branch atual: `main`.
- Remote: nenhum configurado no momento.
- Hook do commit executou `typecheck` e `lint` via Turbo com sucesso.

## Verde operacional

- `V2.1` a `V2.6`: base, domínio, persistência, auth, fila/worker e sync engine.
- `V2.8`: design system e shell web.
- `V2.9`: Inbox principal.
- `V2.10`: campanhas, automações e chatbots estão funcionais como base de produto.
- `V2.11.1` a `V2.11.7`: overlay inicial no WhatsApp, FAB, painel e ponte `window.__nuomaApi`.

## Parcial, mas utilizável

- `V2.7`: API principal pronta, com IG unificada fora do fluxo cotidiano e streaming apenas como contrato.
- `V2.10`: faltam complementos de operação longa, auditoria materializada e edição visual mais avançada.
- `V2.11`: overlay funciona como leitura/assistência inicial, mas ainda não é ferramenta operacional completa.
- `V2.13`: Inbox SSE/Web Push parcial; falta stream global por canais.
- `V2.14`: Docker/base de deploy existem, mas operação de host, backup, rollback e hardening HTTP ainda estão incompletos.

## Fazer agora

1. Fechar hardening curto de `V2.10` que reduz risco operacional real:
   - materializar auditoria por recipient/job;
   - registrar histórico de execução de chatbot por mensagem;
   - persistir exposição/conversão de variante de chatbot.

2. Fechar infra mínima de `V2.14` antes de qualquer cutover:
   - rollback automatizado ou procedimento de rollback com release anterior;
   - backup automatizado validado;
   - restore interativo.

## Deixar para depois

- `V2.12` remote rendering CDP/canvas completo.
- `V2.13` stream global por canais.
- `V2.14` S3/custos/local-first completo.
- `V2.15` migração e cutover V1 -> V2.

## Não mexer ainda

- `V2.14a` hero cartográfico/R3F opcional.
- Instagram, Data Lake e AI, salvo iniciativa explícita.
- Refactor grande de contrato ou schema sem necessidade direta do hardening atual.
