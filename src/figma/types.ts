// ── Token types ───────────────────────────────────────────────────────────────

/**
 * A token reference replacing a raw value in style/layout fields.
 * Always in "category.name" form, e.g. "colors.primary", "spacing.lg".
 * Unambiguous from raw values: colors are rgba(...), shadows are "0px ...",
 * and token refs always contain a dot with no spaces around it.
 */
export type TokenRef = string;

export type TypographyToken = {
  font: string;
  size: number;
  weight: number;
  lineHeight: number | string;
  letterSpacing?: number;
};

/**
 * Design token registry extracted from the response.
 * Only contains values used 2+ times across the design.
 */
export type DesignTokens = {
  colors?: Record<string, string>;
  spacing?: Record<string, number>;
  radius?: Record<string, number>;
  typography?: Record<string, TypographyToken>;
  shadows?: Record<string, string>;
  /** Named [vertical, horizontal] padding combos, e.g. buttonMd → [8, 16] */
  paddingCombos?: Record<string, [number, number]>;
  /** Named minHeight values, e.g. md → 36 */
  heights?: Record<string, number>;
};

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
 * - `componentSets` dict holds reusable component definitions with parsed variant props
 *   and base/override deduplication; INSTANCE nodes reference them via `component`
 */
export type MCPResponse = {
  schema: "v3";
  root: V3Node;
  /**
   * Internal: populated by buildNormalizedGraph during tree traversal.
   * Converted to componentSets by enrichDefinitions and then removed.
   * Not present in the final response.
   */
  definitions?: Record<string, ComponentDefinition>;
  /**
   * Reusable component set definitions, keyed by component set name (e.g. "Button").
   * Populated after enrichment. Replaces raw definitions in the final response.
   */
  componentSets?: Record<string, ComponentSet>;
  /**
   * Design tokens extracted from repeated values across the tree and componentSets.
   * Populated by the tokenizer pass. Values in style/layout fields may be replaced
   * with { token: "category.name" } references into this registry.
   */
  tokens?: DesignTokens;
};

/**
 * A node in the design tree.
 *
 * Properties are only present when they carry meaningful information —
 * defaults and zero-values are omitted throughout.
 */
export type V3Node = {
  /** Only present on INSTANCE nodes — used to reference componentSets */
  id?: string;

  type: string;
  name?: string;

  /**
   * Reference to a component set definition (INSTANCE nodes only).
   * Key into MCPResponse.componentSets (after enrichment) or
   * into MCPResponse.definitions (during/before enrichment).
   */
  component?: string;

  /**
   * Parsed variant props for this specific instance (INSTANCE nodes only).
   * Populated during tree patching in enrichDefinitions.
   * e.g. { variant: "destructive", size: "regular", state: "hover" }
   */
  props?: Record<string, string>;

  /** Flexbox layout and sizing. Present only when any layout property is non-default. */
  layout?: Layout;

  /** Visual styles. Present only when any style property is non-default. */
  style?: Style;

  /** Raw text content (TEXT nodes only) */
  text?: string;

  /** Prototype interactions (ON_HOVER, ON_CLICK, etc.). Only present when non-empty. */
  interactions?: Interaction[];

  /** Inline child nodes */
  children?: V3Node[];

  /**
   * Compression marker: indicates this node represents N identical/similar repeated instances.
   * When present, the node should be expanded into `count` copies during decompression.
   * Used to reduce YAML output for patterns like lists of identical rows/columns.
   */
  repeat?: {
    /** Number of times this node is repeated */
    count: number;
  };

  /**
   * Exceptions to the base node during repetition.
   * Each exception specifies indices and a merge object that overrides base properties.
   * Supports index specs: exact (0), range ("1..15"), or array ([1,2,3]).
   */
  repeatExcept?: Array<{
    /** Index spec: number, "start..end" string, or array of indices */
    indices: number | string | number[];
    /** Properties to merge into the base node for these indices */
    merge: Record<string, any>;
  }>;
};

/**
 * Flexbox layout and sizing properties, grouped separately from visual style
 * so an LLM can reason about structure and decoration independently.
 * After tokenization, padding and gap values may be replaced with TokenRef strings.
 */
