# Sora Web Plus Shotlist

Fluxo manual para gerar o video no Sora web com conta ChatGPT Plus, assumindo limite pratico de `10s`, `480p` e `1` geracao simultanea.

## Configuracao recomendada

- Aspect ratio: `16:9`
- Resolution: `480p`
- Duration: `10s`
- Variations: `1` por vez
- Style/Preset: `none`
- Storyboard: `optional`

## Ordem de trabalho

1. Gerar cada cena separadamente no compositor normal.
2. Se uma cena sair quase certa, usar `Remix` em vez de reescrever do zero.
3. Depois de aprovar todas, usar `Stitch` para costurar os clipes.
4. Se precisar, fazer um corte final fora do Sora para reduzir de `60s` para `56s`.

## Cena 1

```text
Use case: institutional explainer video for a local SaaS platform
Primary request: premium abstract opening shot presenting Nuoma WPP as a unified operating system for CRM, inbox, automations, campaigns and observability
Scene/background: dark cinematic product studio with floating architectural panels and volumetric depth, no real people, no logos
Subject: abstract luminous modules for CRM, inbox, automations, campaigns and observability converging into one central platform core
Action: separate modules appear, align with precision, and lock into a single central hub by the end of the shot
Camera: slow dolly-in, 24mm, stable cinematic movement
Lighting/mood: controlled high-contrast tech lighting, confident, institutional
Color palette: petrol blue, graphite, cyan, amber
Style/format: premium product motion graphics, abstract SaaS explainer, not a literal app screen
Audio: subtle technological ambience, clear Brazilian Portuguese voiceover, no visible narrator
Dialogue:
<dialogue>
- Narrador: "Nuoma WPP centraliza CRM, automacoes e operacao do WhatsApp Web em uma unica base."
</dialogue>
Constraints: no real people, no logos, no readable interface text, no literal WhatsApp UI
Avoid: flicker, jitter, malformed letters, crowded composition
```

## Cena 2

```text
Use case: institutional explainer video for a local SaaS platform
Primary request: show the web application as a premium dashboard that reorganizes into a three-column inbox
Scene/background: elegant dark UI studio with floating information cards and layered panels, abstract rather than literal product UI
Subject: premium dashboard cards, conversation stacks and contextual side panels representing the web app
Action: a high-level dashboard smoothly transforms into a clear three-column inbox layout
Camera: smooth lateral slide, 35mm
Lighting/mood: polished digital studio lighting, precise and operational
Color palette: midnight navy, graphite, cyan, soft amber
Style/format: cinematic product interface motion graphics, no literal screenshots
Audio: subtle technological ambience, clear Brazilian Portuguese voiceover, no visible narrator
Dialogue:
<dialogue>
- Narrador: "Na web, dashboard e inbox organizam contatos, conversas e contexto em tempo real."
</dialogue>
Constraints: no real people, no logos, no readable interface text, no literal WhatsApp UI
Avoid: tiny text, flicker, jitter, cluttered layout
```

## Cena 3

```text
Use case: institutional explainer video for a local SaaS platform
Primary request: represent the CRM module as an elegant relational map of contacts, tags and interaction history
Scene/background: top-down technical composition over a dark premium surface with layered cards and luminous connection lines
Subject: contact dossiers, tag markers, relationship paths and message history shown as abstract CRM objects
Action: contact cards appear, tags connect, and a coherent relationship map resolves clearly
Camera: top-down with gentle tilt and slow drift
Lighting/mood: calm, precise, trustworthy
Color palette: deep graphite, muted teal, silver blue, amber accents
Style/format: premium abstract data storytelling, cinematic motion graphics
Audio: subtle technological ambience, clear Brazilian Portuguese voiceover, no visible narrator
Dialogue:
<dialogue>
- Narrador: "O modulo de contatos mantem historico, tags e visao completa de cada relacionamento."
</dialogue>
Constraints: no real people, no logos, no readable interface text
Avoid: busy composition, fast motion, malformed letters
```

