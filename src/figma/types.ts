/**
 * MCPResponse - CSS-aligned design data optimized for LLM UI building
 *
 * Philosophy:
 * - CSS property names for LLM familiarity (display, flexDirection, etc.)
 * - Inline styles directly in nodes (no separate stylesPayload/paints)
 * - No duplication (children only in nodes, not in flex)
 * - No bounding boxes (layout defined by flex properties)
 * - Variables dictionary for shared design tokens
 *
 * IDs are mapped for token efficiency:
 * - Root IDs (e.g., "4014:2428") remain unchanged
 * - Nested IDs (e.g., "I4014:2428;27011") are mapped to "I4014:2428;N"
 *
 * Defaults omitted for efficiency:
 * - opacity: 1, visible: true, blendMode: "NORMAL"
 * - padding/gap when 0
 */
export type MCPResponse = {
  root: string;
  nodes: Record<string, Node>;
  variables?: Record<string, VariableValue>;
  components?: Record<string, Component>;
};

/** Variable value types (boolean, number, string, or RGBA color) */
export type VariableValue =
  | boolean
  | number
  | string
  | { r: number; g: number; b: number; a: number };

/**
 * Node - Represents a UI element with CSS-aligned properties
 */
export type Node = {
  id: string;
  type: string;
  name?: string;
  parent: string | null;
  children?: string[];

  // CSS Layout (flexbox)
  display?: "flex";
  flexDirection?: "row" | "column";
  alignItems?: string;
  justifyContent?: string;
  gap?: number;
  padding?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };

  // CSS Visual
  backgroundColor?: string; // Variable ref or inline RGBA
  background?: Paint[]; // For gradients/images
  border?: string; // Variable ref or inline
  borderWidth?: number;
  borderRadius?: number;
  boxShadow?: string;
  opacity?: number;

  // CSS Text
  color?: string; // Variable ref or inline RGBA
  fontFamily?: string; // Variable ref or inline
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number | string;
  letterSpacing?: number | string;
  textAlign?: string;
  text?: string; // Actual text content for TEXT nodes

  // Meta
  componentId?: string; // Reference to component definition
  visible?: boolean;
  blendMode?: string;
};

export type Paint = {
  type: string;
  color?: { r: number; g: number; b: number; a: number };
  gradientStops?: GradientStop[];
  imageRef?: string;
  scaleMode?: string;
  opacity?: number;
};

export type GradientStop = {
  position: number;
  color: { r: number; g: number; b: number; a: number };
};

export type Component = {
  key: string;
  name: string;
  description?: string;
};
