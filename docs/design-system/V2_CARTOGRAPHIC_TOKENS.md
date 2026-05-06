# V2 Cartographic Tokens

Status: implementado em 2026-05-04 em `packages/ui/src/tokens/index.ts`.
Atualizacao visual: 2026-05-06, com temas `Void Flow`, `Aurora` e `Ocean` em linguagem BotForge/lab.

## Direcao

O design system V2 usa uma base operacional BotForge/lab:

- fundos escuros com profundidade, textura e wash atmosferico;
- superficies glass/slab escuras com volume, sem brilho excessivo;
- micro-grid discreto para contexto operacional;
- dados em fonte mono;
- canais com cores fixas: WhatsApp emerald, Instagram amber, system blue;
- signal dots no lugar de badge pesado para estados operacionais.

## Temas

- `Void Flow`: padrao, escuro tecnico, compacto e sci-fi discreto.
- `Aurora`: escuro suave, acentos organicos e pouco brilho.
- `Ocean`: azul-petroleo escuro, calmo para sessoes longas.

Todos os temas sao dark. O seletor `dark/light/auto` foi removido.

## Regras

- Cards, shell e builder usam `botforge-surface`.
- Glow fica restrito a estado ativo, hover primario, conexoes e assistente.
- Evitar serifas, texto decorativo e piadas na UI final.
- Manter foco visivel por outline/ring simples, sem glow dominante.
