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

## Signal Room Rebuild (2026-07-09)

A interface web passou por uma reconstrucao visual transversal com a direcao
**Signal Room**: grafite mineral, tipografia editorial apenas para hierarquia,
chrome silencioso e cobre reservado para intencao do operador. A leitura de
dados, estados e canais continua sendo a prioridade.

- `apps/web/src/styles/pages/rebuild.css` e carregado por ultimo em
  `apps/web/src/styles.css`. Ele unifica shell, login, dashboard, Inbox,
  contatos, administracao e Flow Builder sem trocar rotas, contratos, test ids
  ou logica de produto.
- `apps/web/src/styles/tokens.css` e `packages/ui/src/tokens/index.ts` mantem
  os mesmos valores de superficie, tinta, status, canais e graficos.
- Componentes compartilhados preservam suas APIs; somente a pele interna de
  `Button`, `Input`, `Card`, `Badge`, `Tabs` e `DataTable` foi atualizada.
- Os aliases `bg-*`, `fg-*`, `semantic-*` e `nuoma-*` permanecem durante a
  migracao. Nao remover `legacy.css` ou `compat-workspaces.css` ate que todos
  os consumidores tenham sido migrados por rota.

Principios de aplicacao:

- Cobre identifica acao primaria e foco; nao deve virar cor decorativa de
  metricas.
- Verde, amarelo, vermelho e azul representam apenas estados operacionais.
- WhatsApp e Instagram usam apenas `--nw-channel-wa` e `--nw-channel-ig`.
- Cards agrupam decisao e contexto; listas, tabelas e timelines carregam a
  maior parte da informacao operacional.
- O Flow Builder continua em modo canvas escuro, isolado do chrome comum.

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
