# Testing Conventions

## vitest setup

- Config: `vitest.config.ts` — 30s timeout, `~` alias, globals enabled
- Test framework: vitest v4
- Globals available without imports: `describe`, `it`, `expect`, `beforeAll`, `afterAll`

## File placement

- All tests go in `src/tests/` (excluded from TS compilation via `tsconfig.json`)
- Test fixtures go in `src/tests/resources/` (gitignored — add to `.gitignore` if needed)

## Running tests

```bash
pnpm test                                      # Run all tests
pnpm vitest run src/tests/tokenizer.test.ts    # Run single test file
pnpm vitest run -t "test name"                 # Filter by test name
```

## Testing patterns

### Seam injection (preferred over mocking frameworks)

```ts
import { myFunction } from "~/figma/myModule";

it("processes data correctly", () => {
  const stubService = { fetch: async () => mockData };
  const result = myFunction(input, stubService);
  expect(result).toEqual(expected);
});
```

### Integration test gates

Tests requiring live Figma API access:

```ts
it("fetches from live API", () => {
  if (!process.env.RUN_FIGMA_INTEGRATION) return;
  // real API call
});
```

Gate env vars: `RUN_FIGMA_INTEGRATION`, `RUN_BENCHMARK_TESTS`

### Documenting known broken behavior

```ts
it.fails("does not handle negative values", () => {
  handleNegative(-1);
});
```

## Style

- Use `describe`/`it` blocks with descriptive names
- One assertion concept per `it`
- Use `beforeAll`/`afterAll` for setup/teardown only
- No `any` in test code — use proper types or `unknown`
- Import from `"vitest"` only when explicitly needed (e.g., `import { vi } from "vitest"`)
