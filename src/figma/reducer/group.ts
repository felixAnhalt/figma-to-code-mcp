import type { VariableResolutionContext } from "~/figma/variableResolver";
import type { FigmaRawNode, FigmaRawPaint } from "./types";
import { roundTo } from "./utils";
import type { SvgPathEntry } from "../svg-writer";
import type { Layout } from "../types";
import { extractVectorPaths, getVectorPaintColor } from "./vector";
import {
  getFiniteTransform,
  getLocalSize,
  getParentLocalPosition,
  hasPositionedChildren,
  hasUntransformedAxes,
  isAutoLayout,
} from "./positioning";

const VECTOR_CONTAINER_TYPES = new Set(["GROUP", "FRAME"]);

export function getVectorMerge(
  node: FigmaRawNode,
  children: FigmaRawNode[],
  variableContext?: VariableResolutionContext | null,
) {
  if (!VECTOR_CONTAINER_TYPES.has(node.type) || node.isMask || children.length < 2) return;
  if (isAutoLayout(node)) return;
  const source = node.children ? node : { ...node, children };
  if (!(source.children ?? []).every((child) => isSupportedVectorSubtree(child, source))) return;
  const directVectors = children.every((child) => child.type === "VECTOR");
  const entries = extractVectorEntriesFromDeepGroup(source, variableContext);
  if (entries.length < 2) return;
  const { width, height } = getLocalSize(node);
  const bounds =
    width !== undefined && height !== undefined ? { x: 0, y: 0, width, height } : undefined;
  const positioned = hasPositionedChildren(source);
  if (positioned && !bounds) return;
  const layout = positioned && bounds ? mergedCanvasLayout(bounds.width, bounds.height) : undefined;
  const name = directVectors || node.type === "FRAME" ? children[0].name : node.name;
  return { entries, bounds, name, layout };
}

function mergedCanvasLayout(width: number, height: number): Layout {
  return {
    position: "absolute",
    left: 0,
    top: 0,
    width: `${roundTo(width, 2)}px`,
    height: `${roundTo(height, 2)}px`,
  };
}

function isSupportedVectorSubtree(node: FigmaRawNode, parent: FigmaRawNode): boolean {
  if (node.visible === false) return true;
  if (hasUnsupportedMergeProperties(node) || !hasMergeCoordinates(node, parent)) return false;
  if (node.type === "VECTOR") return extractVectorPaths(node) !== undefined;
  if (!VECTOR_CONTAINER_TYPES.has(node.type) || isAutoLayout(node) || !hasUntransformedAxes(node))
    return false;
  const fills = node.fills as FigmaRawPaint[] | undefined;
  if (fills?.some((fill) => fill.visible !== false && fill.type !== "NONE")) return false;
  return (node.children ?? []).every((child) => isSupportedVectorSubtree(child, node));
}

function hasMergeCoordinates(node: FigmaRawNode, parent: FigmaRawNode): boolean {
  if (node.relativeTransform !== undefined) return getFiniteTransform(node) !== undefined;
  const bounds = node.absoluteBoundingBox;
  const hasPositionEvidence =
    node.layoutPositioning === "ABSOLUTE" || bounds?.x !== undefined || bounds?.y !== undefined;
  return !hasPositionEvidence || getParentLocalPosition(node, parent) !== undefined;
}

function hasUnsupportedMergeProperties(node: FigmaRawNode): boolean {
  const fills = (node.fills as FigmaRawPaint[] | undefined)?.filter(
    (fill) => fill.visible !== false,
  );
  const strokes = node.strokes as FigmaRawPaint[] | undefined;
  const effects = node.effects as Array<{ visible?: boolean }> | undefined;
  return (
    node.isMask === true ||
    (node.opacity !== undefined && node.opacity !== 1) ||
    node.clipsContent === true ||
    (node.rotation !== undefined && node.rotation !== 0) ||
    (node.blendMode !== undefined && !["NORMAL", "PASS_THROUGH"].includes(node.blendMode)) ||
    (fills?.length ?? 0) > 1 ||
    (fills?.some((fill) => fill.type !== "SOLID") ?? false) ||
    (strokes?.some((stroke) => stroke.visible !== false) ?? false) ||
    (effects?.some((effect) => effect.visible !== false) ?? false)
  );
}

