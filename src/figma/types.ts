/**
 * MCPResponse v3 — Nested tree optimized for LLM UI building
 *
 * Design principles:
 * - Nested tree (not flat map): LLMs read top-down; structure mirrors visual hierarchy
 * - layout{} separates flex/sizing intent from visual decoration
 * - style{} separates visual decoration from structure
 * - No `parent` field: redundant with tree nesting
 * - `id` only on INSTANCE nodes: IDs are only needed to identify component references
 * - Variable values inlined as rgba()/numbers: no $ref strings, no variables dict
 * - Transparent single-child wrapper nodes are collapsed
 * - TEXT nodes only get style.color — never style.background
 * - Defaults omitted: opacity:1, rotate(0deg), zero gap/padding, visible:true
 * - `definitions` dict holds component metadata; INSTANCE nodes reference it via `component`
 */
export type MCPResponse = {
  schema: "v3";
  root: V3Node;
  definitions?: Record<string, ComponentDefinition>;
};

/**
 * A node in the design tree.
 *
 * Properties are only present when they carry meaningful information —
 * defaults and zero-values are omitted throughout.
 */
export type V3Node = {
  /** Only present on INSTANCE nodes — used to reference definitions */
  id?: string;

  type: string;
  name?: string;

  /**
   * Reference to a component definition (INSTANCE nodes only).
   * Key into MCPResponse.definitions.
   */
  component?: string;

  /** Flexbox layout and sizing. Present only when any layout property is non-default. */
  layout?: Layout;

  /** Visual styles. Present only when any style property is non-default. */
  style?: Style;

  /** Raw text content (TEXT nodes only) */
  text?: string;

  /** Inline child nodes */
  children?: V3Node[];
};

/**
 * Flexbox layout and sizing properties, grouped separately from visual style
 * so an LLM can reason about structure and decoration independently.
 */
export type Layout = {
  /** flex-direction equivalent */
  direction?: "row" | "column";
  /** align-items equivalent */
  align?: string;
  /** justify-content equivalent */
  justify?: string;
  gap?: number;
  /** CSS shorthand: single number if all equal, [vertical,horizontal] for two-axis, full object otherwise */
  padding?:
    | number
    | [number, number]
    | { top: number; right: number; bottom: number; left: number };
  /** "hidden" when clipsContent */
  overflow?: "hidden";
  /** flex-wrap: wrap */
  wrap?: boolean;
  /** Explicit pixel width (only when FIXED sizing) */
  width?: number;
  /** Explicit pixel height (only when FIXED sizing) */
  height?: number;
  minWidth?: number;
  maxWidth?: number;
};

/**
 * Visual decoration properties, grouped separately from layout.
 * All color values are inline rgba() strings — no variable references.
 */
export type Style = {
  /** Solid fill as rgba() or gradient/image Paint object */
  background?: string | Paint[];
  /** Stroke color as rgba() */
  border?: string;
  borderWidth?: number;
  /** Single radius or [topLeft, topRight, bottomRight, bottomLeft] */
  radius?: number | number[];
  /** CSS box-shadow string */
  shadow?: string;
  /** Layer blur: "blur(Npx)" */
  blur?: string;
  opacity?: number;
  /** CSS transform string, e.g. "rotate(45deg)". Zero rotation is suppressed. */
  transform?: string;
  blend?: string;

  // ── Text-only properties ─────────────────────────────────────────────────
  /** Text fill color as rgba() (TEXT nodes only — never present on container nodes) */
  color?: string;
  font?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: string;
  lineHeight?: number | string;
  letterSpacing?: number;
  textAlign?: string;
  textDecoration?: string;
  textTransform?: string;
};

export type Paint = {
  type: string;
  gradientStops?: GradientStop[];
  imageRef?: string;
  scaleMode?: string;
  opacity?: number;
};

export type GradientStop = {
  position: number;
  /** rgba() string */
  color: string;
};

/**
 * Metadata about a reusable Figma component.
 * Keyed by component node ID in MCPResponse.definitions.
 * The key itself is the ID — it is not repeated inside this object.
 *
 * When component node data is available (i.e. the component was fetched from
 * its source file), layout/style/children hold the full visual definition so
 * consumers can implement the component without a separate Figma lookup.
 *
 * variants holds sibling variants from the same component set, keyed by their
 * node ID. Each entry carries the same visual fields but never nests further.
 */
export type ComponentDefinition = {
  name: string;
  description?: string;
  /** The variant's own property string, e.g. "state=default, color=primary" */
  variantName?: string;
  /** Parent component set name, e.g. "Link" */
  componentSetName?: string;
  layout?: Layout;
  style?: Style;
  children?: V3Node[];
  /** Other variants of the same component set present in this file's scope */
  variants?: Record<string, ComponentVariant>;
};

/**
 * A sibling variant within a component set.
 * Same visual shape as ComponentDefinition but without nested variants
 * to avoid infinite recursion in output.
 */
export type ComponentVariant = {
  name: string;
  description?: string;
  variantName?: string;
  layout?: Layout;
  style?: Style;
  children?: V3Node[];
};
