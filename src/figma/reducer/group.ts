import type { FigmaRawNode, FigmaRawPaint } from "./types";
import { extractFillColor, parseRelativeTransform } from "./utils";
import type { SvgPathEntry } from "../svg-writer";
import { extractVectorPaths } from "./vector";

export function extractVectorEntriesFromChildren(children: FigmaRawNode[]): SvgPathEntry[] {
  const entries: SvgPathEntry[] = [];

  for (const child of children) {
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
    const groupChildren = group.children ?? [];
    for (const child of groupChildren) {
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
        finalTransform = childTransform;
      } else if (offset.x !== 0 || offset.y !== 0) {
        finalTransform = [1, 0, 0, 1, offset.x, offset.y];
      }

      entries.push({ paths: pathsWithFill, transform: finalTransform });
    }
  }

  return entries;
}
