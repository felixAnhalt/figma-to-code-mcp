import type { MCPResponse, Node, Paint, VariableValue } from "./types.js";
import { IdMapper } from "./idMapper.js";
import type { VariableResolutionContext } from "./variableResolver.js";
import { resolveVariable } from "./variableResolver.js";
import type { VariableAlias } from "@figma/rest-api-spec";

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
  rootNode: any,
  styleMap: Record<string, any>,
  variableContext?: VariableResolutionContext | null,
  componentMap: Record<string, any> = {},
): MCPResponse {
  const nodes: Record<string, Node> = {};
  const components: Record<string, any> = {};
  const variables: Record<string, VariableValue> = {};

  const idMapper = new IdMapper();
  const usedVariables = new Set<string>();

  /**
   * Converts RGBA object to CSS rgba() string or variable reference
   */
  function formatColor(color: any): string | undefined {
    if (!color) return undefined;

    // Check if it's a variable reference
    if (typeof color === "string" && color.startsWith("$")) {
      return color;
    }

    // Inline RGBA color
    if (typeof color === "object" && "r" in color) {
      const r = Math.round(color.r * 255);
      const g = Math.round(color.g * 255);
      const b = Math.round(color.b * 255);
      const a = color.a;
      return `rgba(${r}, ${g}, ${b}, ${a})`;
    }

    return undefined;
  }

  /**
   * Processes variable references - replaces with "$variableId" reference
   */
  function processVariableRef(obj: any): any {
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
    const result: any = {};
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
  function processPaint(paint: any): string | Paint | undefined {
    if (!paint) return undefined;

    const processed = processVariableRef(paint);
    if (!processed) return undefined;

    // Solid color - return inline
    if (processed.type === "SOLID" && processed.color) {
      return formatColor(processed.color);
    }

    // Gradient or image - return Paint object
    if (processed.type === "GRADIENT_LINEAR" || processed.type === "GRADIENT_RADIAL") {
      return {
        type: processed.type,
        gradientStops: processed.gradientStops?.map((stop: any) => ({
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
  function processNode(node: any, parent: string | null = null): void {
    if (!node) return;

    const originalId = node.id;
    const nodeId = idMapper.map(originalId);

    // Build CSS-aligned node
    const cssNode: Node = {
      id: nodeId,
      type: node.type,
      name: node.name,
      parent: parent ? idMapper.map(parent) : null,
      children: node.children?.map((c: any) => idMapper.map(c.id)),
    };

    // CSS Layout (flexbox)
    if (node.layoutMode) {
      cssNode.display = "flex";
      cssNode.flexDirection = node.layoutMode === "HORIZONTAL" ? "row" : "column";

      // Alignment
      cssNode.alignItems = mapAlignItems(node.counterAxisAlignItems);
      cssNode.justifyContent = mapJustifyContent(node.primaryAxisAlignItems);

      // Gap
      if (node.itemSpacing !== undefined && node.itemSpacing !== 0) {
        cssNode.gap = node.itemSpacing;
      }

      // Padding
      const hasNonZeroPadding =
        node.paddingLeft !== 0 ||
        node.paddingRight !== 0 ||
        node.paddingTop !== 0 ||
        node.paddingBottom !== 0;

      if (hasNonZeroPadding) {
        cssNode.padding = {
          top: node.paddingTop || 0,
          right: node.paddingRight || 0,
          bottom: node.paddingBottom || 0,
          left: node.paddingLeft || 0,
        };
      }

      // Flex wrap
      if (node.layoutWrap === "WRAP") {
        cssNode.flexWrap = "wrap";
      }
    }

    // CSS Sizing (explicit width/height when not using auto-layout)
    // Only add explicit dimensions if node has size and isn't using FILL/HUG
    if (node.size?.x !== undefined && node.layoutSizingHorizontal === "FIXED") {
      cssNode.width = roundTo(node.size.x, 2);
    }
    if (node.size?.y !== undefined && node.layoutSizingVertical === "FIXED") {
      cssNode.height = roundTo(node.size.y, 2);
    }

    // Min/Max width constraints
    if (node.minWidth !== undefined && node.minWidth !== null) {
      cssNode.minWidth = roundTo(node.minWidth, 2);
    }
    if (node.maxWidth !== undefined && node.maxWidth !== null) {
      cssNode.maxWidth = roundTo(node.maxWidth, 2);
    }

    // CSS Transform (rotation)
    if (node.rotation !== undefined && node.rotation !== 0) {
      // Convert radians to degrees
      const degrees = roundTo((node.rotation * 180) / Math.PI, 2);
      cssNode.transform = `rotate(${degrees}deg)`;
    }

    // Overflow (clipping)
    if (node.clipsContent === true) {
      cssNode.overflow = "hidden";
    }

    // CSS Visual Styling
    if (node.fills && node.fills.length > 0) {
      const fill = node.fills[0]; // Primary fill
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
    if (node.strokes && node.strokes.length > 0) {
      const stroke = node.strokes[0];
      const processedStroke = processPaint(stroke);

      if (typeof processedStroke === "string") {
        cssNode.border = processedStroke;
      }

      if (node.strokeWeight !== undefined && node.strokeWeight !== 0) {
        cssNode.borderWidth = node.strokeWeight;
      }
    }

    // Border radius
    if (node.rectangleCornerRadii) {
      // Individual corner radii [topLeft, topRight, bottomRight, bottomLeft]
      const radii = node.rectangleCornerRadii;
      const allSame = radii.every((r: number) => r === radii[0]);

      if (allSame && radii[0] !== 0) {
        cssNode.borderRadius = radii[0];
      } else if (!allSame) {
        cssNode.borderRadius = radii;
      }
    } else if (node.cornerRadius !== undefined && node.cornerRadius !== 0) {
      cssNode.borderRadius = node.cornerRadius;
    }

    // Box shadow (effects)
    if (node.effects && node.effects.length > 0) {
      const shadows = node.effects
        .filter((e: any) => e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW")
        .map((e: any) => {
          const color = formatColor(e.color);
          const offsetX = e.offset?.x || 0;
          const offsetY = e.offset?.y || 0;
          const blur = e.radius || 0;
          const spread = e.spread || 0;
          return `${offsetX}px ${offsetY}px ${blur}px ${spread}px ${color}`;
        });

      if (shadows.length > 0) {
        cssNode.boxShadow = shadows.join(", ");
      }

      // Blur effects (LAYER_BLUR, BACKGROUND_BLUR)
      const blurs = node.effects
        .filter((e: any) => e.type === "LAYER_BLUR" || e.type === "BACKGROUND_BLUR")
        .map((e: any) => {
          const radius = e.radius || 0;
          return e.type === "BACKGROUND_BLUR"
            ? `backdrop-filter: blur(${radius}px)`
            : `blur(${radius}px)`;
        });

      if (blurs.length > 0) {
        // Find layer blur (backdrop blur not currently supported)
        const layerBlur = blurs.find((b: string) => !b.startsWith("backdrop"));

        if (layerBlur) {
          cssNode.filter = layerBlur;
        }
        // Note: backdrop-filter would need its own property, but it's rare
      }
    }

    // Opacity (skip if 1)
    if (node.opacity !== undefined && node.opacity !== 1) {
      cssNode.opacity = roundTo(node.opacity, 3);
    }

    // CSS Text Styling (for TEXT nodes)
    if (node.type === "TEXT") {
      // Process text styles from boundVariables or direct properties
      const style = node.style || {};

      if (node.fills && node.fills.length > 0) {
        const textFill = processPaint(node.fills[0]);
        if (typeof textFill === "string") {
          cssNode.color = textFill;
        }
      }

      if (style.fontFamily || node.fontName?.family) {
        cssNode.fontFamily = style.fontFamily || node.fontName?.family;
      }

      if (style.fontSize || node.fontSize) {
        cssNode.fontSize = style.fontSize || node.fontSize;
      }

      if (style.fontWeight || node.fontWeight) {
        cssNode.fontWeight = style.fontWeight || node.fontWeight;
      }

      // Font style (italic)
      if (style.fontStyle || node.fontName?.style) {
        const fontStyle = style.fontStyle || node.fontName?.style;
        if (fontStyle && fontStyle.toLowerCase().includes("italic")) {
          cssNode.fontStyle = "italic";
        }
      }

      if (style.lineHeightPx) {
        cssNode.lineHeight = roundTo(style.lineHeightPx, 2);
      } else if (style.lineHeightPercent) {
        cssNode.lineHeight = `${roundTo(style.lineHeightPercent, 0)}%`;
      }

      if (style.letterSpacing) {
        cssNode.letterSpacing = roundTo(style.letterSpacing, 2);
      }

      if (style.textAlignHorizontal) {
        cssNode.textAlign = style.textAlignHorizontal.toLowerCase();
      }

      // Text decoration (underline, strikethrough)
      if (style.textDecoration && style.textDecoration !== "NONE") {
        cssNode.textDecoration = style.textDecoration.toLowerCase().replace("_", "-");
      }

      // Text transform (uppercase, lowercase, capitalize)
      if (style.textCase && style.textCase !== "ORIGINAL") {
        const caseMap: Record<string, string> = {
          UPPER: "uppercase",
          LOWER: "lowercase",
          TITLE: "capitalize",
        };
        cssNode.textTransform = caseMap[style.textCase] || style.textCase.toLowerCase();
      }

      // Actual text content
      if (node.characters) {
        cssNode.text = node.characters;
      }
    }

    // Visibility (skip if true)
    if (node.visible !== undefined && node.visible !== true) {
      cssNode.visible = node.visible;
    }

    // BlendMode (skip if NORMAL or PASS_THROUGH)
    if (node.blendMode && node.blendMode !== "NORMAL" && node.blendMode !== "PASS_THROUGH") {
      cssNode.blendMode = node.blendMode;
    }

    // Component reference
    if (node.componentId) {
      cssNode.componentId = node.componentId;

      if (!components[node.componentId]) {
        const meta = componentMap[node.componentId];
        components[node.componentId] = {
          key: meta?.key ?? node.componentId,
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
  const rootId = idMapper.map(rootNode.document?.id ?? rootNode.id);
  processNode(rootNode.document ?? rootNode);

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

  return response;
}
