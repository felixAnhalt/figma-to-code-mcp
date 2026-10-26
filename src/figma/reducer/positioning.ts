import type { FigmaRawNode } from "./types";
import { parseRelativeTransform } from "./utils";

const TRANSFORM_TOLERANCE = 1e-8;

export function isAutoLayout(node: FigmaRawNode): boolean {
  return node.layoutMode === "HORIZONTAL" || node.layoutMode === "VERTICAL";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function getFiniteTransform(node: FigmaRawNode) {
  const transform = parseRelativeTransform(node.relativeTransform);
  return transform?.every(isFiniteNumber) ? transform : undefined;
}

export function hasUntransformedAxes(node: FigmaRawNode): boolean {
  if (node.rotation !== undefined && Math.abs(node.rotation) > TRANSFORM_TOLERANCE) return false;
  if (node.relativeTransform === undefined) return true;
  const transform = getFiniteTransform(node);
  if (!transform) return false;
  const [a, b, c, d] = transform;
  return (
    Math.abs(a - 1) <= TRANSFORM_TOLERANCE &&
    Math.abs(b) <= TRANSFORM_TOLERANCE &&
    Math.abs(c) <= TRANSFORM_TOLERANCE &&
    Math.abs(d - 1) <= TRANSFORM_TOLERANCE
  );
}

export function getParentLocalPosition(node: FigmaRawNode, parent?: FigmaRawNode) {
  const transform = getFiniteTransform(node);
  if (transform) return { left: transform[4], top: transform[5] };
  if (!parent || !hasUntransformedAxes(node) || !hasUntransformedAxes(parent)) return;
  const bounds = node.absoluteBoundingBox;
  const parentBounds = parent.absoluteBoundingBox;
  if (!isFiniteNumber(bounds?.x) || !isFiniteNumber(bounds.y)) return;
  if (!isFiniteNumber(parentBounds?.x) || !isFiniteNumber(parentBounds.y)) return;
  const left = bounds.x - parentBounds.x;
  const top = bounds.y - parentBounds.y;
  return isFiniteNumber(left) && isFiniteNumber(top) ? { left, top } : undefined;
}

export function isPositionedChild(node: FigmaRawNode, parent?: FigmaRawNode): boolean {
  if (node.layoutPositioning === "ABSOLUTE") return true;
  return Boolean(parent && !isAutoLayout(parent) && getParentLocalPosition(node, parent));
}

export function hasPositionedChildren(node: FigmaRawNode): boolean {
  return (node.children ?? []).some(
    (child) => child.visible !== false && isPositionedChild(child, node),
  );
}

function finiteDimension(value: unknown): number | undefined {
  return isFiniteNumber(value) && value >= 0 ? value : undefined;
}

export function getLocalSize(node: FigmaRawNode, parent?: FigmaRawNode) {
  const bounds =
    hasUntransformedAxes(node) && (!parent || hasUntransformedAxes(parent))
      ? node.absoluteBoundingBox
      : undefined;
  return {
    width: finiteDimension(node.size?.x) ?? finiteDimension(bounds?.width),
    height: finiteDimension(node.size?.y) ?? finiteDimension(bounds?.height),
  };
}
