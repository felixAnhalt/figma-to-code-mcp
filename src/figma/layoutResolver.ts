import type { FlexNode } from "./types.js";

/**
 * Maps Figma auto-layout properties to Flexbox primitives.
 * This makes it easier for LLMs to understand the layout structure.
 *
 * Optimizations:
 * - Omits gap if 0 (default)
 * - Omits padding if all values are 0 (default)
 */
export function mapAutoLayoutToFlex(node: any): FlexNode | null {
  if (!node.layoutMode) return null;

  const flex: any = {
    direction: node.layoutMode === "HORIZONTAL" ? "row" : "column",
    alignItems: node.counterAxisSizingMode === "FIXED" ? "flex-start" : "stretch",
    justifyContent: node.primaryAxisSizingMode === "AUTO" ? "flex-start" : "space-between",
    children: node.children?.map((c: any) => c.id) ?? [],
  };

  // Only include gap if non-zero
  const gap = node.itemSpacing ?? 0;
  if (gap !== 0) {
    flex.gap = gap;
  }

  // Only include padding if at least one value is non-zero
  const paddingTop = node.paddingTop ?? 0;
  const paddingBottom = node.paddingBottom ?? 0;
  const paddingLeft = node.paddingLeft ?? 0;
  const paddingRight = node.paddingRight ?? 0;

  if (paddingTop !== 0 || paddingBottom !== 0 || paddingLeft !== 0 || paddingRight !== 0) {
    flex.padding = {
      top: paddingTop,
      bottom: paddingBottom,
      left: paddingLeft,
      right: paddingRight,
    };
  }

  return flex as FlexNode;
}
