---
name: wa-session-runbook
description: Operar ou validar a sessao WhatsApp/Instagram no Chromium/Chrome for Testing compartilhado sem perder login.
user_invocable: true
---

# /wa-session-runbook

Use quando a tarefa depender da sessao de browser ja autenticada, CDP ativo,
WhatsApp Web, Instagram Web ou overlay.

## Regras

- Priorizar a sessao Chromium/Chrome for Testing ativa antes de abrir novo
  perfil.
- Nao apagar `chromium-profile/`, `profile-snapshot/`, storage ou cookies.
- Nao rodar envio real sem destino/canal confirmado.
- Se o teste for WhatsApp-only, registrar `IG nao aplicavel`.
- Antes de mexer no worker, checar se parar o processo derruba a sessao CDP.

## Checks

- `npm run worker:status`
- `curl -s http://127.0.0.1:9222/json/version`
- Smokes overlay: `npm run test:v211-overlay-suite`
- Smokes sync: `npm run test:sync-top5`

Para QA visual, capturar prints em `/tmp/...`; nao commitar imagens sem pedido.
