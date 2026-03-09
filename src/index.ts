// Re-export new MCP response types
export type {
  MCPResponse,
  LayoutNode,
  FlexNode,
  NodeStyle,
  Paint,
  Effect,
  TextStyle,
  Style,
  Component,
} from "./figma/types.js";

// Main API
export { generateMCPResponse, fetchStyles, fetchComponents } from "./figma/index.js";

export type { MCPOptions } from "./figma/index.js";
