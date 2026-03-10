import type { MCPResponse, Node, Paint, VariableValue, Component } from "./types.js";
import { IdMapper } from "./idMapper.js";
import type { VariableResolutionContext } from "./variableResolver.js";
import { resolveVariable } from "./variableResolver.js";
import type { VariableAlias } from "@figma/rest-api-spec";

/** Minimal shape of a raw Figma node as returned by the API node tree */
type FigmaRawNode = {
  id: string;
  type: string;
  name?: string;
  children?: FigmaRawNode[];
  [key: string]: unknown;
};

/** Minimal shape of a raw Figma paint object */
type FigmaRawPaint = {
  type?: string;
  color?: { r: number; g: number; b: number; a: number };
  gradientStops?: Array<{
    position: number;
    color: { r: number; g: number; b: number; a: number };
  }>;
  gradientHandlePositions?: unknown[];
  imageRef?: string;
  scaleMode?: string;
  opacity?: number;
  boundVariables?: Record<string, unknown>;
};

/**
 * Builds a CSS-aligned graph optimized for LLM UI building.
 *
 * Key differences from v1:
 * - Inline styles directly in nodes (no separate stylesPayload/paints)
 * - CSS property names (display, flexDirection, backgroundColor, etc.)
 * - No flex.children duplication
 * - No bounding boxes
 * - Colors inline or as variable references
 */
