# V2 Component Inventory

Status: inventario inicial em 2026-05-04.

## Primitives

- `Surface`: painel base flat/contour, variantes `raised`, `pressed`, `flat`, `floating`.
- `Glass`: alias permitido apenas para overlays flutuantes.
- `Contour`: wrapper de contorno para areas operacionais.
- `MicroGrid`: textura cartografica para shell, login e contextos de mapa.
- `SignalDot`: estado operacional `active`, `idle`, `error`, `degraded`.

## Controls

- `Button`: 6 variantes, 4 tamanhos, loading e icones.
- `Input`, `Textarea`.
- `Select`.
- `Switch`, `Checkbox`, `RadioGroup`/`RadioItem`.

## Overlays

- `Dialog`.
- `Sheet`.
- `Popover`.
- `Tooltip`.
- `DropdownMenu`.

Overlays podem usar glass/lift; cards e listas nao.

## Display

- `Card`: flat contour tile.
- `Badge`.
- `Avatar`.
- `Tabs`.
- `Accordion`.
- `EmptyState`, `ErrorState`, `LoadingState`.
- `TimeAgo`.
- `ChannelIcon`.

## Feedback, Theme e Utils

- `ToastProvider`/`useToast`: toast flutuante com `role=status`.
- `ThemeProvider`/`useTheme`: preferencia `dark`, `light`, `auto`, persistida em `localStorage`.
- `Animate`, `StaggerContainer`: motion wrapper com suporte a reduced motion.
- `KeyboardShortcut`.
- `VisuallyHidden`.
- `cn`.

## Previews

`/dev/components` renderiza o inventario visual em desenvolvimento.

