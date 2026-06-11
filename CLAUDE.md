# Nuoma WPP V2 - contexto de sessão

Este arquivo é injetado em toda sessão. Mantenha só invariantes e rotas de
descoberta; detalhes ficam em docs carregadas sob demanda.

## Estado atual

- Stack canônica V2: `apps/api`, `apps/web`, `apps/worker`,
  `packages/contracts`, `packages/db`, `packages/ui`, `packages/config`.
- Stack legada: `apps/web-app`, `apps/wa-worker`, `apps/scheduler`,
  `packages/core`; use apenas para leitura, hotfix aprovado, rollback ou cutover.
- Ownership e validação por camada: veja `AGENTS.md`.
- Roadmap ativo e delta por evidência: `docs/IMPROVEMENTS_ROADMAP.md`.
- Contexto operacional detalhado: `docs/agent-context/CANONICAL_CONTEXT.md`.
- Política de dieta de tokens: `docs/agent-context/SESSION_CONTEXT_DIET.md`.

## Invariantes

- Local-first: não adicionar serviços externos/cloud sem aprovação explícita.
- SQLite + Chromium/Playwright/CDP são a base operacional.
- WhatsApp e Instagram são os únicos canais cotidianos.
- AI/Data Lake/Sora ficam fora do fluxo normal sem env de aprovação.
- Não editar `node_modules/**`, `dist/**`, `.turbo/**`, `data/**`,
  `storage/**` ou artefatos gerados.
- Smoke de envio real exige destino/canal conferido e evidência visual; se o
  teste for WhatsApp-only, registrar `IG nao aplicavel`.

## IC-1 e IC-2

- IC-1: áudio nativo WhatsApp não pode regredir. Consulte
  `docs/adr/0010-preserve-v1-audio-and-multistep-sender.md` e a skill
  `wa-voice-regression` antes de tocar no pipeline de áudio.
- IC-2: campanhas multi-step não devem reabrir/recarregar conversa entre steps
  do mesmo destinatário.

## Comandos padrão

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Validações mínimas por camada estão no `AGENTS.md`. Para trabalho estreito,
rode primeiro o workspace afetado e só depois a validação repo-wide quando a
mudança cruzar camadas.

## Regras de trabalho

- Leia o fluxo existente antes de editar.
- Faça mudanças pequenas, reversíveis e com evidência.
- Respeite o dono da pasta; contratos públicos nascem no `core-api`.
- Não introduza dependência nova sem justificativa técnica objetiva.
- Se uma informação estiver em `docs/agent-context/*`, carregue só a seção
  necessária para a tarefa.
