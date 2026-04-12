import type { MCPResponse, V3Node, Layout, Style, ComponentSet } from "../../types";

const TAILWIND_SCALE = 4;
const RADIUS_SCALE = 2;
const BORDER_SCALE = 1;

const ALIGN_MAP: Record<string, string> = {
  MIN: "items-start",
  CENTER: "items-center",
  MAX: "items-end",
  BASELINE: "items-baseline",
  STRETCH: "items-stretch",
};

const JUSTIFY_MAP: Record<string, string> = {
  MIN: "justify-start",
  CENTER: "justify-center",
  MAX: "justify-end",
  SPACE_BETWEEN: "justify-between",
  SPACE_AROUND: "justify-around",
  SPACE_EVENLY: "justify-evenly",
};

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
    borderWidth: BORDER_SCALE,
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

function rgbaToTailwind(color: string): string {
  const normalized = color.replace(/\s+/g, "").toLowerCase();

  if (normalized === "rgba(255,255,255,0)" || normalized === "rgba(255,255,255,0)") {
    return "bg-transparent";
  }
  if (normalized === "rgba(0,0,0,0)" || normalized === "rgba(0,0,0,0)") {
    return "bg-transparent";
  }
  if (normalized === "rgba(255,255,255,1)") {
    return "bg-white";
  }
  if (normalized === "rgba(0,0,0,1)") {
    return "bg-black";
  }

  return `bg-[${color.replace(/,\s*/g, ",")}]`;
}

