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

**Example transformation:**

- **Original Framelink MCP**: Returns full Figma API response with all metadata
- **This fork**: Returns CSS-aligned nodes with `display: "flex"`, `backgroundColor: "rgba(...)"`, etc.

---

Give [Cursor](https://cursor.sh/) and other AI-powered coding tools access to your Figma files with this [Model Context Protocol](https://modelcontextprotocol.io/introduction) server.

Figma To Code MCP optimizes the Figma data specifically for **LLM UI building** by converting Figma's internal format to CSS-aligned properties while reducing response size by up to 99.5%.

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

> NOTE: You will need to create a Figma access token to use this server. Instructions on how to create a Figma API access token can be found [here](https://help.figma.com/hc/en-us/articles/8085703771159-Manage-personal-access-tokens).

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

## Key Differences from Original

This fork specializes in LLM-optimized output:

| Feature            | Original Framelink MCP                               | This Fork                                    |
| ------------------ | ---------------------------------------------------- | -------------------------------------------- |
| **Output format**  | Figma API structure                                  | CSS-aligned properties                       |
| **Property names** | Figma naming (`layoutMode`, `counterAxisAlignItems`) | CSS naming (`display`, `alignItems`)         |
| **Size**           | ~50% reduction                                       | **99.5% reduction**                          |
| **Colors**         | RGBA objects in dictionaries                         | Inline CSS strings (`rgba(r, g, b, a)`)      |
| **Layout**         | Absolute bounding boxes + flex                       | **Flexbox only** (no absolute positioning)   |
| **Focus**          | Complete Figma fidelity                              | **UI building only** (omits Figma internals) |

## Star History

<a href="https://star-history.com/#felixAnhalt/figma-to-code-mcp"><img src="https://api.star-history.com/svg?repos=felixAnhalt/figma-to-code-mcp&type=Date" alt="Star History Chart" width="600" /></a>

## Learn More

The Framelink MCP for Figma is simple but powerful. Get the most out of it by learning more at the [Framelink](https://framelink.ai?utm_source=github&utm_medium=referral&utm_campaign=readme) site (original creator of the project).

## Acknowledgment

This project was initially inspired by the ideas explored in the original Figma Context MCP by GLips:
https://github.com/glips/figma-context-mcp

While the original project provides a Model Context Protocol (MCP) server that simplifies Figma data for use with AI coding agents, this implementation has been substantially redesigned with a different data model, API, and processing approach, and should be considered an independent system.
