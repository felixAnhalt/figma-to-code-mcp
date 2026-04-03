# AGENTS.md — Figma-Context-MCP

Guidance for agentic coding agents operating in this repository.

---

## Agent Scratchpad

Use this section to note down general coding guidelines that you found useful. Keep notes short and concise.

---

## Commands

**Package manager:** `pnpm` (v10). Always use `pnpm`, never `npm` or `yarn`.

```bash
# Build & development
pnpm build                 # Production build via tsup
pnpm dev                   # Watch mode, restarts server on changes
pnpm dev:cli               # Watch mode in stdio/CLI mode

# Type checking & linting
pnpm type-check            # TypeScript check (no emit)
pnpm lint                  # ESLint check
pnpm format                # Prettier --write on src/**/*.ts

# Testing
pnpm test                                      # Run all tests
pnpm vitest run src/tests/tokenizer.test.ts    # Run single test file
pnpm vitest run -t "test name"                 # Filter by test name
```

Tests have 30-second timeout. Vitest globals (`describe`, `it`, `expect`, `beforeAll`, `afterAll`) are available without imports.

---

## Project Structure

```
src/
├── index.ts           # Public library API re-exports
├── bin.ts             # CLI entry point
├── server.ts          # HTTP/stdio server setup
├── config.ts          # CLI arg + env var parsing
├── mcp/               # MCP protocol layer (tool registration)
├── figma/             # Core business logic (data fetching, transformation)
├── services/          # FigmaService — REST API client
├── utils/             # Generic infrastructure (logger, fetch-with-retry)
└── tests/             # All tests (excluded from TS output)
```

**Key:** `figma/` owns business logic, `mcp/` owns protocol, `services/` owns HTTP, `utils/` is generic.

---

## Code Style

### Formatting (Prettier)

Double quotes, semicolons on, trailing commas everywhere, 2-space indent, 100-char line width.

### TypeScript

- **Strict mode:** On. Don't disable or work around strict checks.
- **Module system:** Pure ESM (`"type": "module"`, `bundler` resolution).
- **Node built-ins:** Use `node:` prefix: `import { randomUUID } from "node:crypto"`.
- **Return types:** Inferred (ESLint rule off). Always annotate parameters explicitly.
- **Type-only imports:** Use `import type` consistently.
- **Avoid `any`:** Use `unknown` and narrow. Lint warns on `any`.
- **`as const`:** Use on exported tool config objects to narrow literal types.

### Imports (ordering)

1. Node built-ins (`node:*`)
2. External packages
3. Internal aliases (`~/`)
4. Relative imports (`./`)

Use `~/` for cross-module imports. Use relative imports only within same directory.

### Naming Conventions

| Construct           | Convention           | Example                                        |
| ------------------- | -------------------- | ---------------------------------------------- |
| Functions/variables | `camelCase`          | `buildNormalizedGraph`                         |
| Types/Interfaces    | `PascalCase`         | `MCPResponse`, `V3Node`                        |
| Tool objects        | `{verb}Tool`         | `getFigmaDesignTool`                           |
| MCP tool names      | `snake_case`         | `"get_figma_design"`                           |
| File names          | `kebab-case`         | `get-figma-design-tool.ts`                     |
| Constants           | `UPPER_SNAKE_CASE`   | `const MAX_RETRIES = 3`                        |
| Methods             | Verbose, descriptive | `extractCurrentTaskDeltas` not `extractDeltas` |

### Error Handling

- Pattern: `error instanceof Error ? error.message : String(error)` — never cast `(error as Error)`.
- Tool handlers return `{ isError: true, content: [...] }` on failure; never throw.
- Use `Logger.error(...)` / `Logger.warn(...)` — no raw `console.error` outside `bin.ts`/`config.ts`.
- Empty `catch {}` only in cleanup paths where failure is acceptable.

### Functions & Constants

- Max ~20 lines of logic. Extract helpers rather than growing functions.
- No magic strings/numbers inline. Extract to named constants.
- No speculative abstractions. Every abstraction must earn its existence.

### Testing

- Test files in `src/tests/` (excluded from TS compilation).
- Use `it.fails(...)` to document known broken behavior.
- Prefer seam injection (params) over mocking frameworks.
- Vitest globals available; explicit imports from `"vitest"` also fine.

---

## Architecture & Best Practices

### Tool Object Pattern

```ts
export const myTool = {
  name: "tool_name", // snake_case MCP name
  description: "...",
  parametersSchema, // Zod schema (validation + MCP input schema)
  handler: myToolHandler, // async (params, figmaService, ...) => MCPResult
} as const;
```

### Key Principles

- **Separation of Concerns:** `figma/` = logic, `mcp/` = protocol, `services/` = HTTP, `utils/` = generic
- **Single Responsibility:** Each module has one reason to change
- **Dependency Inversion:** Inject deps as params (seam injection); no hardcoded dependencies
- **Composition over Inheritance:** Use plain objects, not class hierarchies
- **Tight Cohesion:** Related logic stays together (e.g., all token extraction in `tokenizer.ts`)
- **Immutability:** Use `const`, functional transforms; avoid mutations
- **Naming Intent:** Names reveal design. Descriptive names catch refactoring bugs
- **Fail Fast:** Validate at boundaries; descriptive errors via Logger

When a change touches multiple concerns, split into separate commits or PRs.
