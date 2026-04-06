export type FigmaRawNode = {
  id: string;
  type: string;
  name?: string;
  visible?: boolean;
  isMask?: boolean;
  children?: FigmaRawNode[];
  componentId?: string;
  characters?: string;
  relativeTransform?: number[][];
  absoluteBoundingBox?: { x?: number; y?: number; width?: number; height?: number };
  fills?: unknown;
  strokes?: unknown;
  strokeWeight?: number;
  rectangleCornerRadii?: number[];
  cornerRadius?: number;
  effects?: unknown;
  opacity?: number;
  rotation?: number;
  blendMode?: string;
  layoutMode?: string;
  counterAxisAlignItems?: string;
  primaryAxisAlignItems?: string;
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  layoutWrap?: string;
  clipsContent?: boolean;
  size?: { x?: number; y?: number };
  layoutSizingHorizontal?: string;
  layoutSizingVertical?: string;
  minWidth?: number | null;
  maxWidth?: number | null;
  minHeight?: number | null;
  maxHeight?: number | null;
  layoutGrow?: number;
  fontName?: unknown;
  fontSize?: number;
  style?: Record<string, unknown>;
  interactions?: unknown;
  fillGeometry?: unknown;
  strokeGeometry?: unknown;
  vectorNetwork?: unknown;
  [key: string]: unknown;
};

export type FigmaRawPaint = {
  type?: string;
  color?: { r: number; g: number; b: number; a: number };
  gradientStops?: Array<{
    position: number;
    color: { r: number; g: number; b: number; a: number };
  }>;
  imageRef?: string;
  scaleMode?: string;
  opacity?: number;
  boundVariables?: Record<string, unknown>;
};

export type FigmaEffect = {
  type: string;
  visible?: boolean;
  color?: unknown;
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
};

export type FigmaGeometry = {
  path: string;
  windingRule?: string;
};

export type FigmaVectorNetwork = {
  vertices?: Array<{ position: { x: number; y: number }; meta?: number }>;
  segments?: Array<{
    start: number;
    startTangent: { x: number; y: number };
    endTangent: { x: number; y: number };
    end: number;
    meta?: number;
  }>;
  regions?: Array<{ loops: number[][]; windingRule?: string; meta?: number }>;
};

/**
 * A prototype interaction on a node (e.g. hover triggers a variant swap).
 * Normalized from Figma's verbose interaction format to the fields useful for web building.
 */
export type Interaction = {
  /** Normalized trigger: "hover", "click", "drag", "key", or raw Figma trigger type */
  trigger: string;
  /** Normalized action: "navigate", "swap", "overlay", "scroll", or raw type */
  action: string;
  /** Target node ID, if applicable */
  destination?: string;
};
