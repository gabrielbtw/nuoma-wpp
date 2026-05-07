# Checkpoint V2 Base — 2026-05-07

Escopo: este checkpoint considera somente o repo `nuoma-wpp-v2`.

## Baseline git

- Commit inicial: `31004f8 chore: baseline nuoma wpp v2`.
- Branch atual: `codex/nuoma-wpp-v2-standalone`.
- Remote: nenhum configurado no momento.
- Hook do commit executou `typecheck` e `lint` via Turbo com sucesso.

## Verde operacional

- `V2.1` a `V2.6`: base, domínio, persistência, auth, fila/worker e sync engine.
- `V2.7`: API surface/storage fechada, incluindo
  `conversations.listUnified` para WhatsApp/Instagram/System com filtro de
  canal, busca por contato/telefone/@IG e resumo por canal.
- `V2.8`: design system e shell web.
- `V2.9`: Inbox principal.
- `V2.10`: campanhas, automações e chatbots fechados com auditoria
  materializada por recipient/job, historico de chatbot por mensagem e
  historico A/B. Remarketing em lote real fechado com allowlist, lote integral
  sem envio parcial e `temporaryMessages` M30.3 `24h/90d`.
- `V2.11.1` a `V2.11.7`: overlay WhatsApp fechado com FAB, painel,
  telefone por contato salvo/titulo, ponte `window.__nuomaApi` e smokes reais.
- `V2.12`: remote rendering CDP minimo fechado com screenshot e input relay.
- `V2.13`: stream global por canais fechado com `/api/events`.
- `V2.14`: backup/verify/restore local-first fechado com smoke.
- `V2.15`: preflight e cutover apply idempotente fechados, com apply real
  protegido por `V215_CONFIRM_CUTOVER=SIM`.
- `M37`: Evidence Center fechado com rota `/evidence`, leitura autenticada de
  reports/prints/evidence.json sob `data/` e smoke visual.

## Parcial, mas utilizável

- Web Push continua como complemento, fora do bloqueio de V2.13.

## Fazer agora

1. Proximo foco operacional:
   - nenhum `V2.*` aberto neste checkpoint;
   - execucao real de cutover apenas quando houver comando explicito.

## Deixar para depois

- `V2.12` canvas/editor completo alem do minimo CDP. **Screencast CDP minimo com input relay fechado e revalidado em 2026-05-07**.
- `V2.13` stream global por canais. **Feito e revalidado em 2026-05-07**.
- `V2.14` S3/custos/local-first completo. **Leitura CRM S3 com cache local fechada em 2026-05-06 via M22.2; backup/restore fechado em 2026-05-07**.
- `V2.15` aplicacao operacional do cutover V1 -> V2. **Implementacao fechada em 2026-05-07; apply real exige confirmacao forte**.

## Não mexer ainda

- `V2.14a` hero cartográfico/R3F opcional.
- Instagram, Data Lake e AI, salvo iniciativa explícita.
- Refactor grande de contrato ou schema sem necessidade direta do hardening atual.
