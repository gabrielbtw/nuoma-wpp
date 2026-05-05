# V2 — Documento de Decisão (enxuto)

Este é o blueprint **mínimo** do V2 após a crítica do owner em Abril 2026. Substitui a abordagem anterior de "gerar 24 docs + 8 agents + 7 skills antes de provar a base".

## Tese (mantida)

V2 = repo novo `nuoma-wpp-v2/`, paralelo ao V1, com:

- **Sync confiável** (real-time <3s) — resolve a desconfiança principal.
- **App hospedada** em domínio (Lightsail mesmo), acessível de qualquer lugar.
- **Multi-user schema desde dia 1** — `user_id` em todas tabelas.
- **Auth real** — email + senha (V1 do auth) + Passkey opcional (V2 do auth).
- **Áudio (IC-1) e multi-step sender (IC-2)** preservados literalmente do V1.

## O que muda em relação à proposta anterior

A proposta original ("greenfield com Bun + Hono + tRPC + Drizzle + Tailwind 4 + TanStack Router + shadcn") foi recuada por crítica do owner: **o maior risco do produto é WhatsApp Web/Chromium, não HTTP server**. Trocar todas as camadas simultaneamente aumenta superfície de erro sem reduzir o problema central.

Stack revisada (versão conservadora):

| Camada | V1 atual | V2 proposto agora | Por quê |
|---|---|---|---|
| Runtime | Node 22 | **Node 22** (mantém) | Bun não resolve risco real |
| HTTP | Fastify 5 | **Fastify 5** (mantém) | Já estável, sem ganho concreto em trocar |
| DB driver | better-sqlite3 | **better-sqlite3** (mantém) | Mesma engine, sem migração |
| Schema/queries | SQL puro | **Drizzle ORM** (validar via Spike 4) | Ganho real: type-safety + migrations versionadas — *gated* |
| Validation | Zod | **Zod** (mantém) | — |
| API contract | REST + Zod duplicado | **REST + Zod compartilhado em package** (default); tRPC só se Spike 4 mostrar drift recorrente como problema mensurável | Reduz mudança simultânea |
| Frontend | React 19 + Vite 7 + Tailwind 3 + Radix + RR7 | **mesmo** (mantém) | Trocar sem motivo é AI slop |
| Auth | (não tem) | **Argon2id + JWT cookie + refresh** (novo, mas sem herança a quebrar) | Necessário pra hosted |
| Worker browser | Playwright puro | **Playwright + CDP híbrido** | CDP só pra observers/screencast; Playwright continua dono de navegação/ações |
| Multi-user | (não tem) | **Schema com user_id desde dia 1** | Single-user inicial = `user_id=1` |
| Streaming visual | (não tem) | **CDP `Page.startScreencast` → canvas via WS** (gated Spike 2) | Só se latência aceitável |
| Real-time | Polling | **SSE Fastify + polling fallback** | Hono não foi escolhido |
| Backup | (manual) | **S3 `nuoma-files/nuoma-wpp-v2/` daily, retain 30d** | — |

## Gate técnico — 4 spikes obrigatórios antes de criar `nuoma-wpp-v2/`

Antes de:

- Criar o diretório novo
- Iniciar Foundations (qualquer item V2.1.x)
- Travar arquitetura ou stack

A equipe (owner + IA) precisa **fechar 4 spikes** com critérios de aceitação claros. Definição em [`V2_SPIKES.md`](./V2_SPIKES.md):

1. **Spike 1** — CDP observer captura msg real <3s, end-to-end.
2. **Spike 2** — `Page.startScreencast` renderiza WhatsApp remoto com latência aceitável.
3. **Spike 3** — Áudio do V1 portado literal funciona em ambiente V2 (IC-1).
4. **Spike 4** — Migration dryrun lê SQLite V1 e mapeia contatos/conversas/mensagens corretamente.

