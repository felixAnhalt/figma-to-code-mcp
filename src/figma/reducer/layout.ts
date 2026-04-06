import type { Layout } from "../types";
import type { FigmaRawNode } from "./types";
import { mapAlignItems, mapJustifyContent, roundTo } from "./utils";

export function extractLayoutFromNode(node: FigmaRawNode): Layout | undefined {
  const layout: Layout = {};

  if (node.layoutMode) {
    layout.direction = node.layoutMode === "HORIZONTAL" ? "row" : "column";

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

  if (node.layoutSizingHorizontal === "FILL") layout.width = "100%";
  else if (node.layoutSizingHorizontal === "HUG") layout.width = "fit-content";
  if (node.layoutSizingVertical === "FILL") layout.height = "100%";
  else if (node.layoutSizingVertical === "HUG") layout.height = "fit-content";

  if (node.layoutGrow === 1) layout.grow = true;

  return Object.keys(layout).length > 0 ? layout : undefined;
}
