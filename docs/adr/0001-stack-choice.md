# ADR 0001 - Stack choice

## Status

Accepted for V2.1 foundations.

## Decision

Use Node 22, npm workspaces, Fastify, React 19, Vite 7, Tailwind 3, Radix,
better-sqlite3, Drizzle ORM, Zod and Playwright + CDP.

Bun, Hono, tRPC-first, Tailwind 4 and a full router/design-stack swap stay out
of the initial V2 because they do not reduce the main product risk: WhatsApp
Web and Chromium state.

## Consequences

- V2 can share operational knowledge with V1.
- Drizzle is the main new persistence layer.
- npm is the workspace/package-manager baseline until there is a concrete
  reason to change.
