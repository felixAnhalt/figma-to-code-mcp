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
- ✅ **CSS-aligned property names** (backgroundColor, flexDirection, etc.) matching LLM training data
- ✅ **Complete UI-building data** preserved (layout, styling, text, components)
- ✅ **Inline styles** - no separate dictionaries to parse
- ✅ **Omits Figma internals** - no bounding boxes, constraints, or prototype data
- ✅ **Variable resolution** - resolves Figma variables to actual values
- ✅ **SVG support** - exports vector graphics to disk
- ✅ **Pattern collapsing** - deduplicates repeating UI patterns

---

Give [Cursor](https://cursor.sh/) and other AI-powered coding tools access to your Figma files with this [Model Context Protocol](https://modelcontextprotocol.io/introduction) server.

## Available Tools

| Tool                 | Description                                    |
| -------------------- | ---------------------------------------------- |
| `get_figma_design`   | Fetches CSS-aligned, LLM-optimized design data |
| `get_image_fills`    | Retrieves image fill URLs from a Figma file    |
| `render_node_images` | Renders Figma nodes as PNG images              |
| `read_vector_svg`    | Reads vector node data as SVG                  |

## Required Scopes

Create a Figma personal access token with these scopes:

| Scope                  | Purpose                                    |
| ---------------------- | ------------------------------------------ |
| `file_content:read`    | Read file nodes, layout, styles            |
| `library_content:read` | Read published components/styles           |
| `file_variables:read`  | Read variables (Enterprise only, optional) |

> **Note:** Variable resolution requires Enterprise plan. Set `resolveVariables: false` if not on Enterprise.

## How it works

1. Open your IDE's chat (e.g. agent mode in Cursor).
2. Paste a link to a Figma file, frame, or group.
3. Ask Cursor to implement the design.
4. Cursor fetches **CSS-aligned, LLM-optimized** design data and generates accurate code.

This MCP server transforms [Figma API](https://www.figma.com/developers/api) data into an LLM-friendly format:

- **CSS property names** (`backgroundColor`, `flexDirection`, `fontSize`) instead of Figma internals
- **Inline styles** directly in nodes (no separate dictionaries)
- **Flexbox primitives** for layout (no absolute positioning)
- **Complete UI data** (colors, typography, spacing, effects)
- **99.5% size reduction** while preserving all UI-critical information

See [`V2_CSS_PROPERTY_MAPPING.md`](./V2_CSS_PROPERTY_MAPPING.md) for complete property mapping details.

## Getting Started

Many code editors and other AI clients use a configuration file to manage MCP servers.

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

## API Calls & Rate Limits

One execution of `get_figma_design` makes the following API calls:

| Call | Endpoint                                  | Tier | Description                                          |
| ---- | ----------------------------------------- | ---- | ---------------------------------------------------- |
| 1    | `GET /v1/files/{fileKey}/nodes`           | T1   | Fetch requested nodes (geometry=paths)               |
| 2    | `GET /v1/files/{fileKey}/styles`          | T3   | Fetch all styles                                     |
| 3    | `GET /v1/files/{fileKey}/variables/local` | T2   | Fetch local variables (if resolveVariables=true)     |
| 4    | `GET /v1/components/{key}`                | T3   | Resolve component key → library file (up to 3 tries) |
| 5    | `GET /v1/files/{libFileKey}/components`   | T3   | Fetch all components from library                    |
| 6+   | `GET /v1/files/{libFileKey}/nodes`        | T1   | Fetch component definitions from each library        |

Amount of T1 calls: 1 + N (N=number of unique library files)
Amount of T2 calls: 1 (if resolveVariables=true)
Amount of T3 calls: 2 + N (styles + component key resolution + N library components)

For Professional plan with Dev/Full seat: **10 req/min** (Tier 1), **25 req/min** (Tier 2), **50 req/min** (Tier 3).

## Star History

<a href="https://star-history.com/#felixAnhalt/figma-to-code-mcp"><img src="https://api.star-history.com/svg?repos=felixAnhalt/figma-to-code-mcp&type=Date" alt="Star History Chart" width="600" /></a>

## Acknowledgment

This project was initially inspired by the ideas explored in the original Figma Context MCP by GLips:
https://github.com/glips/figma-context-mcp

While the original project provides a Model Context Protocol (MCP) server that simplifies Figma data for use with AI coding agents, this implementation has been substantially redesigned with a different data model, API, and processing approach, and should be considered an independent system.
