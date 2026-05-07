# Checkpoint V2 Base — 2026-05-07

Escopo: este checkpoint considera somente o repo `nuoma-wpp-v2`.

## Baseline git

- Commit inicial: `31004f8 chore: baseline nuoma wpp v2`.
- Branch atual: `codex/nuoma-wpp-v2-standalone`.
- Remote: nenhum configurado no momento.
- Hook do commit executou `typecheck` e `lint` via Turbo com sucesso.

## Verde operacional

- `V2.1` a `V2.6`: base, domínio, persistência, auth, fila/worker e sync engine.
- `V2.8`: design system e shell web.
- `V2.9`: Inbox principal.
- `V2.10`: campanhas, automações e chatbots estão funcionais como base de produto.
- `V2.11.1` a `V2.11.7`: overlay WhatsApp fechado com FAB, painel,
  telefone por contato salvo/titulo, ponte `window.__nuomaApi` e smokes reais.
- `V2.12`: remote rendering CDP minimo fechado com screenshot e input relay.

## Parcial, mas utilizável

- `V2.7`: API principal pronta, com IG unificada fora do fluxo cotidiano.
- `V2.10`: faltam complementos de operação longa, auditoria materializada e edição visual mais avançada.
- `V2.13`: stream global por canais fechado no mínimo operacional; Web Push continua como complemento.
- `V2.14`: Docker/base de deploy existem, mas operação de host, backup, rollback e hardening HTTP ainda estão incompletos.
- `V2.15`: preflight de migracao/cutover V1 -> V2 pronto; cutover real segue condicionado a comando explicito e smoke/lote real.

## Fazer agora

1. Fechar hardening curto de `V2.10` que reduz risco operacional real:
   - materializar auditoria por recipient/job;
   - registrar histórico de execução de chatbot por mensagem;
   - persistir exposição/conversão de variante de chatbot. **Feito em 2026-05-06 via M28.1**.

2. Fechar infra mínima de `V2.14` antes de qualquer cutover:
   - rollback automatizado ou procedimento de rollback com release anterior;
   - backup automatizado validado;
   - restore interativo.

## Deixar para depois

- `V2.12` canvas/editor completo alem do minimo CDP. **Screencast CDP minimo com input relay fechado e revalidado em 2026-05-07**.
- `V2.13` stream global por canais. **Feito em 2026-05-06 com `/api/events` SSE autenticado para `inbox` e `system`**.
- `V2.14` S3/custos/local-first completo. **Leitura CRM S3 com cache local fechada em 2026-05-06 via M22.2**.
- `V2.15` aplicacao operacional do cutover V1 -> V2; preflight ja esta `ready`.

## Não mexer ainda

- `V2.14a` hero cartográfico/R3F opcional.
- Instagram, Data Lake e AI, salvo iniciativa explícita.
- Refactor grande de contrato ou schema sem necessidade direta do hardening atual.
