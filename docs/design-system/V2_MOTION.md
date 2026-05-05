# V2 Motion

Status: implementado em 2026-05-04.

## Direcao

Movimento no V2 deve parecer operacional e preciso, nao decorativo:

- duracoes curtas;
- easing `ease-out-quart` ou spring contido;
- hover/tap sutis;
- sem animacoes constantes em cards de trabalho;
- signal dots podem respirar apenas para status ativo.

## Reduced Motion

`Animate`, `StaggerContainer`, `Button` e `SignalDot` respeitam `prefers-reduced-motion` via `framer-motion/useReducedMotion`.

Quando reduced motion esta ativo:

- wrappers de entrada renderizam sem transicao;
- hover/tap de botao nao desloca nem escala;
- `SignalDot active` fica estatico.

## Uso

- Use `Animate` para entrada de paginas e blocos principais.
- Use `StaggerContainer` apenas em listas curtas ou menus.
- Nao use motion para alterar layout de tabelas densas.
- Nao use loops infinitos exceto em `SignalDot active`.

