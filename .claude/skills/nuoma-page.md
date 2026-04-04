---
name: nuoma-page
description: Create or refactor a frontend page in the Nuoma web app. Follows existing patterns (TanStack Query, Tailwind, Radix UI, dark theme).
user_invocable: true
---

# /nuoma-page — Frontend Page Work

You are creating or refactoring a page in the Nuoma WPP React frontend.

## Context
- Pages live in `apps/web-app/src/client/pages/`
- Components in `apps/web-app/src/client/components/`
- UI primitives in `apps/web-app/src/client/components/ui/`
- Shared components in `apps/web-app/src/client/components/shared/`
- API layer in `apps/web-app/src/client/lib/api.ts`
- Types in `apps/web-app/src/client/lib/system-types.ts`
- Routing in `apps/web-app/src/client/app.tsx`

## Patterns to follow

### Data fetching
```tsx
const { data, isLoading } = useQuery({
  queryKey: ["entity-name"],
  queryFn: () => apiFetch<EntityType[]>("/api-endpoint"),
  refetchInterval: 15_000, // if real-time needed
});
```

### Mutations
```tsx
const qc = useQueryClient();
const mutation = useMutation({
  mutationFn: (data) => apiFetch("/endpoint", { method: "POST", body: toJsonBody(data) }),
  onSuccess: () => qc.invalidateQueries({ queryKey: ["entity-name"] }),
});
```

### Styling
- Dark theme: bg-[#0c0c0e] base, zinc/slate for surfaces
- Tailwind CSS classes only (no inline styles)
- Use existing UI components: Button, Badge, Card, Dialog, Input, Select, Switch
- Color tokens: cmm-blue (#007AFF), cmm-emerald (#10b981), cmm-purple (#8b5cf6), cmm-orange (#f59e0b)
- Glass-morphism: `glass-card` class for elevated surfaces

### Page structure
```tsx
export default function PageName() {
  return (
    <>
      <PageHeader eyebrow="Section" title="Page Title" description="..." />
      {/* page content */}
    </>
  );
}
```

## Steps
1. Read the existing page (if refactoring) or similar pages for patterns
2. Read related API routes to understand data shape
3. Implement the page following patterns above
4. Add route to `app.tsx` if new page
5. Validate: `npm run typecheck --workspace @nuoma/web-app`
