# Dieta de contexto das sessões

Medição atualizada em 2026-06-12:

| Arquivo/grupo                     |                          Antes |           Depois implementado |
| --------------------------------- | -----------------------------: | ----------------------------: |
| `CLAUDE.md`                       |   9.650 chars / 1.221 palavras |    2.778 chars / 344 palavras |
| `AGENTS.md`                       |  11.621 chars / 1.577 palavras |    6.150 chars / 762 palavras |
| `.claude/skills/*.md`             |  64.403 chars / 8.689 palavras |    7.220 chars / 967 palavras |
| Base local `CLAUDE+AGENTS+skills` | 85.674 chars / 11.487 palavras | 16.148 chars / 2.073 palavras |
| `~/.claude/CLAUDE.md`             |                    inexistente |                   inexistente |

## O que fica injetado

- Stack canônica e stack legada.
- Invariantes IC-1/IC-2 e regra de smoke real.
- Links para `AGENTS.md`, roadmap e contexto sob demanda.
- Comandos globais mínimos.

## O que fica sob demanda

- Histórico V1 e campanhas antigas.
- Spikes detalhados e relatórios de abril.
- Runbooks longos de worker, CDP, sessão, cutover e migração.
- Skills e aliases antigos em `docs/legacy-skills/`.
- Comandos SQL específicos de diagnóstico.

## Regras para gastar menos tokens

- Não abrir roadmap inteiro quando a pergunta pede só uma fase; usar `rg` por
  `V2.x`.
- Não chamar subagente para bug pequeno, status de comando ou arquivo único.
- Quando usar subagente, passar no máximo uma camada, até três arquivos e pedir
  resposta curta com caminhos de evidência.
- Em auditorias, pedir achados por severidade e proibir contexto histórico
  repetido.
- Em skills, manter `SKILL.md` como fluxo curto; detalhes longos vão para docs.
