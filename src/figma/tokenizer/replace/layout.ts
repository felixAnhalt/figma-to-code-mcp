import type { Layout } from "../../types";

export function replaceLayoutTokens(
  layout: Layout | undefined,
  spacingsByRaw: Map<string, string>,
  paddingCombosByRaw: Map<string, string>,
  heightsByRaw: Map<string, string>,
): Layout | undefined {
  if (!layout) return undefined;
  const l = { ...layout };

  if (typeof l.gap === "number") {
    const t = spacingsByRaw.get(String(l.gap));
    if (t) l.gap = `spacing.${t}` as never;
  }

  if (typeof l.padding === "number") {
    const t = spacingsByRaw.get(String(l.padding));
    if (t) l.padding = `spacing.${t}` as never;
  } else if (Array.isArray(l.padding)) {
    const [v, h] = l.padding;
    const comboKey = `${v},${h}`;
    const comboToken = paddingCombosByRaw.get(comboKey);
    if (comboToken) {
      l.padding = `paddingCombos.${comboToken}` as never;
    }
  } else if (l.padding && typeof l.padding === "object") {
    const p = l.padding as { top: number; right: number; bottom: number; left: number };
    const tt = spacingsByRaw.get(String(p.top));
    const tr = spacingsByRaw.get(String(p.right));
    const tb = spacingsByRaw.get(String(p.bottom));
    const tl = spacingsByRaw.get(String(p.left));
    if (tt && tt === tr && tt === tb && tt === tl) {
      l.padding = `spacing.${tt}` as never;
    }
  }

  if (typeof l.minHeight === "string" && l.minHeight.endsWith("px")) {
    const numStr = l.minHeight.slice(0, -2);
    const t = heightsByRaw.get(numStr);
    if (t) l.minHeight = `heights.${t}` as never;
  }

  if (l.width && l.height && l.width === l.height) {
    l.size = l.width;
    delete l.width;
    delete l.height;
  }

  return Object.keys(l).length > 0 ? l : undefined;
}
