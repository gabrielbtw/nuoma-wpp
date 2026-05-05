# V2 Cartographic Tokens

Status: implementado em 2026-05-04 em `packages/ui/src/tokens/index.ts`.

## Direcao

O design system V2 usa uma base operacional cartografica:

- fundos azul-esverdeados escuros, sem preto puro;
- superficies flat com borda/contorno, sem efeito neumorphic;
- micro-grid discreto para contexto operacional;
- dados em fonte mono;
- canais com cores fixas: WhatsApp emerald, Instagram amber, system blue;
- signal dots no lugar de badge pesado para estados operacionais.

## Regras

- Cards de listagem e dashboard ficam flat/contour, nao glass.
- Glass/lift fica restrito a overlays: dialog, sheet, command palette, popover e toast.
- Evitar orbs, bokeh, gradientes purple/cyan e decoracao generica.
- Manter foco visivel por outline/ring simples, sem glow borrado dominante.

