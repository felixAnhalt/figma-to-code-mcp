import type { FigmaRawNode, FigmaRawPaint, FigmaEffect } from "./types";

export function isTransparentWrapper(node: FigmaRawNode): boolean {
  if (node.type === "INSTANCE" || node.type === "COMPONENT") return false;
  if (node.type !== "FRAME" && node.type !== "GROUP") return false;
  if (!node.children || node.children.length !== 1) return false;

  if (node.layoutMode) return false;

  const fills = node.fills as FigmaRawPaint[] | undefined;
  if (fills && fills.length > 0 && fills.some((f) => f.type && f.type !== "NONE")) return false;

  const strokes = node.strokes as FigmaRawPaint[] | undefined;
  if (strokes && strokes.length > 0 && strokes.some((f) => f.type && f.type !== "NONE"))
    return false;

  const effects = node.effects as FigmaEffect[] | undefined;
  if (effects && effects.length > 0) return false;

  if (node.cornerRadius !== undefined && node.cornerRadius !== 0) return false;
  const radii = node.rectangleCornerRadii as number[] | undefined;
  if (radii && radii.some((r) => r !== 0)) return false;

  if (node.clipsContent === true) return false;

  if (
    node.minWidth !== undefined ||
    node.maxWidth !== undefined ||
    node.minHeight !== undefined ||
    node.maxHeight !== undefined
  )
    return false;

  const size = node.size as { x?: number; y?: number } | undefined;
  if (
    size?.x !== undefined &&
    (node.layoutSizingHorizontal === "FIXED" || node.layoutSizingVertical === "FIXED")
  )
    return false;

  return true;
}

export function resolveChildren(children: FigmaRawNode[]): FigmaRawNode[] {
  const result: FigmaRawNode[] = [];

  for (const child of children) {
    if (!child || child.visible === false) continue;

    let current: FigmaRawNode | null | undefined = child;
    while (current && isTransparentWrapper(current)) {
      const next: FigmaRawNode | undefined = current.children?.[0];
      if (!next) {
        break;
      }
      current = next;
    }

    if (current) {
      result.push(current);
    }
  }

  return result;
}

export function parseVariantProps(variantName: string): Record<string, string> {
  const PAIR_SEPARATOR = ",";
  const KEY_VALUE_SEPARATOR = "=";

  const pairs = variantName.split(PAIR_SEPARATOR);
  const props: Record<string, string> = {};

  for (const pair of pairs) {
    const separatorIndex = pair.indexOf(KEY_VALUE_SEPARATOR);
    if (separatorIndex === -1) continue;

    const key = pair.slice(0, separatorIndex).trim().toLowerCase().replace(/\s+/g, "-");
    const value = pair
      .slice(separatorIndex + 1)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-");
    if (key && value) {
      props[key] = value;
    }
  }

  return props;
}
