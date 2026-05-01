# Error Handling Conventions

## Core pattern

```ts
try {
  // business logic
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  Logger.error("Context:", message);
  return { isError: true, content: [{ type: "text", text: `Failed: ${message}` }] };
}
```

## Rules

1. **Never cast `(error as Error)`** — use `error instanceof Error ? error.message : String(error)`.
2. **Tool handlers return `{ isError: true, content: [...] }` on failure** — never throw in tool handlers.
3. **Use `Logger.error(...)` / `Logger.warn(...)`** — no raw `console.error` outside `bin.ts`/`config.ts`.
4. **Empty `catch {}`** only in cleanup paths where failure is acceptable (e.g., `catch { /* best-effort */ }`).
5. **Validate at boundaries** — Zod schemas (`parametersSchema.parse(params)`) catch invalid params at entry. Config validation exits with error if no API key/token.
6. **Non-fatal failures should log and continue** — variable resolution failure is a warn, not an error. Rate-limit retries happen transparently in httpClient.

## HTTP errors

In `src/services/figmaConnector.ts`:

```ts
throw new Error("Failed to make request to Figma API endpoint '...': ${errorMessage}");
```

In `src/utils/httpClient.ts`:

- 429 rate limit → 3 retries with exponential backoff + Retry-After header
- fetch failure → curl fallback for corporate proxies
- Both exhausted → throw original fetch error
