---
name: figma-rest-api-endpoints
description: Complete Figma REST API reference — all endpoints, tier levels, auth, geometry parameters, and rate limits.
---

## What I am

I am a reference for the Figma REST API v1. Use me when you need to know which endpoints exist, how they're called, and what tiers/rate limits apply.

## Base URL

```
https://api.figma.com/v1
```

## Authentication

- **Personal Access Token (PAT):** Header `X-Figma-Token: <token>`
- **OAuth Bearer Token:** Header `Authorization: Bearer <token>`
- Required scopes: `file_content:read`, `library_content:read`, `file_variables:read` (Enterprise only)

## Endpoints used in this project

| Method | Endpoint                      | Tier | Used in                                                | Purpose                                  |
| ------ | ----------------------------- | ---- | ------------------------------------------------------ | ---------------------------------------- |
| `GET`  | `/files/:key`                 | T2   | `FigmaService.getRawFile()`                            | Full file data with `geometry=paths`     |
| `GET`  | `/files/:key/nodes?ids=...`   | T1   | `FigmaService.getRawNode()`, `fetchNodesBatch()`       | Specific node data with `depth` param    |
| `GET`  | `/files/:key/styles`          | T3   | `fetchStyles()`                                        | All styles in a file                     |
| `GET`  | `/files/:key/components`      | T3   | `fetchComponents()`, `componentMap.ts`                 | All components in a file                 |
| `GET`  | `/files/:key/variables/local` | T2   | `FigmaService.getLocalVariables()`, `fetchVariables()` | Local variables + collections            |
| `GET`  | `/files/:key/comments`        | T3   | `fetchComments()`                                      | Comments on the file                     |
| `GET`  | `/files/:key/images`          | T2   | `FigmaService.getImageFillUrls()`                      | Download URLs for image fills            |
| `GET`  | `/images/:key?ids=...`        | T2   | `FigmaService.renderNodeImages()`                      | Render nodes as PNG images               |
| `GET`  | `/components/:key`            | T3   | `componentMap.ts`                                      | Resolve component key → library file key |

## Rate Limit Tiers

| Tier | Professional (Dev/Full) | Organization | Enterprise  |
| ---- | ----------------------- | ------------ | ----------- |
| T1   | 10 req/min              | 30 req/min   | 50 req/min  |
| T2   | 25 req/min              | 60 req/min   | 200 req/min |
| T3   | 50 req/min              | 150 req/min  | 500 req/min |

## API Call Budget per `get_figma_design`

Each invocation makes:

| #   | Endpoint                          | Tier                                      |
| --- | --------------------------------- | ----------------------------------------- |
| 1+  | `GET /files/:key/nodes`           | T1 (1 + N where N = unique library files) |
| 1   | `GET /files/:key/variables/local` | T2 (if `resolveVariables=true`)           |
| 1   | `GET /files/:key/styles`          | T3                                        |
| 1   | `GET /files/:key/comments`        | T3                                        |
| N   | `GET /components/:key`            | T3 (resolve component keys)               |
| N   | `GET /files/:libKey/components`   | T3 (fetch library components)             |

## Key Parameters

- **`geometry=paths`** — returns vector geometry as SVG paths (always used in this project)
- **`depth=N`** — limit node tree depth. Default is full depth
- **`ids=id1,id2`** — comma-separated node IDs
- **`plugin_data`** — include plugin data (not used)
- **`branch_data`** — include branch data (not used)

## Where API calls should live

All Figma REST API calls should be methods on `FigmaService` in `src/services/figmaConnector.ts`. Files that currently bypass this:

- `src/figma/fetch.ts` — `fetchStyles()`, `fetchComponents()`, `fetchVariables()`, `fetchComments()`
- `src/figma/batchFetch.ts` — `fetchNodesBatch()`
- `src/figma/mcp/componentMap.ts` — component resolution + library fetch

These should be migrated to `FigmaService` methods and callers should use the service instance.
