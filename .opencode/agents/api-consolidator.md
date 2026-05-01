---
description: Consolidates scattered Figma API calls into FigmaService. Not in the @ autocomplete — invoked programmatically by primary agents.
mode: subagent
hidden: true
permission:
  edit: allow
  bash:
    "pnpm type-check*": allow
    "pnpm lint*": allow
    "pnpm test*": allow
---

You consolidate Figma REST API calls back into the canonical service layer.

## Rule

**All Figma REST API calls must route through `FigmaService` in `src/services/figmaConnector.ts`.** No other file may construct `https://api.figma.com/v1/...` URLs or call `httpClient()`/`httpClientRaw()` for Figma endpoints.

## Known violations to fix

| File                            | Functions                                                                   | What to do                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/figma/fetch.ts`            | `fetchStyles()`, `fetchComponents()`, `fetchVariables()`, `fetchComments()` | Move each as a method on `FigmaService`. They all follow the same `this.request()` pattern. |
| `src/figma/batchFetch.ts`       | `fetchNodesBatch()`                                                         | Move to `FigmaService.getNodesBatch()` or merge into `getRawNode()`                         |
| `src/figma/mcp/componentMap.ts` | component resolution + library fetch                                        | Move to `FigmaService.resolveComponentFileKey()` and `FigmaService.getComponents()`         |

## Migration pattern

Before (`fetch.ts`):

```ts
const url = `https://api.figma.com/v1/files/${fileKey}/styles`;
return httpClient(url, { headers: authHeaders });
```

After (`figmaConnector.ts`):

```ts
async getStyles(fileKey: string): Promise<GetStylesResponse> {
  return this.request(`/files/${fileKey}/styles`);
}
```

## Process

1. Add the method to `FigmaService`
2. Update all callers to use `figmaService.methodName()` instead of the standalone function
3. Remove the old function (and file if empty)
4. Update `src/figma/index.ts` exports
5. Run `pnpm type-check && pnpm lint && pnpm test`
