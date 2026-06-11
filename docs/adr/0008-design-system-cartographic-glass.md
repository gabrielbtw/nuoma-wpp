# ADR 0008 — Design System: Cartographic Operations + Liquid Glass selectivo

## Status

Aceita. Reconcilia direção visual após carregar skills `frontend-design` e `react-three-fiber` + ler [`.impeccable.md`](../../.impeccable.md).

## Contexto

Usuário pediu redesign "Liquid Glass" (estilo Apple visionOS/iOS 26). Mas:

1. `.impeccable.md` documenta brand direction "Cartographic Operations" (mapas topográficos, mission control, monospace).
2. Skill `frontend-design` alerta explicitamente contra glassmorphism em tudo: "blur effects, glass cards, glow borders used decoratively rather than purposefully".
3. Aplicar Liquid Glass em todas as superfícies do app vira "AI slop" — perde diferenciação ("what app is this?").

Há conflito aparente entre direção do user e direção documentada. Resolução: **combinar ambas com regras claras**.

## Decisão

V2 DS é **Cartographic Operations como base**, com **Liquid Glass aplicado selectivamente** apenas em camadas flutuantes/overlay.

### Cartographic Operations (base do app)

Aplica em: sidebar, header, cards de listagem, dashboard widgets, formulários, tabelas, página de auth, página de settings.

Características:

- **Borda de contorno** (`<Contour />`) — linhas duplas finas com 1-2px de gap, evocando contour lines de mapas topográficos.
- **Micro-grid backgrounds** (`<MicroGrid />`) — grid sutil 8px × 8px com opacity 0.02, fica de fundo em painéis operacionais.
- **Signal dots** (`<SignalDot status="active|idle|error|degraded" />`) — substitui Badge clássico em status pills. Pulse animation quando `active`.
- **Tipografia**: monospace para dados (números, IDs, telefones, métricas, timestamps); proporcional para UI text. Pareamento sugerido: **Berkeley Mono** (dados) + **Söhne** ou **GT America** (UI). NÃO Inter/Roboto.
- **Color coding**: emerald (#0D9488) = WhatsApp, amber (#F59E0B) = Instagram, blue (#0EA5E9) = system. Neutros em OKLCH tintados levemente para o blue (cohesion subliminar).
- **Sem gradientes purple→cyan**, sem glow neon, sem dark mode "AI dashboard" genérico.
- **Layout assimétrico** quando faz sentido — não centralização forçada.

### Liquid Glass (camadas flutuantes)

Aplica em: modais (`<Dialog>`), sheets (`<Sheet>`), command palette (`cmd+k`), popovers, dropdowns, toasts, embed overlay no WPP, tooltip, status pills sobre o mapa R3F.

Características:

- **Translucência hierárquica**: 3 níveis (`glass-1`, `glass-2`, `glass-3`) baseados em hierarquia de camada.
- **Backdrop blur**: 24px (`glass-modal`), 12px (`glass-floating`), 8px (`glass-tooltip`).
- **Borda especular**: `inset 0 1px 0 0 rgba(255,255,255,0.08)` topo + inverso na base.
- **Refração**: gradient sutil top-down `linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 50%)`.
- **Glow estado**: shadows coloridas (apenas em estados de sucesso/erro críticos, não decoração).
- **GSAP motion**: `power3.out` 240ms entrada, respeitando `prefers-reduced-motion`.

### Cartography 3D opcional (R3F)

Fase V2.14a (10 itens, opcional): mapa topográfico interativo no dashboard hero. Contatos como instancedMesh dots, campanhas como bezier curves, conversas como pulse signals. Performance via `<AdaptiveDpr>` + `<PerformanceMonitor>`. Fallback 2D SVG quando WebGL indisponível ou `prefers-reduced-motion`.

## Anti-patterns explicitamente proibidos

- Glass em todo card de dashboard (vira AI slop).
- Inter/Roboto/Open Sans (fontes overused).
- Pure black `#000` ou pure white `#fff` (sempre tintar).
- Gradients purple → cyan / cyan-on-dark (paleta AI genérica).
- Modais como default (usar progressive disclosure first).
- Card grids idênticos repetidos (mata diferenciação).
- Bounce/elastic easing (datado).
- Glow accent decorativo sem propósito.

## Consequências

- **Bom**: Identidade visual única ("what app is this?"), distinção clara entre superfície base e camadas flutuantes, performance preservada (glass só onde precisa).
- **Custo**: Designer/dev precisa internalizar a regra de "quando aplicar glass". Doc clara em `docs/design-system/V2_LIQUID_GLASS_TOKENS.md` e `docs/design-system/V2_CARTOGRAPHIC_TOKENS.md`.

## Referências

- [`.impeccable.md`](../../.impeccable.md)
- [docs/design-system/V2_CARTOGRAPHIC_TOKENS.md](../design-system/V2_CARTOGRAPHIC_TOKENS.md) (a ser criado)
- [docs/design-system/V2_LIQUID_GLASS_TOKENS.md](../design-system/V2_LIQUID_GLASS_TOKENS.md) (a ser criado)
- [docs/design-system/V2_R3F_CARTOGRAPHY.md](../design-system/V2_R3F_CARTOGRAPHY.md) (a ser criado)
- Skill `frontend-design` (carregada Abril 2026)
- Skill `react-three-fiber` (carregada Abril 2026)