## Cena 4

```text
Use case: institutional explainer video for a local SaaS platform
Primary request: show automations and campaigns as controlled operational flows with rules, timing windows and workflow blocks
Scene/background: dark technical stage with rule nodes, timing gates, connected workflow blocks and luminous path lines
Subject: automation logic, sending windows, follow-up triggers and campaign workflow blocks shown abstractly
Action: the flow lights up step by step, gates open in sequence, then the full campaign logic settles into one readable system
Camera: locked-off composition with minimal parallax
Lighting/mood: disciplined, operational, high-control
Color palette: deep navy, graphite, cyan, amber
Style/format: cinematic workflow visualization, premium SaaS operations film
Audio: subtle technological ambience, clear Brazilian Portuguese voiceover, no visible narrator
Dialogue:
<dialogue>
- Narrador: "Automacoes e campanhas aplicam regras, janelas de envio, cadencia e processamento com controle operacional."
</dialogue>
Constraints: no real people, no logos, no readable interface text
Avoid: chaotic branching, flicker, jitter, camera shake
```

## Cena 5

```text
Use case: institutional explainer video for a local SaaS platform
Primary request: present the operational backbone with worker, scheduler, health signals and observability
Scene/background: premium technical operations chamber with browser silhouette, scheduler tracks, health cards and streaming logs
Subject: abstract browser runtime, scheduler cycle, health indicators and observability trails working together
Action: the runtime pulses alive, scheduler tracks synchronize, health cards stabilize and log streams settle into a controlled state
Camera: steady push-in, medium wide framing
Lighting/mood: resilient, technical, incident-ready
Color palette: dark graphite, steel blue, cyan, warning amber accents
Style/format: cinematic infrastructure motion graphics, abstract observability film
Audio: subtle technological ambience, clear Brazilian Portuguese voiceover, no visible narrator
Dialogue:
<dialogue>
- Narrador: "Worker, scheduler e observabilidade mantem sessao, execucao continua e resposta rapida a falhas."
</dialogue>
Constraints: no real people, no logos, no readable interface text, no literal browser brand
Avoid: alarm overload, chaotic log noise, flicker, malformed letters
```

## Cena 6

```text
Use case: institutional explainer video for a local SaaS platform
Primary request: close with imports, trends and assisted integrations entering as a side track while the full platform resolves as one governed architecture
Scene/background: elevated abstract system panorama with import rails, trend signals and assisted modules orbiting the central platform
Subject: side-track integrations connecting to the main operating core without overtaking it
Action: integration modules enter from the side, connect cleanly, then the camera pulls back to reveal the complete platform architecture
Camera: aerial pull-back, smooth and calm
Lighting/mood: expansive, confident, architectural
Color palette: midnight blue, graphite, cyan, amber, silver highlights
Style/format: premium system finale, abstract architectural visualization
Audio: subtle technological ambience, clear Brazilian Portuguese voiceover, no visible narrator
Dialogue:
<dialogue>
- Narrador: "Com imports, tendencias e integracoes assistidas, a plataforma evolui sem perder governanca arquitetural."
</dialogue>
Constraints: no real people, no logos, no readable interface text, integrations remain secondary to the main platform
Avoid: clutter, chaotic data motion, marketing-style exaggeration
```

## Prompts de Remix

UI com texto quebrado:

```text
Same shot and same camera move. Replace any readable UI text or lettering with abstract interface cards only. Keep composition, lighting, palette and module identity unchanged.
```

Narracao corrida:

```text
Same shot and same camera move. Keep the visuals unchanged. Make the Brazilian Portuguese voiceover slower, clearer and more intelligible, with the voice louder in the mix.
```

Movimento caotico:

```text
Same shot and same camera move. Reduce motion intensity and simplify the action to one clear visual gesture. Keep framing, lighting and palette unchanged.
```
