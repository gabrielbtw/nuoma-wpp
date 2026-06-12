# Rebrand Phase 8/9 Final QA Status

Data: 2026-06-12

## Escopo

Fechamento visual e automatizado do plano Carvão & Cobre, FlowBuilder V2,
Overlay HUD WhatsApp e hardening operacional.

Ambiente usado:

- Web local: `http://127.0.0.1:3002`.
- API local: `http://127.0.0.1:3001`.
- Browser visual: Browser plugin com viewports `1440x900` e `390x844`.
- WhatsApp/Overlay: Chrome for Testing/Chromium ativo via CDP, preservando a
  sessao logada ja existente.
- Nenhum envio real foi executado nesta fase.

## Prints finais

Arquivos fora do repo:

- `/tmp/nuoma-rebrand-final/dashboard-desktop.png`
- `/tmp/nuoma-rebrand-final/dashboard-mobile.png`
- `/tmp/nuoma-rebrand-final/campaign-builder-desktop.png`
- `/tmp/nuoma-rebrand-final/campaign-builder-mobile.png`
- `/tmp/nuoma-rebrand-final/campaign-builder-interaction-audio.png`
- `/tmp/nuoma-rebrand-final/inbox-desktop.png`
- `/tmp/nuoma-rebrand-final/inbox-escape-fixed.png`
- `/tmp/nuoma-rebrand-final/contacts-desktop.png`
- `/tmp/nuoma-rebrand-final/jobs-desktop.png`
- `/tmp/nuoma-rebrand-final/jobs-cleanup-confirmation.png`
- `/tmp/nuoma-rebrand-final/chatbots-desktop.png`
- `/tmp/nuoma-rebrand-phase5-overlay/overlay-panel-final-fixture.png`
- `/tmp/nuoma-rebrand-phase5-overlay/overlay-panel-final-wpp.png`
- `/tmp/nuoma-rebrand-phase5-overlay/overlay-fab-final-wpp.png`

Relatorio do screen matrix:

- `data/v2-screen-smoke-2026-06-12T03-50-29-278Z/REPORT.md`

## QA manual/Browser

- Login renderizou em Carvão & Cobre com credenciais DEV locais e sem erros de
  console relevantes.
- Dashboard desktop/mobile renderizou metricas reais sem tema Indigo/cyan.
- Campaign builder desktop/mobile renderizou a nova area de criacao; em mobile
  mostra aviso de tela maior em vez de layout quebrado.
- Campaign builder interativo adicionou o step real `Enviar áudio`, selecionou
  o node no inspector e mostrou validacao real de `Media Asset ID`.
- Inbox reproduziu uma falha: `Esc` com foco no composer nao fechava conversa
  apesar do rodape anunciar `Esc fechar`.
- Inbox foi corrigido e revalidado no Browser: com foco em `Mensagem`, `Esc`
  fecha a conversa sem re-selecionar imediatamente.
- Jobs abriu a confirmacao destrutiva inline/modal para
  `Limpar concluídos (30 dias)`; o botao final fica desabilitado ate digitar
  `LIMPAR CONCLUÍDOS`. A limpeza nao foi confirmada.

## Ajustes aplicados durante QA

- `apps/web/src/pages/InboxPage.tsx`
  - `Esc` em alvo de digitacao agora cancela draft de acao quando existe.
  - Sem draft, `Esc` limpa a conversa selecionada.
  - Dialogs, menus e poppers continuam excluidos para nao capturar atalhos de
    overlays temporarios.
- `tests/v29-inbox-e2e-smoke.mjs`
  - Cobre `conversationClearedOnEsc=true`.
  - Remove cliques redundantes em bubble de mensagem que ficavam frageis contra
    header/filtro/composer sticky.
  - Mantem a verificacao de que editar via atalho nao persiste mutacao ao
    cancelar.
- `tests/v2-screen-smoke-matrix.mjs`
  - `submitLogin` agora espera a SPA sair de `/login`, em vez de exigir uma
    navegacao full-load para `/`.
- `apps/web/src/styles/legacy.css`
  - Reduzido para 759 linhas por split mecanico de CSS de workspaces legados em
    `apps/web/src/styles/pages/compat-workspaces.css`.

## Validacao automatizada

Passaram:

- `npm run typecheck --workspace @nuoma/ui`
- `npm run typecheck --workspace @nuoma/web`
- `npm run test --workspace @nuoma/web`
- `npm run build --workspace @nuoma/web`
- `npm run typecheck --workspace @nuoma/worker`
- `npm run test --workspace @nuoma/worker`
- `npm run typecheck --workspace @nuoma/contracts`
- `npm run typecheck --workspace @nuoma/db`
- `npm run typecheck --workspace @nuoma/api`
- `npm run test --workspace @nuoma/db`
- `npm run test --workspace @nuoma/api`
- `npm run test:design-system-v3`
- `npm run test:v210-flow-builders`
- `npm run test:v210-campaign-builder-mobile`
- `npm run test:v210-campaigns`
- `npm run test:chatbot-dry-run-validation`
- `npm run test:v29-inbox`
- `npm run test:v29-inbox-e2e`
- `npm run test:v29-sidebar-tabs`
- `npm run test:v29-quick-replies`
- `npm run test:v29-voice-recorder`
- `npm run test:v29-virtual-list`
- `npm run test:v29-reconciliation`
- `npm run test:v211-overlay-suite`
- `npm run test:v2-screen-smoke`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

Resultados destacados:

- `test:v29-inbox-e2e`:
  `conversationClearedOnEsc=true`, `sendJobsDelta=0`, `blocking=0`,
  `wppMode=cdp`.
- `test:v210-flow-builders`: `sendJobsDelta=0`, `blocking=0`,
  `wppMode=cdp`, `ig=nao_aplicavel`.
- `test:v210-campaigns`: `campaignStepJobsDelta=0`, `blocking=0`,
  `wppMode=cdp`.
- `test:v211-overlay-suite`: FAB, panel, phone, API binding e contratos
  passaram com CDP; `overlay-campaign-data` ficou `skipped` porque o banco
  atual nao tem campanha `overlayEnabled`.
- `test:v2-screen-smoke`: 13 itens renderizados e report gerado.
- Validacao apos split de `legacy.css`: `npm run build --workspace @nuoma/web`,
  `npm run test:design-system-v3` e `npm run test:v2-screen-smoke` passaram.

Observacoes:

- Uma rodada paralela dos smokes de Inbox gerou timeouts de login/lista por
  contencao de browser/DB. Os mesmos smokes passaram quando executados em
  sequencia ou isolados.
- `npm run build` registra o Safari Companion como
  `blocked_converter_unavailable` quando o Xcode converter nao esta instalado;
  o script aceita esse estado com `--allow-missing-converter` e o comando final
  saiu com codigo 0.

## Aceite

- Web V2 final visualmente alinhada a Carvão & Cobre nos prints principais.
- Bloco de criacao de campanha reimaginado e validado em desktop/mobile.
- Overlay WhatsApp preservou contratos e passou com sessao real via CDP.
- Inbox nao anuncia mais um atalho que falha no composer.
- Confirmacoes destrutivas de Jobs estao protegidas por texto.
- `legacy.css` atingiu a meta de reducao maior que 70%.
- Matriz final automatizada passou.
