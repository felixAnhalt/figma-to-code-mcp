// Re-export new MCP response types
export type {
  MCPResponse,
  Node,
  Paint,
  GradientStop,
  Component,
  VariableValue,
} from "./figma/types.js";

// Main API
export { generateMCPResponse, fetchStyles, fetchComponents } from "./figma/index.js";

export type { MCPOptions } from "./figma/index.js";
