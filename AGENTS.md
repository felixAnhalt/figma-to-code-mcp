# AGENTS.md — Figma-Context-MCP

TypeScript MCP server (`@tmegit/figma-to-code-mcp`). `get_figma_design` turns Figma REST data into a compact v3 design tree. `get_image_fills` and `render_node_images` are image helpers. `README.md` is loaded as an instruction file too, so keep it accurate.

## Commands

- Use `pnpm` 10.10.0. Node: `.nvmrc` says 20 and CI uses 20.17.0; the release job uses 24.
- Quality gate, in CI order (`.github/workflows/ci.yml`):

```bash
pnpm prettier --check "src/**/*.ts"   # CI checks formatting first; fix with `pnpm format`
pnpm lint                             # eslint . ; 0 errors, existing warnings (don't add `any`)
pnpm type-check                       # tsc --noEmit
pnpm test                             # vitest run, ~30 s, offline
```

- Single file or test: `pnpm vitest run src/tests/tokenizer.test.ts` or `pnpm vitest run -t "name"`.
- `pnpm build` (tsup + d.ts into `dist/`) is required before `pnpm start`. The OpenCode `figma-to-code` MCP runs `node dist/bin.js --stdio` (see `opencode.json`), so it serves the last build. After a change, rebuild and restart that MCP server.
- `pnpm dev` rebuilds on change and runs `node dist/bin.js` after each build (HTTP mode). `pnpm dev:cli` only rebuilds; it starts no server.
- `pnpm start` serves HTTP on `127.0.0.1:3333`. `pnpm start:cli` serves stdio.

## Testing

- Tests live only in `src/tests/`. Vitest has globals on, maps `~` to `src/`, and uses a 30 s timeout (`vitest.config.ts`).
- `tsconfig.json` excludes `src/tests/**`, so `pnpm type-check` and `pnpm build` do not check test files.
- Live suites are skipped unless gated by an env var. They load `.env` through dotenv themselves.
  - `RUN_FIGMA_INTEGRATION=1`: integration, batchFetchIntegration, liveOptimization, renderNodeImages. Needs `FIGMA_API_KEY` and `FIGMA_FILE_KEY`; some also need `FIGMA_NODE_ID`. liveOptimization rewrites fixtures in `src/tests/resources/`.
  - `RUN_FIGMA_RATE_LIMIT_PROBE=1`: liveRateLimit sends up to 400 real requests and spends Figma quota.
  - `RUN_BENCHMARK_TESTS=1`: outputValidation, which needs the local `src/tests/resources/testfigmaresult.json`.
- `src/tests/resources/` and `cache/` are gitignored. Only `src/tests/resources/.gitkeep` is tracked, so fixtures are local.
- `documentation.test.ts` fails if the README "## Available Tools" table differs from the tools `createServer` registers, or if the `get_figma_design` description loses terms such as `textRuns`, `svgViewport` or `borderWidths`. Change the README and the tool description together.
- The stdio and tool-discovery tests spawn `tsx src/bin.ts`, so they need no build.

## Architecture

Entry points:

- `src/bin.ts`: CLI. Loads `.env` from the cwd, then calls `startServer()`.
- `src/server.ts`: stdio when `--stdio` is in argv or `NODE_ENV=cli`. Otherwise Express serves `/mcp` (Streamable HTTP) and `/sse` + `/messages` (legacy SSE).
- `src/config.ts`: CLI flags and env vars, CLI wins. Exits unless `FIGMA_API_KEY` or `FIGMA_OAUTH_TOKEN` is set.
- `src/index.ts` (library API) and `src/mcpServer.ts` (`createServer`, `createServerFactory`, HTTP helpers) are the other tsup entries.

Directory ownership:

- `src/mcp/`: MCP protocol. `index.ts` `registerTools` always registers `get_figma_design`, and the image tools only when images are enabled. Tool objects live in `mcp/tools/`.
- `src/figma/`: Figma-to-design pipeline. `figma/mcp/` is pipeline code, not protocol code.
- `src/services/figmaConnector.ts`: `FigmaService`. Holds auth headers and some endpoints (`renderNodeImages`, `getImageFillUrls`, `getRawFile`, `getLocalVariables`).
- `src/utils/`: generic infrastructure. `httpClient.ts` adds rate limiting, 429 retries and a curl fallback.

Pipeline for `get_figma_design`:
`getFigmaDesignTool` → `generateMCPResponse` (`figma/mcp/index.ts`: fetch root node, component metadata, variables and comments → `buildNormalizedGraph` → `enrichDefinitions` → assets; cached 5 min in process memory) → `extractTokens` → `externalizeComponentSets` → YAML or JSON.

Gotchas:

- Figma REST calls go through `httpClient` or `httpClientRaw` (`utils/httpClient.ts`), which carries the rate limiter. Figma HTTP is currently spread over `figma/fetch.ts`, `figma/batchFetch.ts`, `figma/mcp/componentMap.ts` and `FigmaService`. Don't add raw `fetch` for Figma. The `api-consolidator` agent exists to move calls back into `FigmaService`.
- `~/figma/reducer` and `~/figma/tokenizer` resolve to the `.ts` file beside the same-named directory, not to the directory. `reducer.ts` holds `buildNormalizedGraph`. `tokenizer.ts` re-exports. Put new helpers in the directories. `figma/svg-writer.ts` re-exports `figma/svg/`.
- Not registered: `readVectorSvgTool` and `saveVectorSvgsTool` (`mcp/tools/readVectorSvgTool.ts`), and `registerVectorSvgResource` (`mcp/resources/`). Don't assume a `read_vector_svg` tool exists.
- In stdio mode stdout is the MCP channel. Use `Logger`, which writes to stderr unless `Logger.isHTTP` is set. Never `console.log` on a tool path. `config.ts` prints only when not in stdio.
- `writeLogs` writes `logs/*.json` only when `NODE_ENV=development`, which `pnpm dev` sets.
- The 5-minute design cache is per process. Repeated calls for the same node return the cached design, so restart the server after a rebuild before re-testing.
- To add a tool, follow the `mcp-tool-registration` skill, then update `src/mcp/index.ts` and the README table (see Testing).

## Conventions

Code, error-handling and test rules live in `.opencode/rules/*.md`, loaded through `opencode.json` `instructions`. Don't copy them here. Task skills live in `.opencode/skills/` (for example `mcp-tool-registration`, `figma-token-extraction`, `svg-vector-generation`, `release-process`).

## Git and release

- PRs target `main`, and CI runs on PRs to `main`.
- Pushing `main` runs release-please (`.github/workflows/release.yml`). It owns the version in `package.json` and `.release-please-manifest.json`, and the `CHANGELOG.md` entries. The release job rewrites the `server.json` version with jq. Don't hand-edit these.
- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`). release-please derives the version bump from them.
- `out/` is untracked and not gitignored. Stage files explicitly, never `git add -A`.
- `.env` holds a live `FIGMA_API_KEY`. Never print or commit it.

## Agents

Project subagents live in `.opencode/agents/`:

- Read-only: `architect`, `code-reviewer`, `figma-domain-expert`, `refactorer`.
- Can edit: `test-writer`, and `api-consolidator` (hidden, not in the `@` menu).

## Agent Scratchpad

Use this section here to note down general coding guidelines that you found useful. You can scribble down as much as you want, as long as you are writing it down short and concise.
