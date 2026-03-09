import type { MCPResponse, LayoutNode, NodeStyle, Paint } from "./types.js";
import { mapAutoLayoutToFlex } from "./layoutResolver.js";
import { IdMapper } from "./idMapper.js";

/**
 * Builds a normalized graph from a Figma node tree.
 * This separates structure (nodes), layout (flex), and styling (stylesPayload, paints).
 *
 * Optimizations:
 * - IDs are mapped for token efficiency (nested IDs shortened)
 * - Redundant defaults are omitted (blendMode "PASS_THROUGH", locked false, opacity 1, etc.)
 * - flexTree removed (redundant with nodes[].flex)
 */
export function buildNormalizedGraph(rootNode: any, styleMap: Record<string, any>): MCPResponse {
  const nodes: Record<string, LayoutNode> = {};
  const stylesPayload: Record<string, NodeStyle> = {};
  const paints: Record<string, Paint> = {};
  const styles: Record<string, any> = styleMap;
  const components: Record<string, any> = {};

  const idMapper = new IdMapper();
  let paintIdCounter = 0;

  function processPaint(paint: any): string {
    // Create a stable key for deduplication
    const key = JSON.stringify(paint);
    const existingPaint = Object.entries(paints).find(([_, p]) => JSON.stringify(p) === key);

    if (existingPaint) {
      return existingPaint[0];
    }

    const id = `paint_${paintIdCounter++}`;
    paints[id] = paint;
    return id;
  }

  function processNode(node: any, parent: string | null = null): void {
    if (!node) return;

    const originalId = node.id;
    const nodeId = idMapper.map(originalId);

    // Build layout node (omit redundant defaults)
    const layoutNode: LayoutNode = {
      id: nodeId,
      type: node.type,
      name: node.name,
      parent: parent ? idMapper.map(parent) : null,
      children: node.children?.map((c: any) => idMapper.map(c.id)),
      absoluteBoundingBox: node.absoluteBoundingBox,
      constraints: node.constraints,
    };

    // Only include non-default values
    // visible: omit if undefined (most common case is undefined)
    if (node.visible !== undefined) {
      layoutNode.visible = node.visible;
    }

    // locked: omit if undefined or false (defaults are undefined/false)
    if (node.locked === true) {
      layoutNode.locked = node.locked;
    }

    // opacity: omit if undefined or 1 (default is 1)
    if (node.opacity !== undefined && node.opacity !== 1) {
      layoutNode.opacity = node.opacity;
    }

    // blendMode: omit if "PASS_THROUGH" (100% of nodes have this)
    if (node.blendMode && node.blendMode !== "PASS_THROUGH") {
      layoutNode.blendMode = node.blendMode;
    }

    // Preserve component relationships
    if (node.componentId) {
      layoutNode.componentId = idMapper.map(node.componentId);
    }
    if (node.componentProperties) {
      layoutNode.componentProperties = node.componentProperties;
    }

    // If this is a component, store it
    if (node.type === "COMPONENT") {
      components[nodeId] = {
        key: nodeId,
        name: node.name,
        description: node.description,
      };
    }

    // Map auto-layout to flex primitives
    if (node.layoutMode) {
      layoutNode.layout = {
        layoutMode: node.layoutMode,
        primaryAxisSizingMode: node.primaryAxisSizingMode,
        counterAxisSizingMode: node.counterAxisSizingMode,
        primaryAxisAlignItems: node.primaryAxisAlignItems,
        counterAxisAlignItems: node.counterAxisAlignItems,
        itemSpacing: node.itemSpacing,
        paddingLeft: node.paddingLeft,
        paddingRight: node.paddingRight,
        paddingTop: node.paddingTop,
        paddingBottom: node.paddingBottom,
        layoutWrap: node.layoutWrap,
        layoutGrow: node.layoutGrow,
      };

      const flex = mapAutoLayoutToFlex(node);
      if (flex) {
        layoutNode.flex = flex;
      }
    }

    nodes[nodeId] = layoutNode;

    // Process styling
    const nodeStyle: NodeStyle = {};

    if (node.fills && node.fills.length > 0) {
      nodeStyle.fills = node.fills.map((fill: any) => {
        const paintId = processPaint(fill);
        return paintId;
      });
    }

    if (node.strokes && node.strokes.length > 0) {
      nodeStyle.strokes = node.strokes.map((stroke: any) => {
        const paintId = processPaint(stroke);
        return paintId;
      });
      nodeStyle.strokeWeight = node.strokeWeight;
      nodeStyle.strokeAlign = node.strokeAlign;
    }

    if (node.effects && node.effects.length > 0) {
      nodeStyle.effects = node.effects;
    }

    if (node.cornerRadius !== undefined) {
      nodeStyle.cornerRadius = node.cornerRadius;
    }

    // Text styling
    if (node.type === "TEXT") {
      nodeStyle.textStyle = {
        fontFamily: node.style?.fontFamily,
        fontWeight: node.style?.fontWeight,
        fontSize: node.style?.fontSize,
        lineHeight: node.style?.lineHeightPx,
        letterSpacing: node.style?.letterSpacing,
        textAlignHorizontal: node.style?.textAlignHorizontal,
        textAlignVertical: node.style?.textAlignVertical,
        textAutoResize: node.textAutoResize,
        textCase: node.style?.textCase,
        textDecoration: node.style?.textDecoration,
        characters: node.characters,
      };
    }

    // Only add to stylesPayload if there's actual styling
    if (Object.keys(nodeStyle).length > 0) {
      stylesPayload[nodeId] = nodeStyle;
    }

    // Recurse into children
    if (node.children) {
      for (const child of node.children) {
        processNode(child, originalId);
      }
    }
  }

  // Start processing from root
  processNode(rootNode.document ?? rootNode);

  return {
    root: idMapper.map(rootNode.document?.id ?? rootNode.id),
    nodes,
    stylesPayload,
    paints,
    styles,
    components,
  };
}
