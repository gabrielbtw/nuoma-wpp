# Motion

Data: 2026-06-12

## Direção

Motion na V2 é funcional e discreto. O objetivo é orientar estado, foco e
progresso sem transformar telas operacionais em peça editorial.

## Regras

- Respeitar `prefers-reduced-motion`.
- Preferir transições CSS curtas para hover, focus, expansão e entrada de
  painel.
- Não usar glow/orb/bokeh como feedback principal.
- Em listas grandes, não animar altura nem layout de muitos itens.
- Em canvas/FlowBuilder, zoom/pan deve parecer ferramenta, não hero animation.
- Overlay WhatsApp mantém rAF/brand animation existente, mas sem gradiente ou
  blur pesado.

## Durações

- Hover/focus: 120-180ms.
- Sheet/drawer/popover: 160-240ms.
- Toast/status: 180-260ms.
- Skeleton/loading: suave, sem loop chamativo; desligar em reduced motion.

## Tokens e implementação

- Usar tokens `nw-*` para cor, superfície, linha e foco.
- Framer Motion pode ser usado quando já estiver no fluxo do componente.
- CSS puro é preferível para estados simples.
- GSAP não deve entrar em UI operacional nova sem justificativa objetiva.

## Validação

- Conferir desktop e mobile.
- Checar console sem warnings de animação/layout.
- Confirmar que texto não clippa durante entrada/saída.
- Testar com reduced motion quando o fluxo for crítico.
