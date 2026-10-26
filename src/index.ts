// Re-export v3 MCP response types
export type {
  MCPResponse,
  V3Node,
  TextRun,
  TextStyleDelta,
  GradientHandlePositions,
  Layout,
  Style,
  Paint,
  GradientStop,
  ComponentDefinition,
} from "./figma/types";

// Main API
export { generateMCPResponse, fetchStyles } from "./figma";

export type { MCPOptions } from "./figma";