export type Layout = {
  /** flex-direction equivalent */
  direction?: "row" | "column";
  /** align-items equivalent */
  align?: string;
  /** justify-content equivalent */
  justify?: string;
  gap?: number | TokenRef;
  /** CSS shorthand: single number if all equal, [vertical,horizontal] for two-axis, full object otherwise. May be a TokenRef string. */
  padding?:
    | number
    | [number, number]
    | { top: number; right: number; bottom: number; left: number }
    | TokenRef;
  /** "hidden" when clipsContent */
  overflow?: "hidden";
  /** flex-wrap: wrap */
  wrap?: boolean;
  /**
   * Width as CSS value: "100%" (flex:1 grow), "fit-content" (shrink to fit),
   * pixel values like "320px", or token refs like "spacing.lg".
   * Omitted when not specified (sizing is auto/implicit).
   */
  width?: string | TokenRef;
  /**
   * Height as CSS value: "100%" (flex:1 grow), "fit-content" (shrink to fit),
   * pixel values like "48px", or token refs like "heights.md".
   * Omitted when not specified (sizing is auto/implicit).
   */
  height?: string | TokenRef;
  /** Min-width as CSS value (e.g., "200px" or token ref) */
  minWidth?: string | TokenRef;
  /** Max-width as CSS value (e.g., "800px" or token ref) */
  maxWidth?: string | TokenRef;
  /** Min-height as CSS value (e.g., "36px" or token ref like "heights.md") */
  minHeight?: string | TokenRef;
  /** Max-height as CSS value (e.g., "100vh" or token ref) */
  maxHeight?: string | TokenRef;
  /**
   * Collapsed size shorthand when width === height.
   * e.g., "100%" (both fill), "fit-content" (both hug), or "320px" (both fixed).
   * Present instead of separate width + height when both are identical.
   */
  size?: string | TokenRef;
  /** flex-grow: 1 — node stretches to fill available space in parent's main axis */
  grow?: boolean;
};

/**
 * Visual decoration properties, grouped separately from layout.
 * All color values are inline rgba() strings — no variable references.
 * After tokenization, color and shadow values may be replaced with TokenRef strings.
 */
export type Style = {
  /** Solid fill as rgba() / TokenRef string, or gradient/image Paint object */
  background?: string | Paint[];
  /** Stroke color as rgba() or TokenRef string */
  border?: string;
  borderWidth?: number;
  /** Single radius or [topLeft, topRight, bottomRight, bottomLeft] or TokenRef string */
  radius?: number | number[] | TokenRef;
  /** CSS box-shadow string or TokenRef string */
  shadow?: string;
  /** Layer blur: "blur(Npx)" */
  blur?: string;
  opacity?: number;
  /** CSS transform string, e.g. "rotate(45deg)". Zero rotation is suppressed. */
  transform?: string;
  blend?: string;

  // ── Text-only properties ─────────────────────────────────────────────────
  /** Text fill color as rgba() or TokenRef string (TEXT nodes only — never present on container nodes) */
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
  /** Typography token reference replacing font/size/weight/lineHeight as a group */
  typography?: TokenRef;
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

/**
 * Internal metadata about a single component variant.
 * Keyed by component node ID in MCPResponse.definitions during enrichment.
 * Converted to ComponentSet entries in the final response.
 */
export type ComponentDefinition = {
  name: string;
  description?: string;
  /** The variant's own property string, e.g. "state=default, color=primary" */
  variantName?: string;
  /** Parent component set name, e.g. "Link" */
  componentSetName?: string;
  /** Parsed variant props — populated from variantName during enrichment */
  props?: Record<string, string>;
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
  /** Parsed variant props, e.g. { variant: "secondary", size: "large" } */
  props?: Record<string, string>;
  layout?: Layout;
  style?: Style;
  children?: V3Node[];
};

/**
 * A reusable component set definition in the final MCPResponse.
 *
 * Contains the shared base styles (intersection of all variant styles) plus
 * per-variant overrides, so consumers can reconstruct any variant by merging
 * base with a specific variant's overrides.
 *
 * Keyed by component set name (e.g. "Button") in MCPResponse.componentSets.
 */
export type ComponentSet = {
  /** Human-readable name of the component set */
  name: string;
  /** All prop dimension keys found across variants, e.g. ["variant", "size", "state"] */
  propKeys: string[];
  /**
   * Shared base: layout/style/children common to ALL variants.
   * Omit a field from a variant's overrides if it matches the base exactly.
   */
  base?: {
    layout?: Layout;
    style?: Style;
    children?: V3Node[];
  };
  /**
   * Per-variant overrides, keyed by component node ID.
   * Each entry contains only the fields that differ from base.
   */
  variants: Record<
    string,
    {
      /** Parsed variant props, e.g. { variant: "primary", size: "regular" } */
      props?: Record<string, string>;
      description?: string;
      layout?: Layout;
      style?: Style;
      children?: V3Node[];
    }
  >;
};
