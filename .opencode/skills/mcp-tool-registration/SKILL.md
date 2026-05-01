---
name: mcp-tool-registration
description: How to register new MCP tools — tool object pattern, Zod schemas, handler conventions, and conditional registration.
---

## What I do

I know the MCP tool registration conventions in this codebase.

## Tool object pattern

Every tool is a const object with this shape (from `src/mcp/tools/getFigmaDesignTool.ts`):

```ts
export const myTool = {
  name: "tool_name", // snake_case MCP name
  description: "...", // brief description
  parametersSchema, // Zod schema (validation + MCP input schema)
  handler: myToolHandler, // async (params, figmaService, ...) => MCPResult
} as const;
```

## Zod schema pattern

```ts
const parametersSchema = z.object({
  fileKey: z
    .string()
    .regex(/^[a-zA-Z0-9]+$/, "File key must be alphanumeric")
    .describe("The key of the Figma file..."),
  optionalParam: z.number().optional().describe("..."),
});
export type MyToolParams = z.infer<typeof parametersSchema>;
```

## Handler conventions

```ts
async function handler(params, figmaService, ...) {
  try {
    const validated = parametersSchema.parse(params);
    // business logic
    return { content: [{ type: "text", text: result }] };
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    Logger.error("Context:", message);
    return { isError: true, content: [{ type: "text", text: `Failed: ${message}` }] };
  }
}
```

Rules:

- Validate params with `parametersSchema.parse(params)` at entry
- Return `{ content: [...] }` on success
- Return `{ isError: true, content: [...] }` on failure
- Never throw — always catch and return error shape
- Log with `Logger.error/warn/log` — no raw `console.error`

## Registration (in `src/mcp/index.ts`)

```ts
server.registerTool(
  myTool.name,
  {
    title: "My Tool",
    description: myTool.description,
    inputSchema: myTool.parametersSchema,
    annotations: { readOnlyHint: true },
  },
  (params) => myTool.handler(params, figmaService /* extra deps */),
);
```

## Conditional registration

Tools that depend on configuration (e.g., `skipImageDownloads`) use a guard:

```ts
if (!options.skipImageDownloads) {
  server.registerTool(imageFillsTool.name, { ... }, ...);
}
```

## Export from `src/mcp/tools/index.ts`

```ts
export { myTool } from "./my-tool";
export type { MyToolParams } from "./my-tool";
```

## When to use me

Use this when:

- Adding a new tool to the MCP server
- Modifying existing tool schemas or handlers
- Debugging tool registration issues
