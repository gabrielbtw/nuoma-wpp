---
name: nuoma-review
description: Review code changes in Nuoma WPP for quality, ownership compliance, security, and architectural alignment.
user_invocable: true
---

# /nuoma-review — Code Review

You are reviewing code changes in Nuoma WPP.

## Review checklist

### 1. Ownership compliance
- Does each change respect the agent ownership model? (see AGENTS.md)
- Are cross-layer changes split into proper handoff steps?
- Is `core-api` defining contracts before consumers adapt?

### 2. Architecture alignment
- Does the change follow existing patterns?
- Are new abstractions justified?
- Is the change small, reversible, and testable?
- No unnecessary dependencies added?

### 3. Database
- New columns have sensible defaults?
- Indexes added for frequently queried columns?
- Migration is idempotent (`IF NOT EXISTS`)?
- No breaking changes to existing tables?

### 4. API routes
- Input validated with Zod schema?
- Proper HTTP status codes?
- Error handling follows existing patterns?
- No SQL injection vectors (parameterized queries)?

### 5. Frontend
- Uses existing UI components (Button, Badge, Card, Dialog)?
- Follows dark theme / Tailwind patterns?
- Data fetching via TanStack Query (not raw fetch)?
- Proper loading/error states?
- No duplicate types (uses domain types from core)?

### 6. Security
- No command injection in Bash/exec calls?
- No XSS vectors in rendered content?
- No SQL injection (parameterized queries)?
- Sensitive data not logged or exposed?
- File uploads validated (type, size)?

### 7. Performance (5k-50k contacts context)
- SQLite queries indexed properly?
- No N+1 query patterns?
- Pagination on list endpoints?
- No full table scans on hot paths?

## Steps
1. Read the git diff: `git diff` or `git diff --staged`
2. Identify affected layers and ownership
3. Run through checklist above
4. Run validation:
   ```bash
   npm run typecheck
   npm run hygiene
   npm test
   ```
5. Provide feedback organized by severity (blocking / suggestion / nitpick)