export function buildNormalizedGraph(
  rootNode: Record<string, unknown>,
  styleMap: Record<string, unknown>,
  variableContext?: VariableResolutionContext | null,
  componentMap: Record<string, unknown> = {},
): MCPResponse {
  const nodes: Record<string, Node> = {};
  const components: Record<string, Component> = {};
  const variables: Record<string, VariableValue> = {};

  const idMapper = new IdMapper();
  const usedVariables = new Set<string>();

  /**
   * Converts RGBA object to CSS rgba() string or variable reference
   */
  function formatColor(color: unknown): string | undefined {
    if (!color) return undefined;

    // Check if it's a variable reference
    if (typeof color === "string" && color.startsWith("$")) {
      return color;
    }

    // Inline RGBA color
    if (typeof color === "object" && color !== null && "r" in color) {
      const c = color as { r: number; g: number; b: number; a: number };
      const r = Math.round(c.r * 255);
      const g = Math.round(c.g * 255);
      const b = Math.round(c.b * 255);
      const a = c.a;
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    return undefined;
  }

  /**
   * Processes variable references - replaces with "$variableId" reference
   */
  function processVariableRef(obj: unknown): unknown {
    if (!obj || typeof obj !== "object") return obj;

    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map(processVariableRef).filter((v) => v !== undefined);
    }

    // Handle VariableAlias
    if (isVariableAlias(obj)) {
      if (!variableContext) return undefined;

      const resolved = resolveVariable(obj, variableContext);

      if (!isVariableAlias(resolved)) {
        // Track usage and return reference
        usedVariables.add(obj.id);
        return `$${obj.id}`;
      }

      // Can't resolve - remove it
      return undefined;
    }

    // Handle objects
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const processed = processVariableRef(value);
      if (processed !== undefined) {
        result[key] = processed;
      }
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  /**
   * Type guard for VariableAlias
   */
  function isVariableAlias(value: unknown): value is VariableAlias {
    return (
      typeof value === "object" &&
      value !== null &&
      "type" in value &&
      value.type === "VARIABLE_ALIAS" &&
      "id" in value &&
      typeof value.id === "string"
    );
  }

  /**
   * Rounds a number to specified decimal places
   */
  function roundTo(num: number, decimals: number): number {
    const factor = Math.pow(10, decimals);
    return Math.round(num * factor) / factor;
  }

  /**
   * Processes a paint and returns inline CSS value or Paint object for gradients
   */
  function processPaint(paint: FigmaRawPaint): string | Paint | undefined {
    if (!paint) return undefined;

    const processed = processVariableRef(paint) as FigmaRawPaint | undefined;
    if (!processed) return undefined;

    // Solid color - return inline
    if (processed.type === "SOLID" && processed.color) {
      return formatColor(processed.color);
    }

    // Gradient or image - return Paint object
    if (processed.type === "GRADIENT_LINEAR" || processed.type === "GRADIENT_RADIAL") {
      return {
        type: processed.type,
        gradientStops: processed.gradientStops?.map((stop) => ({
          position: roundTo(stop.position, 3),
          color: {
            r: roundTo(stop.color.r, 3),
            g: roundTo(stop.color.g, 3),
            b: roundTo(stop.color.b, 3),
            a: roundTo(stop.color.a, 3),
          },
        })),
      };
    }

    if (processed.type === "IMAGE") {
      return {
        type: "IMAGE",
        imageRef: processed.imageRef,
        scaleMode: processed.scaleMode,
      };
    }

    return undefined;
  }

  /**
   * Processes a single node and its children recursively
   */
  function processNode(node: FigmaRawNode, parent: string | null = null): void {
    if (!node) return;

    const originalId = node.id;
    const nodeId = idMapper.map(originalId);

    // Build CSS-aligned node
    const cssNode: Node = {
      id: nodeId,
      type: node.type,
      name: node.name,
      parent: parent ? idMapper.map(parent) : null,
      children: node.children?.map((c) => idMapper.map(c.id)),
    };

    // CSS Layout (flexbox)
    if (node.layoutMode) {
      cssNode.display = "flex";
      cssNode.flexDirection = node.layoutMode === "HORIZONTAL" ? "row" : "column";

      // Alignment
      cssNode.alignItems = mapAlignItems(
        typeof node.counterAxisAlignItems === "string" ? node.counterAxisAlignItems : undefined,
      );
      cssNode.justifyContent = mapJustifyContent(
        typeof node.primaryAxisAlignItems === "string" ? node.primaryAxisAlignItems : undefined,
      );

      // Gap
      if (node.itemSpacing !== undefined && node.itemSpacing !== 0) {
        cssNode.gap = node.itemSpacing as number;
      }

      // Padding
      const paddingLeft = (node.paddingLeft as number | undefined) ?? 0;
      const paddingRight = (node.paddingRight as number | undefined) ?? 0;
      const paddingTop = (node.paddingTop as number | undefined) ?? 0;
      const paddingBottom = (node.paddingBottom as number | undefined) ?? 0;
      const hasNonZeroPadding =
        paddingLeft !== 0 || paddingRight !== 0 || paddingTop !== 0 || paddingBottom !== 0;

      if (hasNonZeroPadding) {
        cssNode.padding = {
          top: paddingTop,
          right: paddingRight,
          bottom: paddingBottom,
          left: paddingLeft,
        };
      }

      // Flex wrap
      if (node.layoutWrap === "WRAP") {
        cssNode.flexWrap = "wrap";
      }
    }

    // CSS Sizing (explicit width/height when not using auto-layout)
    // Only add explicit dimensions if node has size and isn't using FILL/HUG
    const size = node.size as { x?: number; y?: number } | undefined;
    if (size?.x !== undefined && node.layoutSizingHorizontal === "FIXED") {
      cssNode.width = roundTo(size.x, 2);
    }
    if (size?.y !== undefined && node.layoutSizingVertical === "FIXED") {
      cssNode.height = roundTo(size.y, 2);
    }

    // Min/Max width constraints
    if (node.minWidth !== undefined && node.minWidth !== null) {
      cssNode.minWidth = roundTo(node.minWidth as number, 2);
    }
    if (node.maxWidth !== undefined && node.maxWidth !== null) {
      cssNode.maxWidth = roundTo(node.maxWidth as number, 2);
    }

    // CSS Transform (rotation)
    if (node.rotation !== undefined && node.rotation !== 0) {
      // Convert radians to degrees
      const degrees = roundTo(((node.rotation as number) * 180) / Math.PI, 2);
      cssNode.transform = `rotate(${degrees}deg)`;
    }

    // Overflow (clipping)
    if (node.clipsContent === true) {
      cssNode.overflow = "hidden";
    }

    // CSS Visual Styling
    const fills = node.fills as FigmaRawPaint[] | undefined;
    if (fills && fills.length > 0) {
      const fill = fills[0];
      const processedFill = processPaint(fill);

      if (typeof processedFill === "string") {
        // Solid color - use backgroundColor
        cssNode.backgroundColor = processedFill;
      } else if (processedFill) {
        // Gradient/image - use background array
        cssNode.background = [processedFill];
      }
    }

    // Border (strokes)
    const strokes = node.strokes as FigmaRawPaint[] | undefined;
    if (strokes && strokes.length > 0) {
      const stroke = strokes[0];
      const processedStroke = processPaint(stroke);

      if (typeof processedStroke === "string") {
        cssNode.border = processedStroke;
      }

      if (node.strokeWeight !== undefined && node.strokeWeight !== 0) {
        cssNode.borderWidth = node.strokeWeight as number;
      }
    }

    // Border radius
    const rectangleCornerRadii = node.rectangleCornerRadii as number[] | undefined;
    if (rectangleCornerRadii) {
      // Individual corner radii [topLeft, topRight, bottomRight, bottomLeft]
      const allSame = rectangleCornerRadii.every((r) => r === rectangleCornerRadii[0]);

      if (allSame && rectangleCornerRadii[0] !== 0) {
        cssNode.borderRadius = rectangleCornerRadii[0];
      } else if (!allSame) {
        cssNode.borderRadius = rectangleCornerRadii;
      }
    } else if (node.cornerRadius !== undefined && node.cornerRadius !== 0) {
      cssNode.borderRadius = node.cornerRadius as number;
    }

    // Box shadow (effects)
    type FigmaEffect = {
      type: string;
      color?: unknown;
      offset?: { x: number; y: number };
      radius?: number;
      spread?: number;
    };
    const effects = node.effects as FigmaEffect[] | undefined;
    if (effects && effects.length > 0) {
      const shadows = effects
        .filter((e) => e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW")
        .map((e) => {
          const color = formatColor(e.color);
          const offsetX = e.offset?.x ?? 0;
          const offsetY = e.offset?.y ?? 0;
          const blur = e.radius ?? 0;
          const spread = e.spread ?? 0;
          return `${offsetX}px ${offsetY}px ${blur}px ${spread}px ${color}`;
        });

      if (shadows.length > 0) {
        cssNode.boxShadow = shadows.join(", ");
      }

      // Blur effects (LAYER_BLUR, BACKGROUND_BLUR)
      const blurs = effects
        .filter((e) => e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR")
        .map((e) => {
          const radius = e.radius ?? 0;
          return e.type === "BACKGROUND_BLUR"
            ? `backdrop-filter: blur(${radius}px)`
            : `blur(${radius}px)`;
        });

      if (blurs.length > 0) {
        // Find layer blur (backdrop blur not currently supported)
        const layerBlur = blurs.find((b) => !b.startsWith("backdrop"));

        if (layerBlur) {
          cssNode.filter = layerBlur;
        }
        // Note: backdrop-filter would need its own property, but it's rare
      }
    }

    // Opacity (skip if 1)
    if (node.opacity !== undefined && node.opacity !== 1) {
      cssNode.opacity = roundTo(node.opacity as number, 3);
    }

    // CSS Text Styling (for TEXT nodes)
    if (node.type === "TEXT") {
      // Process text styles from boundVariables or direct properties
      const style = (node.style ?? {}) as Record<string, unknown>;

      if (fills && fills.length > 0) {
        const textFill = processPaint(fills[0]);
        if (typeof textFill === "string") {
          cssNode.color = textFill;
        }
      }

      const fontName = node.fontName as { family?: string; style?: string } | undefined;

      if (style.fontFamily || fontName?.family) {
        cssNode.fontFamily = (style.fontFamily ?? fontName?.family) as string;
      }

      if (style.fontSize || node.fontSize) {
        cssNode.fontSize = (style.fontSize ?? node.fontSize) as number;
      }

      if (style.fontWeight || node.fontWeight) {
        cssNode.fontWeight = (style.fontWeight ?? node.fontWeight) as number;
      }

      // Font style (italic)
      if (style.fontStyle || fontName?.style) {
        const fontStyle = (style.fontStyle ?? fontName?.style) as string | undefined;
        if (fontStyle && fontStyle.toLowerCase().includes("italic")) {
          cssNode.fontStyle = "italic";
        }
      }

      if (style.lineHeightPx) {
        cssNode.lineHeight = roundTo(style.lineHeightPx as number, 2);
      } else if (style.lineHeightPercent) {
        cssNode.lineHeight = `${roundTo(style.lineHeightPercent as number, 0)}%`;
      }

      if (style.letterSpacing) {
        cssNode.letterSpacing = roundTo(style.letterSpacing as number, 2);
      }

      if (style.textAlignHorizontal) {
        cssNode.textAlign = (style.textAlignHorizontal as string).toLowerCase();
      }

      // Text decoration (underline, strikethrough)
      if (style.textDecoration && style.textDecoration !== "NONE") {
        cssNode.textDecoration = (style.textDecoration as string).toLowerCase().replace("_", "-");
      }

      // Text transform (uppercase, lowercase, capitalize)
      if (style.textCase && style.textCase !== "ORIGINAL") {
        const caseMap: Record<string, string> = {
          UPPER: "uppercase",
          LOWER: "lowercase",
          TITLE: "capitalize",
        };
        cssNode.textTransform =
          caseMap[style.textCase as string] ?? (style.textCase as string).toLowerCase();
      }

      // Actual text content
      if (node.characters) {
        cssNode.text = node.characters as string;
      }
    }

    // Visibility (skip if true)
    if (node.visible !== undefined && node.visible !== true) {
      cssNode.visible = node.visible as boolean;
    }

    // BlendMode (skip if NORMAL or PASS_THROUGH)
    if (node.blendMode && node.blendMode !== "NORMAL" && node.blendMode !== "PASS_THROUGH") {
      cssNode.blendMode = node.blendMode as string;
    }

    // Component reference
    if (node.componentId) {
      const componentId = node.componentId as string;
      cssNode.componentId = componentId;

      if (!components[componentId]) {
        const meta = componentMap[componentId] as
          | { key?: string; name?: string; description?: string }
          | undefined;
        components[componentId] = {
          key: meta?.key ?? componentId,
          name: meta?.name ?? node.name ?? "Unknown Component",
          ...(meta?.description ? { description: meta.description } : {}),
        };
      }
    }

    nodes[nodeId] = cssNode;

    // Process children recursively
    if (node.children) {
      for (const child of node.children) {
        processNode(child, originalId);
      }
    }
  }

  /**
   * Maps Figma counterAxisAlignItems to CSS align-items
   */
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

  /**
   * Maps Figma primaryAxisAlignItems to CSS justify-content
   */
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

  // Start processing from root
  // The API wraps the node tree under a `document` key; fall back to the root itself.
  const rootDocument = rootNode.document as FigmaRawNode | undefined;
  const rootSelf = rootNode as FigmaRawNode;
  const rootId = idMapper.map(rootDocument?.id ?? rootSelf.id);
  processNode(rootDocument ?? rootSelf);

  // Build variables dictionary with only used variables
  if (variableContext && usedVariables.size > 0) {
    for (const variableId of usedVariables) {
      let value = variableContext.variableValues.get(variableId);
      if (value !== undefined) {
        // Round color values
        if (typeof value === "object" && value !== null && "r" in value) {
          value = {
            r: roundTo(value.r, 3),
            g: roundTo(value.g, 3),
            b: roundTo(value.b, 3),
            a: roundTo(value.a, 3),
          };
        }
        variables[variableId] = value;
      }
    }
  }

  const response: MCPResponse = {
    root: rootId,
    nodes,
  };

  // Only include optional fields if they have content
  if (Object.keys(variables).length > 0) {
    response.variables = variables;
  }

  if (Object.keys(components).length > 0) {
    response.components = components;
  }

  // styleMap is accepted for API compatibility but not used in this reducer —
  // styles are inlined directly from node properties.
  void styleMap;

  return response;
}
