import type { FlexNode } from "./types.js";

/**
 * Maps Figma auto-layout properties to Flexbox primitives.
 * This makes it easier for LLMs to understand the layout structure.
 */
export function mapAutoLayoutToFlex(node: any): FlexNode | null {
  if (!node.layoutMode) return null;

  const flex: FlexNode = {
    direction: node.layoutMode === "HORIZONTAL" ? "row" : "column",
    gap: node.itemSpacing ?? 0,
    padding: {
      top: node.paddingTop ?? 0,
      bottom: node.paddingBottom ?? 0,
      left: node.paddingLeft ?? 0,
      right: node.paddingRight ?? 0,
    },
    alignItems: node.counterAxisSizingMode === "FIXED" ? "flex-start" : "stretch",
    justifyContent: node.primaryAxisSizingMode === "AUTO" ? "flex-start" : "space-between",
    children: node.children?.map((c: any) => c.id) ?? [],
  };

  return flex;
}
