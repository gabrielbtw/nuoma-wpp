---
name: nuoma-component
description: Create or modify a shared React component following Nuoma design patterns (Tailwind, Radix UI, dark theme, glass-morphism).
user_invocable: true
---

# /nuoma-component — Shared Component Work

You are creating or modifying a shared component in Nuoma WPP.

## Context
- Shared components: `apps/web-app/src/client/components/shared/`
- UI primitives: `apps/web-app/src/client/components/ui/`
- Feature components: `apps/web-app/src/client/components/{feature}/`

## Existing UI primitives
- `Button` — CVA variants: default, secondary, ghost, outline, danger
- `Badge` — Tones: success, warning, danger, info, default
- `Card` — CardContent, CardHeader, CardTitle
- `Dialog` — Modal (Radix Dialog)
- `Input` — Text input with focus ring
- `Textarea` — Multi-line input
- `Select` — Native select styled
- `Switch` — Toggle (Radix Switch)
- `ChromeTabs` — Tab interface

## Existing shared components
- `PageHeader` — eyebrow, title, description, actions slot
- `ChannelSessionStrip` — WA/IG connection status
- `ErrorPanel` — Error display
- `ConfirmActionDialog` — Destructive action confirmation
- `ContactHistoryPanel` — Conversation history
- `ChannelIndicators` — Channel icons (WA/IG)

## Design tokens
```
Colors:
  cmm-blue: #007AFF (primary)
  cmm-emerald: #10b981 (success)
  cmm-purple: #8b5cf6 (automation/contacts)
  cmm-orange: #f59e0b (warning)

Background: #0c0c0e
Surfaces: zinc-800/900, slate-800/900
Borders: zinc-700/800

Fonts: "SF Pro Display", "SF Pro Text", Inter (fallback)
Border radius: rounded-2xl (default), rounded-3xl (large)
```

## Glass-morphism pattern
```tsx
<div className="glass-card rounded-2xl border border-white/5 p-6">
  {/* content */}
</div>
```

## Component pattern
```tsx
interface MyComponentProps {
  value: string;
  onChange: (value: string) => void;
}

export function MyComponent({ value, onChange }: MyComponentProps) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-4">
      {/* content */}
    </div>
  );
}
```

## Steps
1. Check if a similar component already exists
2. Follow existing patterns and design tokens
3. Use Radix UI primitives when interactive behavior is needed
4. Keep components focused and composable
5. Validate: `npm run typecheck --workspace @nuoma/web-app`
