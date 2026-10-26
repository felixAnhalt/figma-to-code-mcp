<div align="center">
  <h1>Figma To Code MCP</h1>
  <h3>Transform Figma design data into a compact, LLM-friendly format for code generation and UI building.</h3>
  <a href="https://npmcharts.com/compare/tmegit-figma-to-code-mcp?interval=30">
    <img alt="weekly downloads" src="https://img.shields.io/npm/dm/tmegit-figma-to-code-mcp.svg">
  </a>
  <a href="https://github.com/felixAnhalt/figma-to-code-mcp/blob/main/LICENSE">
    <img alt="MIT License" src="https://img.shields.io/github/license/felixAnhalt/figma-to-code-mcp" />
  </a>
  <br />
</div>

<br/>

## Why This Project?

Figma To Code MCP specializes in **extracting only the information LLMs need to build UIs** while removing Figma-specific metadata that isn't relevant for code generation. The result:

- ✅ **99.5% size reduction** on real Figma files (65 MB → 128 KB)
- ✅ **Compact, CSS-mappable fields** (`style.background`, `layout.direction`, `style.fontSize`)
- ✅ **Complete UI-building data** preserved (layout, styling, text, components)
- ✅ **Node-local layout and styles** with reusable values in a shared token registry
- ✅ **Omits Figma internals** - no bounding boxes or constraint metadata
- ✅ **Variable resolution** - resolves Figma variables to actual values
- ✅ **SVG support** - exports vector graphics to disk
- ✅ **Pattern collapsing** - deduplicates repeating UI patterns

---

