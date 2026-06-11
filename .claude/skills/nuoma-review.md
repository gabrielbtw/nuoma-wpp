---
name: nuoma-review
description: Review Nuoma code changes for bugs, regressions, ownership violations, missing tests and operational risk. Findings first, with file/line evidence.
user_invocable: true
---

# /nuoma-review

Use code-review posture.

## Checklist

- Respect ownership in `AGENTS.md`.
- Look for behavioral regressions, data loss, race conditions and missing validation.
- Check API/DB contract changes before frontend/worker assumptions.
- Check worker/session changes against IC-1, IC-2 and real-send evidence rules.
- Prefer focused evidence over broad architecture recap.

## Output

Lead with findings ordered by severity. Use file paths and exact lines. If no issues, say so and note residual validation risk.
