# ADR 0011 — R3F Cartographic Hero (opcional, V2.14a)

## Status

Aceita como **opcional**. Pode ser adiada se cronograma apertar.

## Contexto

Skill `react-three-fiber` carregada explicitamente pelo user. `.impeccable.md` documenta brand direction "Cartographic Operations" (mapas topográficos, mission control). Combinação natural: dashboard hero com mapa topográfico 3D interativo.

Diferenciação visual concreta — uma pessoa olha e pergunta "what app is this?" (objetivo declarado da brand direction).

## Decisão

Adicionar **Fase V2.14a** (10 itens, opcional, executar em paralelo com Fase 14 se houver capacidade):

- Componente `<TopographicMap />` no dashboard usando `@react-three/fiber` + `@react-three/drei`.
- **Camadas**:
  1. **Terrain**: contour lines via shader simplex noise — animação sutil de "respirar" (velocity 0.0001).
  2. **Contatos**: instancedMesh dots posicionados por distrito/cluster (clustering em background, 50k pontos sem perder fps via instancing).
  3. **Campanhas**: bezier curves animadas entre clusters com `dashOffset` indicando progresso.
  4. **Conversas ativas**: signal pulse (sphere com expansão + fade) em locais com mensagem nas últimas 5min.
- **Interatividade**: OrbitControls com damping leve (constraint vertical pra não permitir rotação caótica).
- **Performance**:
  - `<AdaptiveDpr pixelated />` reduz DPR sob pressão.
  - `<PerformanceMonitor>` desliga camadas (signal pulse → contour) se fps < 30.
  - `frameloop="demand"` quando aba não foco.
- **Fallback 2D**: SVG topo lines + CSS dots quando WebGL indisponível ou `prefers-reduced-motion: reduce`.

## Consequências

- **Bom**: Diferenciação visual marcante. Reforça brand direction. Tech showcase honesto.
- **Custo**: 10 itens (~1 sprint). Three.js bundle adiciona ~150KB gzipped (lazy-loaded só na rota /).
- **Risco**: WebGL pode falhar em devices low-end. Mitigado por fallback 2D + adaptive DPR.

## Anti-patterns evitados (lição do skill `frontend-design`)

- NÃO usar 3D em todo lugar (só dashboard hero, opcional).
- NÃO fazer 3D decorativo sem propósito — cada elemento (terrain, dots, curves, pulses) representa **dado real**.
- NÃO usar particle systems aleatórios "pra ficar bonito".
- NÃO usar bloom/post-processing exagerado ("AI dashboard glow").

## Alternativas

- Sem 3D: viável, dashboard fica em SVG topo + cards. Perde wow factor mas ship antes.
- Mapbox/MapLibre real: descartada — overkill, dependência grande, geocoding caro, e usuário não tem coordenadas reais dos contatos (CEPs aproximados no melhor caso).
- 2D canvas custom (sem R3F): viável mas R3F + Drei dão `OrbitControls`, `<AdaptiveDpr>`, `<Detailed>` LOD prontos.

## Referências

- Skill `react-three-fiber` em `/Users/gabrielbraga/.claude/skills/react-three-fiber/`
- Roadmap V2.14a (10 itens)
- [docs/design-system/V2_R3F_CARTOGRAPHY.md](../design-system/V2_R3F_CARTOGRAPHY.md) (a ser criado)
