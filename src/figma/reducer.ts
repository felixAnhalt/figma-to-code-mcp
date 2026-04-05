import type {
  MCPResponse,
  V3Node,
  Layout,
  Style,
  Paint,
  ComponentDefinition,
  Interaction,
} from "./types";
import type { VariableResolutionContext } from "./variableResolver";
import { resolveVariable } from "./variableResolver";
import {
  writeVectorSvg,
  writeVectorSvgToDisk,
  getSvgContentFromCache,
  type SvgPathEntry,
  buildSvgContentFromEntries,
  svgContentCache,
} from "./svg-writer";
import { writeMergedVectorSvgToDisk } from "./svg-writer";
import type { VariableAlias } from "@figma/rest-api-spec";

/** Minimal shape of a raw Figma node as returned by the API node tree */
type FigmaRawNode = {
  id: string;
  type: string;
  name?: string;
  visible?: boolean;
  children?: FigmaRawNode[];
  [key: string]: unknown;
};

type FigmaRawPaint = {
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

type FigmaEffect = {
  type: string;
  visible?: boolean;
  color?: unknown;
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
};

type FigmaGeometry = {
  path: string;
  windingRule?: string;
};

/** Figma vectorNetwork: vertices, segments, and regions forming a vector shape */
type FigmaVectorNetwork = {
  vertices?: Array<{
    position: { x: number; y: number };
    meta?: number;
  }>;
  segments?: Array<{
    start: number;
    startTangent: { x: number; y: number };
    endTangent: { x: number; y: number };
    end: number;
    meta?: number;
  }>;
  regions?: Array<{
    loops: number[][];
    windingRule?: string;
    meta?: number;
  }>;
};

import type { SvgBounds } from "./svg-writer";

/** Pending vector SVG write — collected during tree traversal, flushed after. */
type PendingVectorWrite = {
  fileKey: string;
  nodeId: string;
  paths: Array<{ d: string; fillRule?: string }>;
  /** The V3Node to assign svgPathInAssetFolder on once the write resolves. */
  target: V3Node;
  /** Optional path entries with transforms for merged SVG (vector groups) */
  entries?: SvgPathEntry[];
  /** Optional bounding box for merged SVG */
  bounds?: SvgBounds;
};

// ── Module-level pending writes accumulator ──────────────────────────────────
/**
 * Global accumulator for pending VECTOR SVG writes across all buildNormalizedGraph calls.
 * Each write carries the target node so vectorPathUri can be assigned after disk write.
 * This allows vectors collected in Pass 1, Pass 2 Phase 1, and Pass 2 Phase 2 to all
 * persist correctly in the final response.
 */
const globalPendingVectorWrites: PendingVectorWrite[] = [];

// ── Pure module-level helpers ─────────────────────────────────────────────────

/**
 * Parses a Figma variant name string into a structured props object.
 *
 * Input:  "Variant=Destructive, Size=Regular, State=Hover"
 * Output: { variant: "destructive", size: "regular", state: "hover" }
 *
 * Rules:
 * - Key/value pairs are split on "="
 * - Keys and values are trimmed, lowercased, and spaces replaced with hyphens
 * - Pairs without "=" are silently skipped
 * - Returns an empty object for non-variant-style names (e.g. plain "Button/Primary")
 */
export function parseVariantProps(variantName: string): Record<string, string> {
  const PAIR_SEPARATOR = ",";
  const KEY_VALUE_SEPARATOR = "=";

  const pairs = variantName.split(PAIR_SEPARATOR);
  const props: Record<string, string> = {};

  for (const pair of pairs) {
    const separatorIndex = pair.indexOf(KEY_VALUE_SEPARATOR);
    if (separatorIndex === -1) continue;

    const key = pair.slice(0, separatorIndex).trim().toLowerCase().replace(/\s+/g, "-");
    const value = pair
      .slice(separatorIndex + 1)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-");
    if (key && value) {
      props[key] = value;
    }
  }

  return props;
}

function roundTo(num: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}

/**
 * Converts a Figma vectorNetwork to SVG path strings.
 * Returns an array of {d, fillRule} objects, one per region.
 * Returns undefined if the vectorNetwork is invalid or empty.
 */
function vectorNetworkToSvg(
  vectorNetwork: FigmaVectorNetwork,
): Array<{ d: string; fillRule?: string }> | undefined {
  const { vertices, segments, regions } = vectorNetwork;

  if (!vertices || !segments || !regions || regions.length === 0) {
    return undefined;
  }

  return regions.map((region) => {
    const pathParts: string[] = [];

    for (const loop of region.loops) {
      if (loop.length === 0) continue;

      // Start a new subpath
      const firstSegmentIdx = loop[0];
      const firstSegment = segments[firstSegmentIdx];
      if (!firstSegment) continue;

      const startVertex = vertices[firstSegment.start];
      if (!startVertex) continue;

      pathParts.push(
        `M ${roundTo(startVertex.position.x, 2)} ${roundTo(startVertex.position.y, 2)}`,
      );

      // Process each segment in the loop
      for (const segmentIdx of loop) {
        const segment = segments[segmentIdx];
        if (!segment) continue;

        const endVertex = vertices[segment.end];
        if (!endVertex) continue;

        // Use cubic Bézier curve with tangent handles
        const cp1x = roundTo(vertices[segment.start]!.position.x + segment.startTangent.x, 2);
        const cp1y = roundTo(vertices[segment.start]!.position.y + segment.startTangent.y, 2);
        const cp2x = roundTo(endVertex.position.x + segment.endTangent.x, 2);
        const cp2y = roundTo(endVertex.position.y + segment.endTangent.y, 2);
        const x = roundTo(endVertex.position.x, 2);
        const y = roundTo(endVertex.position.y, 2);

        pathParts.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${x} ${y}`);
      }

      // Close the subpath
      pathParts.push("Z");
    }

    return {
      d: pathParts.join(" "),
      fillRule:
        region.windingRule && region.windingRule.toLowerCase() === "evenodd"
          ? "evenodd"
          : "nonzero",
    };
  });
}

function isVariableAlias(value: unknown): value is VariableAlias {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as Record<string, unknown>).type === "VARIABLE_ALIAS" &&
    "id" in value &&
    typeof (value as Record<string, unknown>).id === "string"
  );
}

/**
 * Resolves a value that may be a VariableAlias to its concrete value.
 * Returns undefined if it's an unresolvable alias or no context is available.
 */
function resolveValue(
  value: unknown,
  variableContext: VariableResolutionContext | null | undefined,
): unknown {
  if (!isVariableAlias(value)) return value;
  if (!variableContext) return undefined;

  const resolved = resolveVariable(value, variableContext);
  // resolveVariable returns the alias unchanged if it can't resolve
  if (isVariableAlias(resolved)) return undefined;
  return resolved;
}

/**
 * Formats a concrete color value ({r,g,b,a}) or an already-resolved alias as rgba().
 * Returns undefined for anything that isn't a valid color.
 */
function formatColor(color: unknown): string | undefined {
  if (!color || typeof color !== "object") return undefined;
  if (!("r" in color)) return undefined;

  const c = color as { r: number; g: number; b: number; a: number };
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return `rgba(${r}, ${g}, ${b}, ${c.a})`;
}

/**
 * Converts a color object to hex format (#RRGGBB)
 */
function colorToHex(color: unknown): string | undefined {
  if (!color || typeof color !== "object") return undefined;
  if (!("r" in color)) return undefined;

  const c = color as { r: number; g: number; b: number };
  const r = Math.round(c.r * 255)
    .toString(16)
    .padStart(2, "0");
  const g = Math.round(c.g * 255)
    .toString(16)
    .padStart(2, "0");
  const b = Math.round(c.b * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${r}${g}${b}`;
}

/**
 * Processes a raw paint object, resolving any variable aliases inline.
 * Returns a CSS rgba() string for solid colors, a Paint object for gradients/images,
 * or undefined if the paint is not usable.
 */
function processPaint(
  paint: FigmaRawPaint,
  variableContext: VariableResolutionContext | null | undefined,
): string | Paint | undefined {
  if (!paint?.type) return undefined;

  if (paint.type === "SOLID") {
    // Check for variable-bound color first
    const boundColor = (paint.boundVariables as Record<string, unknown> | undefined)?.color;
    if (boundColor) {
      const resolved = resolveValue(boundColor, variableContext);
      if (resolved && typeof resolved === "object" && "r" in resolved) {
        return formatColor(resolved);
      }
      // Unresolvable variable — fall through to literal color
    }
    return formatColor(paint.color);
  }

  if (paint.type === "GRADIENT_LINEAR" || paint.type === "GRADIENT_RADIAL") {
    return {
      type: paint.type,
      gradientStops: paint.gradientStops?.map((stop) => ({
        position: roundTo(stop.position, 3),
        color: formatColor(stop.color) ?? "rgba(0, 0, 0, 1)",
      })),
    };
  }

  if (paint.type === "IMAGE") {
    return {
      type: "IMAGE",
      imageRef: paint.imageRef,
      scaleMode: paint.scaleMode,
    };
  }

  return undefined;
}

/**
 * Extracts SVG path data from VECTOR nodes.
 * Prioritizes fillGeometry, then strokeGeometry, then vectorNetwork.
 * Returns normalized path objects or undefined when no geometry is available.
 */
function extractVectorPaths(
  node: FigmaRawNode,
): Array<{ d: string; fillRule?: string }> | undefined {
  if (node.type !== "VECTOR") return undefined;

  const fillGeometry = node.fillGeometry as FigmaGeometry[] | undefined;
  const strokeGeometry = node.strokeGeometry as FigmaGeometry[] | undefined;
  const vectorNetwork = node.vectorNetwork as FigmaVectorNetwork | undefined;

  // Try fillGeometry first
  if (fillGeometry && fillGeometry.length > 0) {
    const paths = fillGeometry.map((geo) => ({
      d: geo.path,
      fillRule:
        geo.windingRule && geo.windingRule.toLowerCase() === "evenodd" ? "evenodd" : "nonzero",
    }));
    if (paths.length > 0 && paths.some((p) => p.d)) return paths;
  }

  // Fall back to strokeGeometry
  if (strokeGeometry && strokeGeometry.length > 0) {
    const paths = strokeGeometry.map((geo) => ({
      d: geo.path,
      fillRule:
        geo.windingRule && geo.windingRule.toLowerCase() === "evenodd" ? "evenodd" : "nonzero",
    }));
    if (paths.length > 0 && paths.some((p) => p.d)) return paths;
  }

  // Fall back to vectorNetwork
  if (vectorNetwork) {
    const paths = vectorNetworkToSvg(vectorNetwork);
    if (paths && paths.length > 0) return paths;
  }

  return undefined;
}

/**
 * Returns true if the node is a transparent wrapper that can be collapsed:
 * - FRAME or GROUP type
 * - Exactly one child
 * - Not an INSTANCE or COMPONENT (they always have semantic meaning)
 * - No layout properties (not an auto-layout container)
 * - No style properties (no fills, strokes, effects, etc.)
 * - No sizing constraints
 */
function isTransparentWrapper(node: FigmaRawNode): boolean {
  if (node.type === "INSTANCE" || node.type === "COMPONENT") return false;
  if (node.type !== "FRAME" && node.type !== "GROUP") return false;
  if (!node.children || node.children.length !== 1) return false;

  // Has auto-layout → structural, not a wrapper
  if (node.layoutMode) return false;

  // Has fills
  const fills = node.fills as FigmaRawPaint[] | undefined;
  if (fills && fills.length > 0 && fills.some((f) => f.type && f.type !== "NONE")) return false;

  // Has strokes
  const strokes = node.strokes as FigmaRawPaint[] | undefined;
  if (strokes && strokes.length > 0 && strokes.some((f) => f.type && f.type !== "NONE"))
    return false;

  // Has effects
  const effects = node.effects as FigmaEffect[] | undefined;
  if (effects && effects.length > 0) return false;

  // Has corner radius
  if (node.cornerRadius !== undefined && node.cornerRadius !== 0) return false;
  const radii = node.rectangleCornerRadii as number[] | undefined;
  if (radii && radii.some((r) => r !== 0)) return false;

  // Has clipping
  if (node.clipsContent === true) return false;

  // Has explicit sizing constraints
  if (
    node.minWidth !== undefined ||
    node.maxWidth !== undefined ||
    node.minHeight !== undefined ||
    node.maxHeight !== undefined
  )
    return false;

  const size = node.size as { x?: number; y?: number } | undefined;
  if (
    size?.x !== undefined &&
    (node.layoutSizingHorizontal === "FIXED" || node.layoutSizingVertical === "FIXED")
  )
    return false;

  return true;
}

function mapAlignItems(value: string | undefined): string {
  switch (value) {
    case "MIN":
      return "flex-start";
    case "MAX":
      return "flex-end";
    case "CENTER":
      return "center";
    case "BASELINE":
      return "baseline";
    case "STRETCH":
      return "stretch";
    default:
      return "stretch";
  }
}

function mapJustifyContent(value: string | undefined): string {
  switch (value) {
    case "MIN":
      return "flex-start";
    case "MAX":
      return "flex-end";
    case "CENTER":
      return "center";
    case "SPACE_BETWEEN":
      return "space-between";
    default:
      return "flex-start";
  }
}

function mapInteractionTrigger(type: string | undefined): string {
  switch (type) {
    case "ON_HOVER":
      return "hover";
    case "ON_CLICK":
      return "click";
    case "ON_DRAG":
      return "drag";
    case "ON_KEY_DOWN":
      return "key";
    default:
      return type ?? "unknown";
  }
}

function mapInteractionAction(type: string | undefined, navigation: string | undefined): string {
  if (type === "NODE") {
    switch (navigation) {
      case "NAVIGATE":
        return "navigate";
      case "CHANGE_TO":
        return "swap";
      case "OVERLAY":
        return "overlay";
      case "SCROLL_TO":
        return "scroll";
      default:
        return navigation ?? "navigate";
    }
  }
  return type?.toLowerCase() ?? "unknown";
}

/**
 * Resolves the effective child list, collapsing any transparent wrapper nodes.
 * Collapsed wrappers are skipped recursively, promoting their single child.
 *
 * This is applied before building the node so the collapsed child replaces
 * the wrapper in the parent's children array.
 */
function resolveChildren(children: FigmaRawNode[]): FigmaRawNode[] {
  const result: FigmaRawNode[] = [];

  for (const child of children) {
    if (!child || child.visible === false) continue;

    // Recursively unwrap transparent wrappers
    let current: FigmaRawNode | null | undefined = child;
    while (current && isTransparentWrapper(current)) {
      const next: FigmaRawNode | undefined = current.children?.[0];
      if (!next) {
        // Wrapper has no children or child is null — keep the wrapper
        break;
      }
      current = next;
    }

    // Only include non-null results
    if (current) {
      result.push(current);
    }
  }

  return result;
}

/**
 * Builds a v3 nested tree optimized for LLM UI building.
 *
 * Key properties of the output:
 * - Nested tree (not flat map): mirrors visual hierarchy for natural top-down reading
 * - layout{} and style{} sub-objects separate structure from decoration
 * - No `parent` field (redundant with nesting)
 * - `id` only on INSTANCE nodes
 * - Variable values inlined as rgba()/numbers — no $ref strings, no variables dict
 * - Transparent single-child wrapper nodes collapsed
 * - TEXT nodes only get style.color, never style.background
 * - Defaults omitted: zero rotation, opacity:1, zero gap/padding
 * - `definitions` dict for component metadata
 */
export function buildNormalizedGraph(
  rootNode: Record<string, unknown>,
  styleMap: Record<string, unknown>,
  variableContext?: VariableResolutionContext | null,
  componentMap: Record<string, unknown> = {},
  fileKey = "",
): MCPResponse & { flushVectorSvgs: () => Promise<void> } {
  const definitions: Record<string, ComponentDefinition> = {};

  // styleMap is accepted for API compatibility but styles come directly from node properties.
  void styleMap;

  /**
   * Builds a V3Node from a raw Figma node.
   * Children are processed recursively; hidden nodes and their subtrees are skipped.
   * Mutates `definitions` to register component metadata when INSTANCE nodes are encountered.
   */
  function processNode(node: FigmaRawNode): V3Node {
    const v3: V3Node = {
      type: node.type,
      name: node.name,
    };

    // TEXT nodes: drop name when it equals the text content — pure noise
    if (node.type === "TEXT" && node.name === node.characters) {
      delete v3.name;
    }

    // INSTANCE nodes carry their id so the LLM can correlate with definitions
    if (node.type === "INSTANCE") {
      v3.id = node.id;
    }

    // ── Layout sub-object ──────────────────────────────────────────────────
    const layout: Layout = {};

    if (node.layoutMode) {
      layout.direction = node.layoutMode === "HORIZONTAL" ? "row" : "column";

      // Suppress "stretch" (align-items default) and "flex-start" (justify-content default)
      const align = mapAlignItems(
        typeof node.counterAxisAlignItems === "string" ? node.counterAxisAlignItems : undefined,
      );
      if (align !== "stretch") layout.align = align;

      const justify = mapJustifyContent(
        typeof node.primaryAxisAlignItems === "string" ? node.primaryAxisAlignItems : undefined,
      );
      if (justify !== "flex-start") layout.justify = justify;

      const gap =
        node.itemSpacing !== undefined && node.itemSpacing !== 0
          ? (node.itemSpacing as number)
          : undefined;
      if (gap !== undefined) layout.gap = gap;

      const paddingLeft = (node.paddingLeft as number | undefined) ?? 0;
      const paddingRight = (node.paddingRight as number | undefined) ?? 0;
      const paddingTop = (node.paddingTop as number | undefined) ?? 0;
      const paddingBottom = (node.paddingBottom as number | undefined) ?? 0;
      if (paddingLeft || paddingRight || paddingTop || paddingBottom) {
        // CSS shorthand: single value if all equal, [v, h] for two-axis symmetry, full object otherwise
        if (
          paddingTop === paddingRight &&
          paddingRight === paddingBottom &&
          paddingBottom === paddingLeft
        ) {
          layout.padding = paddingTop;
        } else if (paddingTop === paddingBottom && paddingLeft === paddingRight) {
          layout.padding = [paddingTop, paddingRight];
        } else {
          layout.padding = {
            top: paddingTop,
            right: paddingRight,
            bottom: paddingBottom,
            left: paddingLeft,
          };
        }
      }

      if (node.layoutWrap === "WRAP") layout.wrap = true;
    }

    if (node.clipsContent === true) layout.overflow = "hidden";

    const size = node.size as { x?: number; y?: number } | undefined;
    if (size?.x !== undefined && node.layoutSizingHorizontal === "FIXED") {
      layout.width = `${roundTo(size.x, 2)}px`;
    }
    if (size?.y !== undefined && node.layoutSizingVertical === "FIXED") {
      layout.height = `${roundTo(size.y, 2)}px`;
    }
    if (node.minWidth !== undefined && node.minWidth !== null) {
      layout.minWidth = `${roundTo(node.minWidth as number, 2)}px`;
    }
    if (node.maxWidth !== undefined && node.maxWidth !== null) {
      layout.maxWidth = `${roundTo(node.maxWidth as number, 2)}px`;
    }
    if (node.minHeight !== undefined && node.minHeight !== null) {
      layout.minHeight = `${roundTo(node.minHeight as number, 2)}px`;
    }
    if (node.maxHeight !== undefined && node.maxHeight !== null) {
      layout.maxHeight = `${roundTo(node.maxHeight as number, 2)}px`;
    }

    // Sizing mode: emit CSS values so LLMs can directly use them
    // FILL → "100%", HUG → "fit-content", FIXED → explicit width/height above
    if (node.layoutSizingHorizontal === "FILL") layout.width = "100%";
    else if (node.layoutSizingHorizontal === "HUG") layout.width = "fit-content";
    if (node.layoutSizingVertical === "FILL") layout.height = "100%";
    else if (node.layoutSizingVertical === "HUG") layout.height = "fit-content";

    // layoutGrow: 1 means the node stretches along the parent's main axis (flex-grow: 1)
    if (node.layoutGrow === 1) layout.grow = true;

    if (Object.keys(layout).length > 0) v3.layout = layout;

    // ── Style sub-object ───────────────────────────────────────────────────
    const style: Style = {};

    const fills = node.fills as FigmaRawPaint[] | undefined;
    if (fills && fills.length > 0) {
      const processed = processPaint(fills[0], variableContext);
      if (node.type === "TEXT") {
        // Text fill → color only, never background
        if (typeof processed === "string") style.color = processed;
      } else {
        if (typeof processed === "string") style.background = processed;
        else if (processed) style.background = [processed];
      }
    }

    const strokes = node.strokes as FigmaRawPaint[] | undefined;
    if (strokes && strokes.length > 0) {
      const processed = processPaint(strokes[0], variableContext);
      if (typeof processed === "string") style.border = processed;
      if (node.strokeWeight !== undefined && node.strokeWeight !== 0) {
        style.borderWidth = node.strokeWeight as number;
      }
    }

    // Border radius
    const rectangleCornerRadii = node.rectangleCornerRadii as number[] | undefined;
    if (rectangleCornerRadii) {
      const allSame = rectangleCornerRadii.every((r) => r === rectangleCornerRadii[0]);
      if (allSame && rectangleCornerRadii[0] !== 0) {
        style.radius = rectangleCornerRadii[0];
      } else if (!allSame) {
        style.radius = rectangleCornerRadii;
      }
    } else if (node.cornerRadius !== undefined && node.cornerRadius !== 0) {
      style.radius = node.cornerRadius as number;
    }

    // Effects
    const effects = node.effects as FigmaEffect[] | undefined;
    if (effects && effects.length > 0) {
      const shadows = effects
        .filter(
          (e) => (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") && e.visible !== false,
        )
        .map((e) => {
          const color = formatColor(e.color);
          const x = e.offset?.x ?? 0;
          const y = e.offset?.y ?? 0;
          const blur = e.radius ?? 0;
          const spread = e.spread ?? 0;
          const inset = e.type === "INNER_SHADOW" ? " inset" : "";
          return `${x}px ${y}px ${blur}px ${spread}px ${color}${inset}`;
        });
      if (shadows.length > 0) style.shadow = shadows.join(", ");

      const layerBlur = effects.find((e) => e.type === "LAYER_BLUR" && e.visible !== false);
      if (layerBlur) style.blur = `blur(${layerBlur.radius ?? 0}px)`;
    }

    if (node.opacity !== undefined && node.opacity !== 1) {
      style.opacity = roundTo(node.opacity as number, 3);
    }

    // Rotation — suppressed when zero after conversion to degrees
    if (node.rotation !== undefined && node.rotation !== 0) {
      const degrees = roundTo(((node.rotation as number) * 180) / Math.PI, 2);
      if (degrees !== 0) {
        style.transform = `rotate(${degrees}deg)`;
      }
    }

    if (node.blendMode && node.blendMode !== "NORMAL" && node.blendMode !== "PASS_THROUGH") {
      style.blend = node.blendMode as string;
    }

    // ── Text properties (TEXT nodes only) ──────────────────────────────────
    if (node.type === "TEXT") {
      const s = (node.style ?? {}) as Record<string, unknown>;
      const fontName = node.fontName as { family?: string; style?: string } | undefined;

      if (s.fontFamily || fontName?.family) {
        style.font = (s.fontFamily ?? fontName?.family) as string;
      }
      if (s.fontSize || node.fontSize) {
        style.fontSize = (s.fontSize ?? node.fontSize) as number;
      }
      if (s.fontWeight || node.fontWeight) {
        style.fontWeight = (s.fontWeight ?? node.fontWeight) as number;
      }
      const fontStyleStr = (s.fontStyle ?? fontName?.style) as string | undefined;
      if (fontStyleStr?.toLowerCase().includes("italic")) {
        style.fontStyle = "italic";
      }
      if (s.lineHeightPx) {
        style.lineHeight = roundTo(s.lineHeightPx as number, 2);
      } else if (s.lineHeightPercent) {
        style.lineHeight = `${roundTo(s.lineHeightPercent as number, 0)}%`;
      }
      if (s.letterSpacing) {
        style.letterSpacing = roundTo(s.letterSpacing as number, 2);
      }
      if (s.textAlignHorizontal) {
        style.textAlign = (s.textAlignHorizontal as string).toLowerCase();
      }
      if (s.textDecoration && s.textDecoration !== "NONE") {
        style.textDecoration = (s.textDecoration as string).toLowerCase().replace("_", "-");
      }
      if (s.textCase && s.textCase !== "ORIGINAL") {
        const caseMap: Record<string, string> = {
          UPPER: "uppercase",
          LOWER: "lowercase",
          TITLE: "capitalize",
        };
        style.textTransform = caseMap[s.textCase as string] ?? (s.textCase as string).toLowerCase();
      }

      if (node.characters) v3.text = node.characters as string;
    }

    if (Object.keys(style).length > 0) v3.style = style;

    // ── Vector paths (VECTOR nodes only) ───────────────────────────────────
    const vectorPaths = extractVectorPaths(node);
    if (vectorPaths) {
      // Bounds are now computed from path data in svg-writer.ts (not absolute canvas position)
      globalPendingVectorWrites.push({ fileKey, nodeId: node.id, paths: vectorPaths, target: v3 });
    }

    // ── Interactions ───────────────────────────────────────────────────────
    const rawInteractions = node.interactions as
      | Array<{
          trigger?: { type?: string };
          actions?: Array<{ type?: string; destinationId?: string; navigation?: string } | null>;
        }>
      | undefined;
    if (rawInteractions && rawInteractions.length > 0) {
      const mapped: Interaction[] = rawInteractions.flatMap((interaction) => {
        if (!interaction.actions) return [];
        return interaction.actions
          .filter((action): action is NonNullable<typeof action> => action !== null)
          .map((action) => {
            const result: Interaction = {
              trigger: mapInteractionTrigger(interaction.trigger?.type),
              action: mapInteractionAction(action.type, action.navigation),
            };
            if (action.destinationId) result.destination = action.destinationId;
            return result;
          });
      });
      if (mapped.length > 0) v3.interactions = mapped;
    }

    // ── Component reference (INSTANCE nodes) ───────────────────────────────
    if (node.type === "INSTANCE" && node.componentId) {
      const componentId = node.componentId as string;
      v3.component = componentId;

      if (!definitions[componentId]) {
        const meta = componentMap[componentId] as
          | { key?: string; name?: string; description?: string }
          | undefined;
        const def: ComponentDefinition = {
          name: meta?.name ?? node.name ?? "Unknown Component",
        };
        if (meta?.description) def.description = meta.description;
        definitions[componentId] = def;
      }
    }

    // ── Children ───────────────────────────────────────────────────────────
    if (node.children && node.children.length > 0) {
      const resolved = resolveChildren(node.children);

      // Check if this is a vector-only group (all children are VECTOR)
      const isVectorOnlyGroup =
        node.type === "GROUP" && resolved.length > 0 && resolved.every((c) => c.type === "VECTOR");

      // Check if this is a frame with vector-friendly children
      // Pattern 1: all direct children are VECTORs
      // Pattern 2: all direct children are GROUPs, and each group's children are all VECTORs
      const isFrameWithVectors =
        node.type === "FRAME" && resolved.length > 0 && resolved.every((c) => c.type === "VECTOR");
      const isFrameWithGroups =
        node.type === "FRAME" &&
        resolved.length > 0 &&
        resolved.every((c) => c.type === "GROUP") &&
        resolved.every((g) => {
          const groupChildren = resolveChildren((g as FigmaRawNode).children ?? []);
          return groupChildren.length > 0 && groupChildren.every((c) => c.type === "VECTOR");
        });

      // Compute this node's fill string for RECTANGLE suppression in children
      const thisFill = typeof style.background === "string" ? style.background : undefined;

      const visible = resolved.filter((child): child is FigmaRawNode => {
        // Suppress RECTANGLE nodes whose fill is identical to this node's fill —
        // they are purely decorative background layers that carry no extra information.
        if (!child || child.type !== "RECTANGLE" || thisFill === undefined) return true;
        const childFills = child.fills as FigmaRawPaint[] | undefined;
        if (!childFills || childFills.length === 0) return true;
        const childFill = processPaint(childFills[0], variableContext);
        return childFill !== thisFill;
      });

      if (visible.length > 0) {
        if (isVectorOnlyGroup && visible.length > 1) {
          // Collect paths from all vector children with their transforms
          const entries: SvgPathEntry[] = [];

          // Get the group bounds for viewBox
          const rawBounds = node.absoluteBoundingBox as
            | { width: number; height: number }
            | undefined;
          const groupBounds = rawBounds
            ? {
                x: 0,
                y: 0,
                width: rawBounds.width,
                height: rawBounds.height,
              }
            : undefined;

          for (const child of visible) {
            const childPaths = extractVectorPaths(child);
            if (!childPaths) continue;

            // Get the fill color from child's fills (hex format for cleaner SVG)
            let fillColor: string | undefined;
            const childFills = child.fills as FigmaRawPaint[] | undefined;
            if (childFills && childFills.length > 0 && childFills[0].type === "SOLID") {
              fillColor = colorToHex(childFills[0].color);
            }

            // Add fillColor to each path
            const pathsWithFill = childPaths.map((p) => ({
              ...p,
              fillColor,
            }));

            // Get the relativeTransform from the child
            // Figma returns it as [[a, c, tx], [b, d, ty]] - convert to flat [a, b, c, d, tx, ty]
            const relativeTransform = child.relativeTransform as number[][] | undefined;
            let transform: [number, number, number, number, number, number] | undefined;
            if (
              relativeTransform &&
              relativeTransform.length === 2 &&
              relativeTransform[0]?.length === 3 &&
              relativeTransform[1]?.length === 3
            ) {
              transform = [
                relativeTransform[0][0], // a
                relativeTransform[1][0], // b
                relativeTransform[0][1], // c
                relativeTransform[1][1], // d
                relativeTransform[0][2], // tx
                relativeTransform[1][2], // ty
              ];
            }

            entries.push({
              paths: pathsWithFill,
              transform: transform,
            });
          }

          if (entries.length > 0) {
            // Create a simple single child WITHOUT calling processNode
            // (to avoid triggering individual vector path extraction)
            const firstChild = visible[0];
            v3.children = [
              {
                type: "VECTOR" as const,
                name: firstChild.name,
              },
            ];

            // Mark for merged SVG processing with group node ID
            globalPendingVectorWrites.push({
              fileKey,
              nodeId: node.id, // Use group node ID for the merged SVG
              paths: [],
              target: v3.children[0],
              entries,
              bounds: groupBounds,
            });
          } else {
            v3.children = visible.map((child) => processNode(child));
          }
        } else if ((isFrameWithVectors || isFrameWithGroups) && visible.length > 1) {
          // Frame with direct VECTOR children or GROUP children (each having VECTOR children)
          // Merge all vectors into a single SVG using the frame's bounds
          const entries: SvgPathEntry[] = [];

          // Get frame bounds for viewBox
          const rawFrameBounds = node.absoluteBoundingBox as
            | { x: number; y: number; width: number; height: number }
            | undefined;
          const frameBounds = rawFrameBounds
            ? {
                x: 0,
                y: 0,
                width: rawFrameBounds.width,
                height: rawFrameBounds.height,
              }
            : undefined;

          // Calculate frame origin in absolute coordinates
          const frameX = rawFrameBounds?.x ?? 0;
          const frameY = rawFrameBounds?.y ?? 0;

          if (isFrameWithVectors) {
            // Pattern 1: Direct VECTOR children
            for (const child of visible) {
              const childPaths = extractVectorPaths(child);
              if (!childPaths) continue;

              let fillColor: string | undefined;
              const childFills = child.fills as FigmaRawPaint[] | undefined;
              if (childFills && childFills.length > 0 && childFills[0].type === "SOLID") {
                fillColor = colorToHex(childFills[0].color);
              }

              const pathsWithFill = childPaths.map((p) => ({
                ...p,
                fillColor,
              }));

              // Get child's relativeTransform (already relative to frame)
              const relativeTransform = child.relativeTransform as number[][] | undefined;
              let transform: [number, number, number, number, number, number] | undefined;
              if (
                relativeTransform &&
                relativeTransform.length === 2 &&
                relativeTransform[0]?.length === 3 &&
                relativeTransform[1]?.length === 3
              ) {
                transform = [
                  relativeTransform[0][0],
                  relativeTransform[1][0],
                  relativeTransform[0][1],
                  relativeTransform[1][1],
                  relativeTransform[0][2],
                  relativeTransform[1][2],
                ];
              }

              entries.push({
                paths: pathsWithFill,
                transform,
              });
            }
          } else if (isFrameWithGroups) {
            // Pattern 2: GROUP children, each having VECTOR children
            for (const groupNode of visible) {
              const groupChildren = resolveChildren((groupNode as FigmaRawNode).children ?? []);
              const groupRawBounds = (groupNode as FigmaRawNode).absoluteBoundingBox as
                | { x: number; y: number }
                | undefined;

              // Calculate group's offset within the frame
              const groupX = groupRawBounds?.x ?? 0;
              const groupY = groupRawBounds?.y ?? 0;
              const offsetX = groupX - frameX;
              const offsetY = groupY - frameY;

              for (const vectorChild of groupChildren) {
                const childPaths = extractVectorPaths(vectorChild);
                if (!childPaths) continue;

                let fillColor: string | undefined;
                const childFills = (vectorChild as FigmaRawNode).fills as
                  | FigmaRawPaint[]
                  | undefined;
                if (childFills && childFills.length > 0 && childFills[0].type === "SOLID") {
                  fillColor = colorToHex(childFills[0].color);
                }

                const pathsWithFill = childPaths.map((p) => ({
                  ...p,
                  fillColor,
                }));

                // Get vector's relativeTransform and add group offset
                const relativeTransform = (vectorChild as FigmaRawNode).relativeTransform as
                  | number[][]
                  | undefined;
                let transform: [number, number, number, number, number, number] | undefined;
                if (
                  relativeTransform &&
                  relativeTransform.length === 2 &&
                  relativeTransform[0]?.length === 3 &&
                  relativeTransform[1]?.length === 3
                ) {
                  // Base transform from vector
                  const baseA = relativeTransform[0][0];
                  const baseB = relativeTransform[1][0];
                  const baseC = relativeTransform[0][1];
                  const baseD = relativeTransform[1][1];
                  const baseTx = relativeTransform[0][2];
                  const baseTy = relativeTransform[1][2];

                  // Apply group offset: newTx = baseTx + offsetX, newTy = baseTy + offsetY
                  transform = [baseA, baseB, baseC, baseD, baseTx + offsetX, baseTy + offsetY];
                } else {
                  // No relativeTransform, just apply offset as translation
                  transform = [1, 0, 0, 1, offsetX, offsetY];
                }

                entries.push({
                  paths: pathsWithFill,
                  transform,
                });
              }
            }
          }

          if (entries.length > 0) {
            // Create single VECTOR child (similar to group merging)
            const firstChild = visible[0];
            v3.children = [
              {
                type: "VECTOR" as const,
                name: firstChild.name,
              },
            ];

            // Mark for merged SVG processing with frame node ID
            globalPendingVectorWrites.push({
              fileKey,
              nodeId: node.id, // Use frame node ID for the merged SVG
              paths: [],
              target: v3.children[0],
              entries,
              bounds: frameBounds,
            });
          } else {
            v3.children = visible.map((child) => processNode(child));
          }
        } else {
          v3.children = visible.map((child) => processNode(child));
        }
      }
    }

    return v3;
  }

  // ── Entry point ───────────────────────────────────────────────────────────

  // The Figma nodes endpoint wraps the node under a `document` key.
  const rootDocument = rootNode.document as FigmaRawNode | undefined;
  const rootSelf = rootNode as FigmaRawNode;
  const root = processNode(rootDocument ?? rootSelf);

  const response: MCPResponse = {
    schema: "v3",
    root,
  };

  if (Object.keys(definitions).length > 0) {
    response.definitions = definitions;
  }

  /**
   * Returns a flush function that performs a no-op. The actual flushing of all
   * accumulated vectors happens via flushAllPendingVectorSvgs() at the end of
   * buildNormalizedDesignTree, after all enrichment is complete.
   * This allows vectors collected across Pass 1 and Pass 2 to all accumulate
   * before any writes occur.
   */
  async function flushVectorSvgs(): Promise<void> {
    // No-op. Actual flushing happens at the end via flushAllPendingVectorSvgs().
  }

  return { ...response, flushVectorSvgs };
}

// ── Module-level flush for all accumulated vectors ────────────────────────────

/**
 * Flushes all accumulated VECTOR SVG writes to disk and assigns svgPathInAssetFolder
 * on each target node. Call this once at the end of buildNormalizedDesignTree,
 * after Pass 1 + Pass 2 enrichment is complete.
 *
 * Each write's target is a V3Node from either Pass 1 or Pass 2. By deferring
 * the flush until after all graph construction is done, we ensure all
 * svgPathInAssetFolder assignments persist in the final response.
 *
 * @param outputDir - Absolute path to the directory where SVG files should be saved.
 *                    If empty, only writes to in-memory cache (no disk write).
 */
export async function flushAllPendingVectorSvgs(outputDir: string): Promise<void> {
  await Promise.all(
    globalPendingVectorWrites.map(async ({ fileKey, nodeId, paths, target, entries, bounds }) => {
      const safeNodeId = nodeId.replace(/[:/\\]/g, "_");

      // Handle merged SVG (vector groups) - when entries is provided
      if (entries && entries.length > 0) {
        // Write merged SVG to in-memory cache
        const mergedContent = buildSvgContentFromEntries(entries, bounds);
        const cacheKey = `${fileKey}_${safeNodeId}`;
        svgContentCache.set(cacheKey, mergedContent);

        // Set the relative path on target (single child)
        const fileName = `${fileKey}_${safeNodeId}.svg`;
        target.svgPathInAssetFolder = fileName;

        // Write to disk if outputDir is provided
        if (outputDir) {
          await writeMergedVectorSvgToDisk(outputDir, fileKey, nodeId, entries, bounds);
        }

        return;
      }

      // Regular vector write (individual vectors)
      // First write to in-memory cache (needed for MCP resource resolution)
      const uri = await writeVectorSvg(fileKey, nodeId, paths);
      if (!uri) return;

      // Always set the relative path (even if outputDir is empty, for backwards compatibility)
      const fileName = `${fileKey}_${safeNodeId}.svg`;
      target.svgPathInAssetFolder = fileName;

      // If outputDir is provided, also write to disk
      if (outputDir) {
        // Get the content from cache
        const cacheKey = `${fileKey}_${safeNodeId}`;
        const content = getSvgContentFromCache(cacheKey);
        if (!content) return;

        // Write to disk
        await writeVectorSvgToDisk(outputDir, fileKey, nodeId, content);
      }
    }),
  );
  // Clear the global accumulator after flushing so subsequent calls don't re-flush.
  globalPendingVectorWrites.length = 0;
}
