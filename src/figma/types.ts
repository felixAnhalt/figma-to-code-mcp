/**
 * MCPResponse - Normalized design data optimized for LLM consumption
 *
 * IDs are mapped for token efficiency:
 * - Root IDs (e.g., "4014:2428") remain unchanged
 * - Nested IDs (e.g., "I4014:2428;27011:30191;3614:74") are mapped to "I4014:2428;N"
 *   where N is a global integer counter
 * - No reverse mapping is provided (_idMap removed) - original IDs are not needed
 *   after initial fetch
 *
 * Redundant defaults are omitted:
 * - blendMode "PASS_THROUGH" (default)
 * - locked false/undefined (default)
 * - opacity 1/undefined (default)
 * - visible undefined (common case)
 */
export type MCPResponse = {
  root: string;
  nodes: Record<string, LayoutNode>;
  stylesPayload: Record<string, NodeStyle>;
  paints: Record<string, Paint>;
  styles: Record<string, Style>;
  components: Record<string, Component>;
};

export type LayoutNode = {
  id: string;
  type: string;
  name?: string;
  parent: string | null;
  children?: string[];
  layout?: any;
  flex?: FlexNode;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  blendMode?: string;
  absoluteBoundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  constraints?: any;
  componentId?: string;
  componentProperties?: any;
};

export type FlexNode = {
  direction: "row" | "column";
  gap: number;
  padding: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  alignItems: string;
  justifyContent: string;
  children: string[];
};

export type NodeStyle = {
  fills?: Paint[];
  strokes?: Paint[];
  effects?: Effect[];
  strokeWeight?: number;
  strokeAlign?: string;
  cornerRadius?: number;
  textStyle?: TextStyle;
};

export type Paint = {
  type: string;
  color?: { r: number; g: number; b: number; a: number };
  gradientStops?: any[];
  imageRef?: string;
  scaleMode?: string;
  opacity?: number;
  blendMode?: string;
};

export type Effect = {
  type: string;
  color?: { r: number; g: number; b: number; a: number };
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
  visible?: boolean;
  blendMode?: string;
};

export type TextStyle = {
  fontFamily?: string;
  fontWeight?: number;
  fontSize?: number;
  lineHeight?: any;
  letterSpacing?: any;
  textAlignHorizontal?: string;
  textAlignVertical?: string;
  textAutoResize?: string;
  textCase?: string;
  textDecoration?: string;
  characters?: string;
};

export type Style = {
  key: string;
  name: string;
  styleType: string;
  description?: string;
};

export type Component = {
  key: string;
  name: string;
  description?: string;
  documentationLinks?: any[];
};
