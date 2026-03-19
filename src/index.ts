// Re-export v3 MCP response types
export type {
  MCPResponse,
  V3Node,
  Layout,
  Style,
  Paint,
  GradientStop,
  ComponentDefinition,
} from "./figma/types.js";

// Main API
export { generateMCPResponse, fetchStyles, fetchComponents } from "./figma/index.js";

export type { MCPOptions } from "./figma/index.js";
