import type { MCPResponse, V3Node, Style, Layout } from "../types";
import { normalizeShadowKey } from "./normalize";

export type FrequencyMap = Map<string, number>;

function increment(map: FrequencyMap, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function buildTypographyKey(style: Style): string | null {
  if (!style.font || !style.fontSize || !style.fontWeight) return null;
  return `${style.font}/${style.fontSize}/${style.fontWeight}/${style.lineHeight ?? ""}`;
}

export function countFrequencies(response: MCPResponse): {
  colors: FrequencyMap;
  spacings: FrequencyMap;
  radii: FrequencyMap;
  shadows: FrequencyMap;
  typographies: FrequencyMap;
  paddingCombos: FrequencyMap;
  heights: FrequencyMap;
} {
  const colors: FrequencyMap = new Map();
  const spacings: FrequencyMap = new Map();
  const radii: FrequencyMap = new Map();
  const shadows: FrequencyMap = new Map();
  const typographies: FrequencyMap = new Map();
  const paddingCombos: FrequencyMap = new Map();
  const heights: FrequencyMap = new Map();

  function countStyle(style: Style | undefined): void {
    if (!style) return;

    if (typeof style.background === "string") increment(colors, style.background);
    if (typeof style.border === "string") increment(colors, style.border);
    if (typeof style.color === "string") increment(colors, style.color);
    if (typeof style.shadow === "string") increment(shadows, normalizeShadowKey(style.shadow));
    if (typeof style.radius === "number") increment(radii, String(style.radius));

    const typoKey = buildTypographyKey(style);
    if (typoKey) increment(typographies, typoKey);
  }

  function countLayout(layout: Layout | undefined): void {
    if (!layout) return;

    if (typeof layout.gap === "number") increment(spacings, String(layout.gap));

    if (typeof layout.padding === "number") {
      increment(spacings, String(layout.padding));
    } else if (Array.isArray(layout.padding)) {
      const [v, h] = layout.padding;
      increment(paddingCombos, `${v},${h}`);
    } else if (layout.padding && typeof layout.padding === "object") {
      const p = layout.padding as { top: number; right: number; bottom: number; left: number };
      increment(spacings, String(p.top));
      increment(spacings, String(p.right));
      increment(spacings, String(p.bottom));
      increment(spacings, String(p.left));
    }

    if (typeof layout.minHeight === "string" && layout.minHeight.endsWith("px")) {
      const numStr = layout.minHeight.slice(0, -2);
      increment(heights, numStr);
    }
  }

  function countNode(node: V3Node): void {
    countStyle(node.style);
    countLayout(node.layout);
    for (const child of node.children ?? []) countNode(child);
  }

  countNode(response.root);

  for (const set of Object.values(response.componentSets ?? {})) {
    countStyle(set.base?.style);
    countLayout(set.base?.layout);
    for (const child of set.base?.children ?? []) countNode(child);

    for (const variant of Object.values(set.variants ?? {})) {
      countStyle(variant.style);
      countLayout(variant.layout);
      for (const child of variant.children ?? []) countNode(child);
    }
  }

  return { colors, spacings, radii, shadows, typographies, paddingCombos, heights };
}