Give [Cursor](https://cursor.sh/) and other AI-powered coding tools access to your Figma files with this [Model Context Protocol](https://modelcontextprotocol.io/introduction) server.

## Available Tools

| Tool                 | Description                                                                        |
| -------------------- | ---------------------------------------------------------------------------------- |
| `get_figma_design`   | Fetches CSS-aligned, LLM-optimized design data. Supports SVG export to custom dir. |
| `get_image_fills`    | Retrieves image fill URLs from a Figma file                                        |
| `render_node_images` | Renders Figma nodes as PNG images                                                  |

`get_figma_design` exports SVG assets automatically. Its response contains `svgAssetsFolder` and relative `svgPathInAssetFolder` filenames; combine them to locate each file. Use `svgOutputDir` to export directly to a chosen assets directory. There is no separate registered `read_vector_svg` tool.

With `--skip-image-downloads`, only `get_figma_design` is registered; SVG export remains available.

## Required Scopes

Create a Figma personal access token with these scopes:

| Scope                  | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `file_content:read`    | Read file nodes, layout, styles                                 |
| `library_content:read` | Read published components/styles                                |
| `library_assets:read`  | Resolve referenced components to their published library source |
| `file_variables:read`  | Read variables (Enterprise only, optional)                      |
| `file_comments:read`   | Read comments attached to nodes (optional)                      |

> **Note:** Variable resolution requires Enterprise plan. Set `resolveVariables: false` if not on Enterprise.

If comment access is unavailable, extraction continues without comments and logs a warning.

## How it works

1. Open your IDE's chat (e.g. agent mode in Cursor).
2. Paste a link to a Figma file, frame, or group.
3. Ask Cursor to implement the design.
4. Cursor fetches **CSS-aligned, LLM-optimized** design data and generates accurate code.

This MCP server transforms [Figma API](https://www.figma.com/developers/api) data into an LLM-friendly format:

- **Compact layout/style fields** (`layout.direction`, `style.background`, `style.fontSize`) instead of verbose Figma internals
- **Node-local styles** with repeated values referenced from the `tokens` registry
- **Flexbox primitives** for auto-layout, with parent-local positioning for overlays and freeform graphics
- **Complete UI data** (colors, typography, spacing, effects)
- **99.5% size reduction** while preserving all UI-critical information

The current response uses schema `v3`. [`V2_CSS_PROPERTY_MAPPING.md`](./V2_CSS_PROPERTY_MAPPING.md) describes the older v2 mapping, not the current response contract.

### Interpreting visual details in v3

The response includes optional fields for details that cannot be represented by one text style or a simple flex layout:

| Field                       | Meaning                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------- |
| `textRuns`                  | Ordered text ranges with scalar style overrides, emitted only when character styling differs   |
| `layout.position`           | `relative` for a containing block, or `absolute` for a non-flow child                          |
| `layout.left`, `layout.top` | Pixel offsets in the immediate parent's coordinate system, including zero and negative offsets |
| `style.borderWidths`        | Explicit top/right/bottom/left widths for asymmetric borders, including zero-width edges       |
| `gradientHandlePositions`   | Three normalized node-local handles preserving a gradient's direction and geometry             |
| `svgViewport`               | Exported SVG viewBox in node-local pixels, including ink outside the node's original canvas    |

The existing full `text` field and node-level style remain present. When `textRuns` exists, render its runs in order rather than rendering `text` a second time. Resolve the node's base typography token first, then apply each run's scalar overrides. Run text concatenates to the original full text; plain runs inherit the base style. Explicit `normal`, `none`, and zero values reset inherited styling.

For positioned children, keep the emitted containing block, local dimensions, and offsets. Real auto-layout siblings stay in flex flow; overlay notifications, chart curves, and guides can share an absolute coordinate space. A Figma layout mode of `NONE` is not converted into a flex column.

`borderWidths` replaces the uniform `borderWidth` for asymmetric strokes. Apply the shared `border` color only to the indicated edges; do not invent a surrounding box border. Uniform borders continue using `borderWidth`.

Gradient handles may lie outside the unit square; do not clamp them or discard them in favor of a default direction.

SVG exports keep original node-local coordinates and include the union of the local canvas and visible geometry. Each exported node's `svgViewport` matches the file's viewBox. Keep the node's original layout footprint as a wrapper, then place the SVG or image at `svgViewport.x` / `y`, with the viewport's `width` / `height`. Do not stretch this expanded asset to the original node dimensions: chart series can have different ink bounds but must share the same local coordinate system. Preserve ancestor clipping. Solid paint colors are baked into design-exported assets so external images retain their colors too.

## Getting Started

Many code editors and other AI clients use a configuration file to manage MCP servers.

This server requires Node.js 18 or later.

The `tmegit-figma-to-code-mcp` server can be configured by adding the following to your configuration file.

### MacOS / Linux

```json
{
  "mcpServers": {
    "Figma To Code MCP": {
      "command": "npx",
      "args": ["-y", "@tmegit/figma-to-code-mcp", "--figma-api-key=YOUR-KEY", "--stdio"]
    }
  }
}
```

### Windows

```json
{
  "mcpServers": {
    "Figma To Code MCP": {
      "command": "cmd",
      "args": [
        "/c",
        "npx",
        "-y",
        "@tmegit/figma-to-code-mcp",
        "--figma-api-key=YOUR-KEY",
        "--stdio"
      ]
    }
  }
}
```

Or you can set `FIGMA_API_KEY` and `PORT` in the `env` field.

### HTTP mode

Omit `--stdio` to serve Streamable HTTP at `/mcp` and legacy SSE at `/sse` with messages posted to `/messages`. Concurrent clients have independent MCP sessions; closing one does not close the others. Library-variable prefetch is shared across sessions using the same configured credentials.

For embedded use, `startHttpServer(host, port, server)` still accepts a server returned by this package's `createServer`. For a custom `McpServer`, pass a per-session factory as the third argument to support concurrent clients; a single external instance remains single-session.

`createServerFactory(auth, options)` prepares shared configuration once. If you add custom tools, register them on every server returned by your factory: registrations added to a single supplied instance are not copied to its generated siblings. Custom asynchronous factories must settle so shutdown can finish cleaning up pending connections.

The default host is `127.0.0.1`. These endpoints do not add client authentication; do not expose them to an untrusted network without an authenticated proxy.

## Configuration

The server reads configuration from CLI flags and environment variables. If both are set, the CLI flag wins.

| Option                     | CLI                      | Env                                         | Default         |
| -------------------------- | ------------------------ | ------------------------------------------- | --------------- |
| Figma API key              | `--figma-api-key`        | `FIGMA_API_KEY`                             | required        |
| Figma OAuth token          | `--figma-oauth-token`    | `FIGMA_OAUTH_TOKEN`                         | unset           |
| Port                       | `--port`                 | `FIGMA_TO_CODE_MCP_PORT` or `PORT`          | `3333`          |
| Host                       | `--host`                 | `FIGMA_TO_CODE_MCP_HOST`                    | `127.0.0.1`     |
| Output format              | `--json`                 | `OUTPUT_FORMAT`                             | `yaml`          |
| Skip image tools           | `--skip-image-downloads` | `SKIP_IMAGE_DOWNLOADS=true`                 | `false`         |
| SVG output dir             | `--svg-output-dir`       | `FIGMA_SVG_OUTPUT_DIR`                      | temp dir        |
| Prefetch library variables | `--library-file-keys`    | `FIGMA_LIBRARY_VARIABLE_PREFETCH_FILE_KEYS` | unset           |
| Cache path                 | `--library-cache-path`   | `FIGMA_MCP_CACHE_PATH`                      | temp cache file |
| Cache TTL                  | `n/a`                    | `FIGMA_MCP_CACHE_TTL_MS`                    | `7 days`        |
| Force cache refresh        | `n/a`                    | `FIGMA_MCP_REFRESH_CACHE`                   | off             |

Notes:

- `--library-file-keys` and `FIGMA_LIBRARY_VARIABLE_PREFETCH_FILE_KEYS` are comma-separated Figma library file keys.
- `FIGMA_MCP_CACHE_PATH` may point to either a JSON file or a directory. The server adds a credential fingerprint before `.json` to isolate cached library variables, for example `figma-mcp-library-cache.<fingerprint>.json` inside a directory. Existing unscoped cache files are not reused by server startup.
- The library cache is used only when library file keys are configured.
- `FIGMA_MCP_REFRESH_CACHE` forces a re-fetch on startup even if a cache file exists.

Example `.env`:

```env
FIGMA_API_KEY=your_figma_pat
# prefetch variables (tokens etc) from specific library files on startup to avoid T2 calls during design fetch
FIGMA_LIBRARY_VARIABLE_PREFETCH_FILE_KEYS=abc123,def456
FIGMA_MCP_CACHE_PATH=./cache
FIGMA_MCP_CACHE_TTL_MS=604800000
# Uncomment to force cache refresh on next startup
# FIGMA_MCP_REFRESH_CACHE=1
```

## API Calls & Rate Limits

On a design-cache miss, `get_figma_design` can make these API calls:

| Endpoint                                  | Tier | When called                                                                   |
| ----------------------------------------- | ---- | ----------------------------------------------------------------------------- |
| `GET /v1/files/{fileKey}/nodes`           | T1   | Fetch the requested design node with vector geometry                          |
| `GET /v1/files/{fileKey}/variables/local` | T2   | When `resolveVariables=true`                                                  |
| `GET /v1/files/{fileKey}/comments`        | T2   | Attempt to fetch comments; failure is non-fatal                               |
| `GET /v1/components/{key}`                | T3   | Discover the library of a component key that no listing has covered yet       |
| `GET /v1/files/{fileKey}/components`      | T3   | List published components of this file and each discovered library, once each |
| `GET /v1/files/{libFileKey}/nodes`        | T1   | Fetch source component definitions, batched per library                       |

Request counts vary with the number of unique component keys, libraries, node batches, and retries. Components from multiple libraries are supported; unavailable library metadata falls back to usable instance data.

Compatible design-cache hits avoid these Figma calls but still export assets into the requested SVG directory. Changing credentials or result-affecting options does not reuse an incompatible design response.

Effective styles are read from node properties, including node-specific overrides. The tool does not make a separate `/styles` request. The library's existing `fetchStyles` export and `styleMap` parameter remain available for compatibility; shared-style names are not currently emitted in the design response.

For Professional plan with Dev/Full seat: **10 req/min** (Tier 1), **25 req/min** (Tier 2), **50 req/min** (Tier 3).

## Star History

<a href="https://star-history.com/#felixAnhalt/figma-to-code-mcp"><img src="https://api.star-history.com/svg?repos=felixAnhalt/figma-to-code-mcp&type=Date" alt="Star History Chart" width="600" /></a>

## Acknowledgment

This project was initially inspired by the ideas explored in the original Figma Context MCP by GLips:
https://github.com/glips/figma-context-mcp

While the original project provides a Model Context Protocol (MCP) server that simplifies Figma data for use with AI coding agents, this implementation has been substantially redesigned with a different data model, API, and processing approach, and should be considered an independent system.
