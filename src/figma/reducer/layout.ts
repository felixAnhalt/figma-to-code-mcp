import type { Layout, LayoutVarRefs } from "../types";
import type { FigmaRawNode } from "./types";
import { mapAlignItems, mapJustifyContent, roundTo } from "./utils";
import { resolveVariableName } from "./paint";
import type { VariableResolutionContext } from "../variableResolver";
import {
  getLocalSize,
  getParentLocalPosition,
  hasPositionedChildren,
  isAutoLayout,
  isPositionedChild,
} from "./positioning";

export function extractLayoutFromNode(
  node: FigmaRawNode,
  variableContext?: VariableResolutionContext | null,
  parent?: FigmaRawNode,
): Layout | undefined {
  const layout: Layout = {};
  const varRefs: LayoutVarRefs = {};
  if (isAutoLayout(node)) extractAutoLayout(node, layout, varRefs, variableContext);
  if (node.clipsContent === true) layout.overflow = "hidden";
  extractPositioning(node, layout, parent);
  extractSizing(node, layout, parent);
  extractSizeConstraints(node, layout);
  if (layout.position !== "absolute" && (node.layoutGrow === 1 || node.layoutAlign === "STRETCH")) {
    layout.grow = true;
  }
  if (Object.keys(varRefs).length > 0) layout._varRefs = varRefs;
  return Object.keys(layout).length > 0 ? layout : undefined;
}

function extractAutoLayout(
  node: FigmaRawNode,
  layout: Layout,
  varRefs: LayoutVarRefs,
  variableContext?: VariableResolutionContext | null,
) {
  const boundVars = node.boundVariables as Record<string, unknown> | undefined;
  layout.direction = node.layoutMode === "HORIZONTAL" ? "row" : "column";
  const align = mapAlignItems(node.counterAxisAlignItems);
  if (align !== "stretch") layout.align = align;
  const justify = mapJustifyContent(node.primaryAxisAlignItems);
  if (justify !== "flex-start") layout.justify = justify;
  if (node.itemSpacing !== undefined && node.itemSpacing !== 0) {
    layout.gap = node.itemSpacing;
    const name = resolveVariableName(boundVars?.itemSpacing, variableContext);
    if (name) varRefs.gap = name;
  }
  extractPadding(node, layout);
  extractPaddingVarRefs(node, varRefs, variableContext);
  if (node.layoutWrap === "WRAP") layout.wrap = true;
}

function extractPadding(node: FigmaRawNode, layout: Layout) {
  const left = node.paddingLeft ?? 0;
  const right = node.paddingRight ?? 0;
  const top = node.paddingTop ?? 0;
  const bottom = node.paddingBottom ?? 0;
  if (!left && !right && !top && !bottom) return;
  if (top === right && right === bottom && bottom === left) layout.padding = top;
  else if (top === bottom && left === right) layout.padding = [top, right];
  else layout.padding = { top, right, bottom, left };
}

function extractPaddingVarRefs(
  node: FigmaRawNode,
  varRefs: LayoutVarRefs,
  variableContext?: VariableResolutionContext | null,
) {
  if (!node.paddingLeft && !node.paddingRight && !node.paddingTop && !node.paddingBottom) return;
  const boundVars = node.boundVariables as Record<string, unknown> | undefined;
  const top = resolveVariableName(boundVars?.paddingTop, variableContext);
  const right = resolveVariableName(boundVars?.paddingRight, variableContext);
  const bottom = resolveVariableName(boundVars?.paddingBottom, variableContext);
  const left = resolveVariableName(boundVars?.paddingLeft, variableContext);
  if (top && top === right && top === bottom && top === left) {
    Object.assign(varRefs, {
      paddingTop: top,
      paddingRight: top,
      paddingBottom: top,
      paddingLeft: top,
    });
  }
}

function extractPositioning(node: FigmaRawNode, layout: Layout, parent?: FigmaRawNode) {
  if (isPositionedChild(node, parent)) {
    layout.position = "absolute";
    Object.assign(layout, getParentLocalPosition(node, parent));
  } else if (hasPositionedChildren(node)) {
    layout.position = "relative";
  }
}

function extractSizing(node: FigmaRawNode, layout: Layout, parent?: FigmaRawNode) {
  const size = getLocalSize(node, parent);
  const implicitSizing =
    !isAutoLayout(node) && (layout.position === "relative" || !parent || !isAutoLayout(parent))
      ? "FIXED"
      : undefined;
  const positioned = layout.position === "absolute";
  layout.width = extractDimension(
    size.width,
    node.layoutSizingHorizontal ?? implicitSizing,
    positioned,
  );
  layout.height = extractDimension(
    size.height,
    node.layoutSizingVertical ?? implicitSizing,
    positioned,
  );
  if (layout.width === undefined) delete layout.width;
  if (layout.height === undefined) delete layout.height;
}

function extractDimension(
  size: number | undefined,
  sizing: string | undefined,
  preserveSize: boolean,
) {
  if (size !== undefined && (preserveSize || sizing === "FIXED")) return `${roundTo(size, 2)}px`;
  if (sizing === "FILL") return "100%";
  if (sizing === "HUG") return "fit-content";
  return undefined;
}

function extractSizeConstraints(node: FigmaRawNode, layout: Layout) {
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
}
