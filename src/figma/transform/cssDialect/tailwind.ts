import type { MCPResponse, V3Node, Layout, Style, ComponentSet } from "../../types";

const TAILWIND_SCALE = 4;
const RADIUS_SCALE = 2;

function tokenToTailwind(token: string, property: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [category, name] = parts;
  if (!name) return null;

  const propertyPrefixMap: Record<string, Record<string, string>> = {
    background: { colors: "bg", paints: "bg" },
    color: { colors: "text" },
    border: { colors: "border" },
    shadow: { shadows: "shadow" },
    radius: { radius: "rounded" },
    gap: { spacing: "gap" },
    padding: { spacing: "p", paddingCombos: "p" },
    width: { spacing: "w", heights: "w" },
    height: { spacing: "h", heights: "h" },
    minWidth: { heights: "min-w" },
    maxWidth: { heights: "max-w" },
    minHeight: { heights: "min-h" },
    maxHeight: { heights: "max-h" },
    typography: { typography: "text" },
    fontSize: { spacing: "text" },
    lineHeight: { spacing: "leading" },
  };

  const prefix = propertyPrefixMap[property]?.[category];
  return prefix ? `${prefix}-${name}` : null;
}

function numberToTailwind(value: number, property: string): string | null {
  const scaleMap: Record<string, number> = {
    gap: TAILWIND_SCALE,
    padding: TAILWIND_SCALE,
    fontSize: TAILWIND_SCALE,
    lineHeight: TAILWIND_SCALE,
    radius: RADIUS_SCALE,
    borderWidth: 1,
  };

  const scale = scaleMap[property];
  if (scale === undefined) return null;

  const standard = Math.round(value / scale);
  if (standard * scale === value) {
    const prefixMap: Record<string, string> = {
      gap: "gap",
      padding: "p",
      fontSize: "text",
      lineHeight: "leading",
      radius: "rounded",
      borderWidth: "border",
    };
    return `${prefixMap[property]}-${standard}`;
  }

  const arbitraryMap: Record<string, string> = {
    gap: "gap",
    padding: "p",
    fontSize: "text",
    lineHeight: "leading",
    radius: "rounded",
    borderWidth: "border",
  };
  return `${arbitraryMap[property]}-[${value}px]`;
}

function transformLayout(layout: Layout | undefined): Layout | undefined {
  if (!layout) return undefined;

  const l = { ...layout };

  if (typeof l.gap === "string" && l.gap.includes(".")) {
    const converted = tokenToTailwind(l.gap, "gap");
    if (converted) l.gap = converted as never;
  } else if (typeof l.gap === "number") {
    const converted = numberToTailwind(l.gap, "gap");
    if (converted) l.gap = converted as never;
  }

  if (l.padding !== undefined) {
    if (typeof l.padding === "string" && l.padding.includes(".")) {
      const converted = tokenToTailwind(l.padding, "padding");
      if (converted) l.padding = converted as never;
    } else if (typeof l.padding === "number") {
      const converted = numberToTailwind(l.padding, "padding");
      if (converted) l.padding = converted as never;
    }
  }

  if (typeof l.width === "string" && l.width.includes(".")) {
    const converted = tokenToTailwind(l.width, "width");
    if (converted) l.width = converted;
  }

  if (typeof l.height === "string" && l.height.includes(".")) {
    const converted = tokenToTailwind(l.height, "height");
    if (converted) l.height = converted;
  }

  if (typeof l.minWidth === "string" && l.minWidth.includes(".")) {
    const converted = tokenToTailwind(l.minWidth, "minWidth");
    if (converted) l.minWidth = converted;
  }

  if (typeof l.maxWidth === "string" && l.maxWidth.includes(".")) {
    const converted = tokenToTailwind(l.maxWidth, "maxWidth");
    if (converted) l.maxWidth = converted;
  }

  if (typeof l.minHeight === "string" && l.minHeight.includes(".")) {
    const converted = tokenToTailwind(l.minHeight, "minHeight");
    if (converted) l.minHeight = converted;
  }

  if (typeof l.maxHeight === "string" && l.maxHeight.includes(".")) {
    const converted = tokenToTailwind(l.maxHeight, "maxHeight");
    if (converted) l.maxHeight = converted;
  }

  return Object.keys(l).length > 0 ? l : undefined;
}

function transformStyle(style: Style | undefined, nodeType: string): Style | undefined {
  if (!style) return undefined;

  const s = { ...style };

  if (nodeType !== "TEXT" && typeof s.background === "string") {
    if (s.background.includes(".")) {
      const converted = tokenToTailwind(s.background, "background");
      if (converted) s.background = converted;
    }
  }

  if (typeof s.border === "string" && s.border.includes(".")) {
    const converted = tokenToTailwind(s.border, "border");
    if (converted) s.border = converted;
  }

  if (typeof s.color === "string" && s.color.includes(".")) {
    const converted = tokenToTailwind(s.color, "color");
    if (converted) s.color = converted;
  }

  if (typeof s.shadow === "string" && s.shadow.includes(".")) {
    const converted = tokenToTailwind(s.shadow, "shadow");
    if (converted) s.shadow = converted;
  }

  if (typeof s.radius === "number") {
    const converted = numberToTailwind(s.radius, "radius");
    if (converted) s.radius = converted as never;
  } else if (typeof s.radius === "string" && s.radius.includes(".")) {
    const converted = tokenToTailwind(s.radius, "radius");
    if (converted) s.radius = converted as never;
  }

  if (typeof s.typography === "string" && s.typography.includes(".")) {
    const converted = tokenToTailwind(s.typography, "typography");
    if (converted) s.typography = converted;
  }

  if (typeof s.fontSize === "number") {
    const converted = numberToTailwind(s.fontSize, "fontSize");
    if (converted) s.fontSize = converted as never;
  }

  if (typeof s.lineHeight === "number") {
    const converted = numberToTailwind(s.lineHeight, "lineHeight");
    if (converted) s.lineHeight = converted as never;
  }

  return Object.keys(s).length > 0 ? s : undefined;
}

function transformNode(node: V3Node): V3Node {
  return {
    ...node,
    layout: transformLayout(node.layout),
    style: transformStyle(node.style, node.type),
    children: node.children?.map((child) => transformNode(child)),
  };
}

function transformComponentSet(componentSet: ComponentSet): ComponentSet {
  const base = componentSet.base
    ? {
        ...componentSet.base,
        layout: transformLayout(componentSet.base.layout),
        style: transformStyle(componentSet.base.style, "FRAME"),
        children: componentSet.base.children?.map((child) => transformNode(child)),
      }
    : undefined;

  const variants: Record<string, ComponentSet["variants"][string]> = {};
  for (const [id, variant] of Object.entries(componentSet.variants)) {
    variants[id] = {
      ...variant,
      layout: transformLayout(variant.layout),
      style: transformStyle(variant.style, "FRAME"),
      children: variant.children?.map((child) => transformNode(child)),
    };
  }

  return {
    ...componentSet,
    ...(base ? { base } : {}),
    variants,
  };
}

export function transformToTailwind(response: MCPResponse): MCPResponse {
  const transformedRoot = transformNode(response.root);
  const transformedComponentSets = response.componentSets
    ? Object.fromEntries(
        Object.entries(response.componentSets).map(([name, cs]) => [
          name,
          transformComponentSet(cs),
        ]),
      )
    : undefined;

  return {
    ...response,
    root: transformedRoot,
    ...(transformedComponentSets ? { componentSets: transformedComponentSets } : {}),
  };
}