Decisão em 2026-04-30: Spike 1, Spike 2 e Spike 4 fecharam verde. Spike 3 fechou
verde para IC-1 local + Docker dry-run e amarelo para hosted `--send` com perfil
WhatsApp autenticado. Esse amarelo foi classificado como **não-bloqueador para
V2.1 Foundations**, porque Foundations nao executa envio produtivo; ele continua
**bloqueador antes de V2 worker/deploy assumir áudio em produção**.

## Multi-user na realidade do WhatsApp

Crítica aceita: "multi-user precisa ser definido contra o WhatsApp real". Sessão WPP é **por número**, não por user. Decisão pré-V2:

- **V2 inicial**: 1 número WPP, 1 sessão Chromium, **N atendentes humanos** (roles: admin, attendant, viewer) compartilhando a inbox. `user_id` em tabelas operacionais traceia *quem fez* (audit), não *de quem é o dado*.
- **V2 futuro (Fase 11+)**: multi-tenant real (cada cliente teu produto = um número WPP + uma sessão Chromium isolada). Esquema preparado mas **não implementado** até produto provar valor.
- **Schema reflete os dois**: `tenant_id` opcional (default 1) + `user_id` NOT NULL. Permite escalar sem migration.

## Timeline realista

A crítica apontou inconsistência (2-3 meses no início, 4-5 meses no fim). Decisão: assumir **4-5 meses** como expectativa pra paridade de features completa, com cutover só depois de soak period de 2-4 semanas.

Ordem de execução real:

```
Sprint 1-2: V1 patches críticos (V1.1-V1.17)               [~2 sprints]
Sprint 3:   Fase 0 de Prova — 4 spikes técnicos             [~1 sprint, gating]
            ↓ se 4 verdes
Sprint 4:   V2 Foundations (V2.1.x mínimo)                 [~1 sprint]
Sprint 5-6: V2 Domain + Persistence + Auth                 [~2 sprints]
Sprint 7-8: V2 Worker base + Sync engine + IC-1/IC-2       [~2 sprints]
Sprint 9-10: V2 API surface (REST default, tRPC só se justificar)
Sprint 11-12: V2 Web shell + Inbox V2 (incluindo IC-1 voice UI)
Sprint 13-15: V2 Campaigns/Automations/Chatbots
Sprint 16-17: V2 Embed overlay + Streaming remoto (Spike 2 confirmado)
Sprint 18-19: V2 Real-time SSE + Web Push + Deploy infra
Sprint 20: Migração V1→V2 (dryrun ✓ → real → soak 2-4 semanas)
Sprint 21+: Cutover quando confiança alta
```

## O que está deferred

Tudo abaixo só é endereçado **depois** dos spikes verdes:

- 24 docs de arquitetura/runbooks (criar conforme necessidade real)
- 8 agents customizados (criar 1-2 só pra spikes)
- Design system V2 (Cartographic + Glass selectivo + R3F)
- Inbox V2, Campaigns V2, Chatbots V2 visuais
- Tauri/Electron eval (Fase 12 do plano original — fica como ideia distante)

## Próximo turno

Com a decisão de gate de 2026-04-30, iniciar `nuoma-wpp-v2/` apenas com V2.1
Foundations. Nao portar produto ainda. Antes de envio hosted real, executar o
procedimento `experiments/spike-3-voice/HOSTED_PROCEDURE.md`.

## Referências

- Crítica completa do owner: arquivada em [`/Users/gabrielbraga/.claude/plans/eu-quero-que-voc-cryptic-lobster.md`](../../.claude/plans/eu-quero-que-voc-cryptic-lobster.md) (mensagem de revisão).
- Spikes: [`V2_SPIKES.md`](./V2_SPIKES.md)
- Migration mapping: [`../migration/V1_TO_V2_DATA_MAP.md`](../migration/V1_TO_V2_DATA_MAP.md)
- Roadmap: [`../IMPROVEMENTS_ROADMAP.md`](../IMPROVEMENTS_ROADMAP.md)
- ADRs revisadas: 0002 (stack), 0007 (sync híbrido)