export function extractVectorEntriesFromChildren(
  children: FigmaRawNode[],
  parent?: FigmaRawNode,
  variableContext?: VariableResolutionContext | null,
): SvgPathEntry[] {
  const entries: SvgPathEntry[] = [];

  for (const child of children) {
    if (child.visible === false) continue;
    if ((child as FigmaRawNode).isMask) continue;
    const childPaths = extractVectorPaths(child);
    if (!childPaths) continue;

    const fillColor = getVectorPaintColor(child, variableContext);
    const pathsWithFill = childPaths.map((p) => ({ ...p, fillColor }));
    const transform = getVectorTransform(child, parent);

    entries.push({ paths: pathsWithFill, transform });
  }

  return entries;
}

function getVectorTransform(node: FigmaRawNode, parent?: FigmaRawNode) {
  const transform = getFiniteTransform(node);
  if (transform) return transform;
  const position = getParentLocalPosition(node, parent);
  const translation: SvgPathEntry["transform"] = position
    ? [1, 0, 0, 1, position.left, position.top]
    : undefined;
  return translation;
}

type CollectedVector = {
  node: FigmaRawNode;
  parent: FigmaRawNode;
  offsetX: number;
  offsetY: number;
};

export function collectVectorsDeep(
  node: FigmaRawNode,
  parentX: number = 0,
  parentY: number = 0,
): CollectedVector[] {
  const result: CollectedVector[] = [];

  const children = node.children ?? [];
  for (const child of children) {
    const childNode = child as FigmaRawNode;
    if (childNode.visible === false) continue;

    if (childNode.type === "VECTOR") {
      if (childNode.isMask === true) continue;
      result.push({ node: childNode, parent: node, offsetX: parentX, offsetY: parentY });
    } else if (childNode.type === "GROUP" || childNode.type === "FRAME") {
      if (childNode.isMask === true) continue;
      const position = getParentLocalPosition(childNode, node);
      const offsetX = parentX + (position?.left ?? 0);
      const offsetY = parentY + (position?.top ?? 0);
      result.push(...collectVectorsDeep(childNode, offsetX, offsetY));
    }
  }

  return result;
}

export function extractVectorEntriesFromDeepGroup(
  groupNode: FigmaRawNode,
  variableContext?: VariableResolutionContext | null,
): SvgPathEntry[] {
  const vectorInfos = collectVectorsDeep(groupNode);
  const entries: SvgPathEntry[] = [];

  for (const { node, parent, offsetX, offsetY } of vectorInfos) {
    const childPaths = extractVectorPaths(node);
    if (!childPaths) continue;

    const fillColor = getVectorPaintColor(node, variableContext);
    const pathsWithFill = childPaths.map((p) => ({ ...p, fillColor }));

    const baseTransform = getVectorTransform(node, parent) ?? [1, 0, 0, 1, 0, 0];
    const transform: SvgPathEntry["transform"] = [
      baseTransform[0],
      baseTransform[1],
      baseTransform[2],
      baseTransform[3],
      baseTransform[4] + offsetX,
      baseTransform[5] + offsetY,
    ];

    entries.push({ paths: pathsWithFill, transform });
  }

  return entries;
}

export function countVectorsInGroupDeep(groupNode: FigmaRawNode): number {
  return collectVectorsDeep(groupNode).length;
}

export function extractVectorEntriesFromGroupChildren(
  groups: FigmaRawNode[],
  offset: { x: number; y: number; width?: number; height?: number },
): SvgPathEntry[] {
  return extractVectorEntriesFromDeepGroup({
    id: "vector-merge-parent",
    type: "FRAME",
    absoluteBoundingBox: offset,
    children: groups,
  });
}