function transformLayout(layout: Layout | undefined): Layout | undefined {
  if (!layout) return undefined;

  const l = { ...layout };

  if (l.align) {
    const alignClass = ALIGN_MAP[l.align] || ALIGN_MAP[l.align.toUpperCase()];
    if (alignClass) l.align = alignClass;
  }

  if (l.justify) {
    const justifyClass = JUSTIFY_MAP[l.justify] || JUSTIFY_MAP[l.justify.toUpperCase()];
    if (justifyClass) l.justify = justifyClass;
  }

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
    } else if (Array.isArray(l.padding)) {
      const [v, h] = l.padding;
      const pv = typeof v === "number" ? numberToTailwind(v, "padding") : null;
      const ph = typeof h === "number" ? numberToTailwind(h, "padding") : null;
      if (pv && ph) {
        const vClass = pv.split("-").slice(1).join("-");
        const hClass = ph.split("-").slice(1).join("-");
        l.padding = `py-${vClass} px-${hClass}` as never;
      }
    } else if (l.padding && typeof l.padding === "object") {
      const p = l.padding as { top: number; right: number; bottom: number; left: number };
      const pt = typeof p.top === "number" ? numberToTailwind(p.top, "padding") : null;
      const pr = typeof p.right === "number" ? numberToTailwind(p.right, "padding") : null;
      const pb = typeof p.bottom === "number" ? numberToTailwind(p.bottom, "padding") : null;
      const pl = typeof p.left === "number" ? numberToTailwind(p.left, "padding") : null;

      if (pt && pr && pb && pl) {
        const ptClass = pt.split("-").slice(1).join("-");
        const prClass = pr.split("-").slice(1).join("-");
        const pbClass = pb.split("-").slice(1).join("-");
        const plClass = pl.split("-").slice(1).join("-");
        l.padding = `py-${ptClass} px-${prClass} pb-${pbClass} pl-${plClass}` as never;
      } else {
        const parts: string[] = [];
        if (pt) parts.push(`py-${pt.split("-").slice(1).join("-")}`);
        else if (typeof p.top === "number") parts.push(`py-[${p.top}px]`);
        if (pr) parts.push(`pr-[${pr.split("-").slice(1).join("-")}px]`);
        else if (typeof p.right === "number") parts.push(`pr-[${p.right}px]`);
        if (pb) parts.push(`pb-${pb.split("-").slice(1).join("-")}`);
        else if (typeof p.bottom === "number") parts.push(`pb-[${p.bottom}px]`);
        if (pl) parts.push(`pl-[${pl.split("-").slice(1).join("-")}px]`);
        else if (typeof p.left === "number") parts.push(`pl-[${p.left}px]`);
        if (parts.length > 0) {
          l.padding = parts.join(" ") as never;
        }
      }
    }
  }

  if (typeof l.width === "string") {
    if (l.width.includes(".")) {
      const converted = tokenToTailwind(l.width, "width");
      if (converted) l.width = converted;
    } else if (l.width.endsWith("px")) {
      const pxValue = parseFloat(l.width);
      if (!isNaN(pxValue)) {
        l.width = `w-[${pxValue}px]`;
      }
    } else if (l.width === "100%") {
      l.width = "w-full";
    } else if (l.width === "fit-content") {
      l.width = "w-fit";
    }
  }

  if (typeof l.height === "string") {
    if (l.height.includes(".")) {
      const converted = tokenToTailwind(l.height, "height");
      if (converted) l.height = converted;
    } else if (l.height.endsWith("px")) {
      const pxValue = parseFloat(l.height);
      if (!isNaN(pxValue)) {
        l.height = `h-[${pxValue}px]`;
      }
    } else if (l.height === "100%") {
      l.height = "h-full";
    } else if (l.height === "fit-content") {
      l.height = "h-fit";
    }
  }

  if (typeof l.minWidth === "string") {
    if (l.minWidth.includes(".")) {
      const converted = tokenToTailwind(l.minWidth, "minWidth");
      if (converted) l.minWidth = converted;
    } else if (l.minWidth.endsWith("px")) {
      const pxValue = parseFloat(l.minWidth);
      if (!isNaN(pxValue)) {
        l.minWidth = `min-w-[${pxValue}px]`;
      }
    }
  }

  if (typeof l.maxWidth === "string") {
    if (l.maxWidth.includes(".")) {
      const converted = tokenToTailwind(l.maxWidth, "maxWidth");
      if (converted) l.maxWidth = converted;
    } else if (l.maxWidth.endsWith("px")) {
      const pxValue = parseFloat(l.maxWidth);
      if (!isNaN(pxValue)) {
        l.maxWidth = `max-w-[${pxValue}px]`;
      }
    }
  }

  if (typeof l.minHeight === "string") {
    if (l.minHeight.includes(".")) {
      const converted = tokenToTailwind(l.minHeight, "minHeight");
      if (converted) l.minHeight = converted;
    } else if (l.minHeight.endsWith("px")) {
      const pxValue = parseFloat(l.minHeight);
      if (!isNaN(pxValue)) {
        l.minHeight = `min-h-[${pxValue}px]`;
      }
    }
  }

  if (typeof l.maxHeight === "string") {
    if (l.maxHeight.includes(".")) {
      const converted = tokenToTailwind(l.maxHeight, "maxHeight");
      if (converted) l.maxHeight = converted;
    } else if (l.maxHeight.endsWith("px")) {
      const pxValue = parseFloat(l.maxHeight);
      if (!isNaN(pxValue)) {
        l.maxHeight = `max-h-[${pxValue}px]`;
      }
    }
  }

  if (typeof l.size === "string") {
    if (l.size.includes(".") && l.size.split(".").length === 2) {
      const converted = tokenToTailwind(l.size, "size");
      if (converted) l.size = converted;
    } else if (l.size.endsWith("px")) {
      const pxValue = parseFloat(l.size);
      if (!isNaN(pxValue)) {
        l.size = `size-[${pxValue}px]`;
      }
    } else if (l.size === "100%") {
      l.size = "size-full";
    } else if (l.size === "fit-content") {
      l.size = "size-fit";
    }
  }

  return Object.keys(l).length > 0 ? l : undefined;
}

