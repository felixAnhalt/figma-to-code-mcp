---
description: Runs type-check, lint, and tests. Reports pass/fail and triages failures.
agent: build
---

Run the complete quality gate for this project:

1. `pnpm type-check` — TypeScript compilation check
2. `pnpm lint` — ESLint check
3. `pnpm test` — Full test suite

Report each step's status (pass/fail). For any failures:

- Type errors: explain the root cause and suggest the fix
- Lint errors: show the violation and the relevant convention
- Test failures: show which test failed, the assertion, and the likely cause

If all three pass, confirm "QA gate: all clear".
