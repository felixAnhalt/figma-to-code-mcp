import type { FigmaRawNode, FigmaRawPaint } from "./types";
import { extractFillColor, parseRelativeTransform } from "./utils";
import type { SvgPathEntry } from "../svg-writer";
import { extractVectorPaths } from "./vector";

const VECTOR_CONTAINER_TYPES = new Set(["GROUP", "FRAME"]);

export function getVectorMerge(node: FigmaRawNode, children: FigmaRawNode[]) {
  if (!VECTOR_CONTAINER_TYPES.has(node.type) || node.isMask || children.length < 2) return;
  if (!(node.children ?? []).every(isSupportedVectorSubtree)) return;
  const directVectors = children.every((child) => child.type === "VECTOR");
  const entries = getMergeEntries(node, children, directVectors);
  if (!entries || entries.length < 2) return;
  const rawBounds = node.absoluteBoundingBox;
  const bounds =
    typeof rawBounds?.width === "number" && typeof rawBounds.height === "number"
      ? { x: 0, y: 0, width: rawBounds.width, height: rawBounds.height }
      : undefined;
  const name = directVectors || node.type === "FRAME" ? children[0].name : node.name;
  return { entries, bounds, name };
}

function getMergeEntries(node: FigmaRawNode, children: FigmaRawNode[], directVectors: boolean) {
  if (directVectors) return extractVectorEntriesFromChildren(children);
  if (node.type === "GROUP") return extractVectorEntriesFromDeepGroup(node);
  const groups = children.every(
    (child) =>
      child.type === "GROUP" &&
      (child.children ?? []).every(
        (nested) => nested.visible === false || nested.type === "VECTOR",
      ),
  );
  if (!groups) return undefined;
  const bounds = node.absoluteBoundingBox;
  return extractVectorEntriesFromGroupChildren(children, {
    x: bounds?.x ?? 0,
    y: bounds?.y ?? 0,
  });
}

function isSupportedVectorSubtree(node: FigmaRawNode): boolean {
  if (node.visible === false) return true;
  if (hasUnsupportedMergeProperties(node)) return false;
  if (node.type === "VECTOR") return extractVectorPaths(node) !== undefined;
  if (!VECTOR_CONTAINER_TYPES.has(node.type)) return false;
  const fills = node.fills as FigmaRawPaint[] | undefined;
  if (fills?.some((fill) => fill.visible !== false && fill.type !== "NONE")) return false;
  return (node.children ?? []).every(isSupportedVectorSubtree);
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

export function extractVectorEntriesFromChildren(children: FigmaRawNode[]): SvgPathEntry[] {
  const entries: SvgPathEntry[] = [];

  for (const child of children) {
    if (child.visible === false) continue;
    if ((child as FigmaRawNode).isMask) continue;
    const childPaths = extractVectorPaths(child);
    if (!childPaths) continue;

    const fillColor = extractFillColor(child.fills as FigmaRawPaint[] | undefined);
    const pathsWithFill = childPaths.map((p) => ({ ...p, fillColor }));
    const transform = parseRelativeTransform(child.relativeTransform as number[][] | undefined);

    entries.push({ paths: pathsWithFill, transform });
  }

  return entries;
}

export function collectVectorsDeep(
  node: FigmaRawNode,
  parentX: number = 0,
  parentY: number = 0,
): Array<{ node: FigmaRawNode; offsetX: number; offsetY: number }> {
  const result: Array<{ node: FigmaRawNode; offsetX: number; offsetY: number }> = [];

  const children = node.children ?? [];
  for (const child of children) {
    const childNode = child as FigmaRawNode;
    if (childNode.visible === false) continue;

    if (childNode.type === "VECTOR") {
      if (childNode.isMask === true) continue;
      result.push({ node: childNode, offsetX: parentX, offsetY: parentY });
    } else if (childNode.type === "GROUP" || childNode.type === "FRAME") {
      if (childNode.isMask === true) continue;
      const childBounds = childNode.absoluteBoundingBox as { x: number; y: number } | undefined;
      const offsetX = parentX + (childBounds?.x ?? 0);
      const offsetY = parentY + (childBounds?.y ?? 0);
      result.push(...collectVectorsDeep(childNode, offsetX, offsetY));
    }
  }

  return result;
}

export function extractVectorEntriesFromDeepGroup(groupNode: FigmaRawNode): SvgPathEntry[] {
  const vectorInfos = collectVectorsDeep(groupNode);
  const entries: SvgPathEntry[] = [];

  for (const { node, offsetX, offsetY } of vectorInfos) {
    const childPaths = extractVectorPaths(node);
    if (!childPaths) continue;

    const fillColor = extractFillColor(node.fills as FigmaRawPaint[] | undefined);
    const pathsWithFill = childPaths.map((p) => ({ ...p, fillColor }));

    const relativeTransform = node.relativeTransform as number[][] | undefined;
    const baseTransform = parseRelativeTransform(relativeTransform);

    let transform: [number, number, number, number, number, number] | undefined;
    if (baseTransform) {
      transform = baseTransform;
    } else {
      transform = [1, 0, 0, 1, offsetX, offsetY];
    }

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
  const entries: SvgPathEntry[] = [];

  for (const group of groups) {
    if (group.visible === false) continue;
    const groupTransform = parseRelativeTransform(
      group.relativeTransform as number[][] | undefined,
    );
    const groupChildren = group.children ?? [];

    for (const child of groupChildren) {
      if (child.visible === false) continue;
      if ((child as FigmaRawNode).isMask === true) continue;
      const childPaths = extractVectorPaths(child as FigmaRawNode);
      if (!childPaths) continue;

      const fillColor = extractFillColor(
        (child as FigmaRawNode).fills as FigmaRawPaint[] | undefined,
      );
      const pathsWithFill = childPaths.map((p) => ({ ...p, fillColor }));

      const childTransform = parseRelativeTransform(
        (child as FigmaRawNode).relativeTransform as number[][] | undefined,
      );

      let finalTransform: [number, number, number, number, number, number] | undefined;

      if (childTransform) {
        if (groupTransform) {
          finalTransform = combineTransforms(groupTransform, childTransform);
        } else {
          finalTransform = childTransform;
        }
      } else if (groupTransform) {
        finalTransform = [1, 0, 0, 1, groupTransform[4], groupTransform[5]];
      } else if (offset.x !== 0 || offset.y !== 0) {
        finalTransform = [1, 0, 0, 1, offset.x, offset.y];
      }

      entries.push({ paths: pathsWithFill, transform: finalTransform });
    }
  }

  return entries;
}

function combineTransforms(
  a: [number, number, number, number, number, number],
  b: [number, number, number, number, number, number],
): [number, number, number, number, number, number] {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