function transformStyle(style: Style | undefined, nodeType: string): Style | undefined {
  if (!style) return undefined;

  const s = { ...style };

  if (nodeType !== "TEXT" && s.background !== undefined) {
    if (typeof s.background === "string") {
      if (s.background.includes(".")) {
        const converted = tokenToTailwind(s.background, "background");
        if (converted) s.background = converted;
      } else if (s.background.startsWith("rgba")) {
        s.background = rgbaToTailwind(s.background);
      }
    }
  }

  if (s.border !== undefined) {
    if (typeof s.border === "string") {
      if (s.border.includes(".")) {
        const converted = tokenToTailwind(s.border, "border");
        if (converted) s.border = converted;
      } else if (s.border.startsWith("rgba")) {
        s.border = `border-[${s.border.replace(/,\s*/g, ",")}]`;
      }
    }
  }

  if (s.borderWidth !== undefined && typeof s.borderWidth === "number") {
    const converted = numberToTailwind(s.borderWidth, "borderWidth");
    if (converted) {
      s.borderWidth = converted as never;
    }
  }

  if (s.color !== undefined) {
    if (typeof s.color === "string") {
      if (s.color.includes(".")) {
        const converted = tokenToTailwind(s.color, "color");
        if (converted) s.color = converted;
      } else if (s.color.startsWith("rgba")) {
        s.color = `text-[${s.color.replace(/,\s*/g, ",")}]`;
      }
    }
  }

  if (s.shadow !== undefined) {
    if (typeof s.shadow === "string") {
      if (s.shadow.includes(".")) {
        const converted = tokenToTailwind(s.shadow, "shadow");
        if (converted) s.shadow = converted;
      } else {
        s.shadow = `shadow-[${s.shadow.replace(/\s+/g, " ")}]`;
      }
    }
  }

  if (s.radius !== undefined) {
    if (typeof s.radius === "number") {
      const converted = numberToTailwind(s.radius, "radius");
      if (converted) s.radius = converted as never;
    } else if (typeof s.radius === "string" && s.radius.includes(".")) {
      const converted = tokenToTailwind(s.radius, "radius");
      if (converted) s.radius = converted as never;
    } else if (Array.isArray(s.radius)) {
      const [tl, tr, br, bl] = s.radius;
      const rtl = typeof tl === "number" ? numberToTailwind(tl, "radius") : null;
      const rtr = typeof tr === "number" ? numberToTailwind(tr, "radius") : null;
      const rbr = typeof br === "number" ? numberToTailwind(br, "radius") : null;
      const rbl = typeof bl === "number" ? numberToTailwind(bl, "radius") : null;

      const parts: string[] = [];
      if (rtl) parts.push(`rounded-tl-${rtl.split("-").slice(1).join("-")}`);
      else if (typeof tl === "number") parts.push(`rounded-tl-[${tl}px]`);
      if (rtr) parts.push(`rounded-tr-${rtr.split("-").slice(1).join("-")}`);
      else if (typeof tr === "number") parts.push(`rounded-tr-[${tr}px]`);
      if (rbr) parts.push(`rounded-br-${rbr.split("-").slice(1).join("-")}`);
      else if (typeof br === "number") parts.push(`rounded-br-[${br}px]`);
      if (rbl) parts.push(`rounded-bl-${rbl.split("-").slice(1).join("-")}`);
      else if (typeof bl === "number") parts.push(`rounded-bl-[${bl}px]`);

      if (parts.length > 0) {
        s.radius = parts.join(" ") as never;
      }
    }
  }

  if (s.typography !== undefined && typeof s.typography === "string") {
    if (s.typography.includes(".")) {
      const converted = tokenToTailwind(s.typography, "typography");
      if (converted) s.typography = converted;
    }
  }

  if (s.fontSize !== undefined && typeof s.fontSize === "number") {
    const converted = numberToTailwind(s.fontSize, "fontSize");
    if (converted) s.fontSize = converted as never;
  }

  if (s.lineHeight !== undefined && typeof s.lineHeight === "number") {
    const converted = numberToTailwind(s.lineHeight, "lineHeight");
    if (converted) s.lineHeight = converted as never;
  }

  if (s.opacity !== undefined && typeof s.opacity === "number") {
    const opacityPercent = Math.round(s.opacity * 100);
    if (opacityPercent < 100) {
      s.opacity = `opacity-${opacityPercent}` as never;
    } else {
      delete s.opacity;
    }
  }

  if (s.blur !== undefined && typeof s.blur === "string") {
    const blurMatch = s.blur.match(/blur\((\d+)px\)/);
    if (blurMatch) {
      s.blur = `blur-${blurMatch[1]}` as never;
    }
  }

  if (s.transform !== undefined && typeof s.transform === "string") {
    const rotateMatch = s.transform.match(/rotate\((-?\d+)deg\)/);
    if (rotateMatch) {
      const deg = parseInt(rotateMatch[1]);
      if (deg !== 0) {
        if (deg % 45 === 0) {
          s.transform = `rotate-${deg}` as never;
        } else {
          s.transform = `rotate-[${deg}deg]` as never;
        }
      } else {
        delete s.transform;
      }
    }
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
