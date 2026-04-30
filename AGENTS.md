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

(Keep this up-to-date in AGENTS.md when changes occur)

**Key:** `figma/` owns business logic, `mcp/` owns protocol, `services/` owns HTTP, `utils/` is generic.

---

## Code Style

> Detailed conventions (TypeScript, error handling, testing patterns) are loaded from `.opencode/rules/` via `opencode.json`. Below is the quick-reference naming table and non-negotiable structural rules.

### Naming Conventions

| Construct           | Convention           | Example                                        |
| ------------------- | -------------------- | ---------------------------------------------- |
| Functions/variables | `camelCase`          | `buildNormalizedGraph`                         |
| Types/Interfaces    | `PascalCase`         | `MCPResponse`, `V3Node`                        |
| Tool objects        | `{verb}Tool`         | `getFigmaDesignTool`                           |
| MCP tool names      | `snake_case`         | `"get_figma_design"`                           |
| File names          | `kebab-case`         | `getFigmaDesignTool.ts`                        |
| Constants           | `UPPER_SNAKE_CASE`   | `const MAX_RETRIES = 3`                        |
| Methods             | Verbose, descriptive | `extractCurrentTaskDeltas` not `extractDeltas` |

### Non-negotiable

- Max ~20 lines of logic. Extract helpers rather than growing functions.
- No magic strings/numbers inline. Extract to named constants.
- No speculative abstractions. Every abstraction must earn its existence.
- Errors: never cast `(error as Error)` — use `error instanceof Error ? error.message : String(error)`.
- Tool handlers: return `{ isError: true, content: [...] }` on failure; never throw.
- Test files go in `src/tests/`. Prefer seam injection over mocking. Vitest globals are available.

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

---

## Agents & Delegation

This project ships custom OpenCode subagents in `.opencode/agents/`. Delegate to them when appropriate:

| Agent                        | When to invoke                                                                                                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@architect`                 | New feature needs placement advice or you're unsure which module owns the change. Invoke BEFORE writing code.                                                                 |
| `@code-reviewer`             | After completing a significant change. It reads the diff and checks against project conventions.                                                                              |
| `@figma-domain-expert`       | Questions about Figma API behavior, rate limits, token extraction, SVG generation, or the data pipeline. Read-only.                                                           |
| `@test-writer`               | Need to write or update tests. It knows vitest setup, file placement, seam injection patterns, and integration test gates.                                                    |
| `@refactorer`                | Scout for structural issues (SoC violations, dead code, duplication, magic values, oversized methods) and report them as prioritized opportunities. Does NOT execute changes. |
| `@api-consolidator` (hidden) | Move Figma API calls from scattered files back into `FigmaService`. Invoked programmatically, not in `@` menu.                                                                |
