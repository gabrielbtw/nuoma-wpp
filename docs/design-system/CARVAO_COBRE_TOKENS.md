# Carvao & Cobre Tokens

Carvao & Cobre e a direcao visual atual da web canonica e do overlay WhatsApp.

## Fonte De Verdade

- Web: `apps/web/src/styles/tokens.css`.
- UI package: `packages/ui/src/tailwind/preset.ts` e `packages/ui/src/tokens/index.ts`.
- Overlay: tokens locais `--nwo-*` dentro de
  `apps/worker/src/features/overlay/inject.ts`, preservando isolamento por
  Shadow DOM.

## Papeis Canonicos

| Papel            | Uso                         |
| ---------------- | --------------------------- |
| `--nw-surface-*` | fundos e superficies        |
| `--nw-ink-*`     | texto e icones              |
| `--nw-accent*`   | acoes primarias cobre       |
| `--nw-line-*`    | bordas e hairlines          |
| `--nw-status-*`  | ok, warn, error, info       |
| `--nw-channel-*` | WhatsApp, Instagram, system |
| `--nw-chart-*`   | graficos                    |

## Overlay

O overlay usa prefixo `--nwo-*` para evitar vazamento de tokens da pagina
host. Valores atuais:

- `--nwo-surface-0: #0E0D0B`
- `--nwo-surface-1: #151311`
- `--nwo-surface-2: #201D19`
- `--nwo-ink-strong: #F5F2EC`
- `--nwo-accent: #E8642C`
- `--nwo-accent-hover: #FF7A45`
- `--nwo-line: #2A2621`

Diretriz visual da Fase 5:

- FAB flat, radius 10, marca cobre e dot de status por
  `data-nuoma-visual-state`.
- Painel solido com hairline, sem vidro/glow e com foco em cobre.
- Ações primarias usam cobre com texto escuro; ações secundarias ficam ghost
  com hairline.
- Header do painel sempre mostra produto (`NUOMA CRM`), titulo/nome e telefone
  mono quando detectado.

## Gate De Qualidade

Antes de fechar a Fase 1:

```bash
rg -n -i 'botforge|orielo' apps/web/src packages/ui/src
rg -n -i 'brand-|flow-v2' apps/web/src packages/ui/src
rg -n -P '#[0-9A-Fa-f]{3,8}\b|\brgba?\((?!var\(--nw-)' apps/web/src packages/ui/src
npm run typecheck --workspace @nuoma/ui
npm run typecheck --workspace @nuoma/web
npm run build --workspace @nuoma/web
```
