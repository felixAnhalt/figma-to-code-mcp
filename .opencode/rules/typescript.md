# TypeScript Conventions

## Strict mode

- **Strict mode:** ON. Never disable or work around strict checks.
- **Module system:** Pure ESM (`"type": "module"`, `bundler` resolution in tsconfig).
- **Node built-ins:** Use `node:` prefix: `import { randomUUID } from "node:crypto"`.
- **Return types:** Inferred (ESLint rule off). Always annotate parameters explicitly.
- **Type-only imports:** Use `import type` consistently for types only used at compile time.
- **Avoid `any`:** Use `unknown` and narrow. ESLint warns on `any`.
- **`as const`:** Use on exported tool config objects to narrow literal types.

## Imports ordering

1. Node built-ins (`node:*`)
2. External packages
3. Internal aliases (`~/`)
4. Relative imports (`./`)

Use `~/` for cross-module imports. Use relative imports only within same directory.

## Naming

| Construct           | Convention           | Example                                        |
| ------------------- | -------------------- | ---------------------------------------------- |
| Functions/variables | `camelCase`          | `buildNormalizedGraph`                         |
| Types/Interfaces    | `PascalCase`         | `MCPResponse`, `V3Node`                        |
| Tool objects        | `{verb}Tool`         | `getFigmaDesignTool`                           |
| MCP tool names      | `snake_case`         | `"get_figma_design"`                           |
| File names          | `kebab-case`         | `getFigmaDesignTool.ts`                        |
| Constants           | `UPPER_SNAKE_CASE`   | `const MAX_RETRIES = 3`                        |
| Method names        | Verbose, descriptive | `extractCurrentTaskDeltas` not `extractDeltas` |

## Formatting (Prettier)

Double quotes, semicolons on, trailing commas everywhere, 2-space indent, 100-char line width.
