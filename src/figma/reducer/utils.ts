export function roundTo(num: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(num * factor) / factor;
}

export function formatColor(color: unknown): string | undefined {
  if (!color || typeof color !== "object") return undefined;
  if (!("r" in color)) return undefined;

  const c = color as { r: number; g: number; b: number; a: number };
  const r = Math.round(c.r * 255);
  const g = Math.round(c.g * 255);
  const b = Math.round(c.b * 255);
  return `rgba(${r}, ${g}, ${b}, ${c.a})`;
}

export function colorToHex(color: unknown): string | undefined {
  if (!color || typeof color !== "object") return undefined;
  if (!("r" in color)) return undefined;

  const c = color as { r: number; g: number; b: number };
  const r = Math.round(c.r * 255)
    .toString(16)
    .padStart(2, "0");
  const g = Math.round(c.g * 255)
    .toString(16)
    .padStart(2, "0");
  const b = Math.round(c.b * 255)
    .toString(16)
    .padStart(2, "0");
  return `#${r}${g}${b}`;
}

export function parseRelativeTransform(
  transform: number[][] | undefined,
): [number, number, number, number, number, number] | undefined {
  if (!transform || transform.length !== 2) return undefined;
  if (!transform[0] || transform[0].length !== 3) return undefined;
  if (!transform[1] || transform[1].length !== 3) return undefined;

  return [
    transform[0][0],
    transform[1][0],
    transform[0][1],
    transform[1][1],
    transform[0][2],
    transform[1][2],
  ];
}

export function mapAlignItems(value: string | undefined): string {
  switch (value) {
    case "MIN":
      return "flex-start";
    case "MAX":
      return "flex-end";
    case "CENTER":
      return "center";
    case "BASELINE":
      return "baseline";
    case "STRETCH":
      return "stretch";
    default:
      return "stretch";
  }
}

export function mapJustifyContent(value: string | undefined): string {
  switch (value) {
    case "MIN":
      return "flex-start";
    case "MAX":
      return "flex-end";
    case "CENTER":
      return "center";
    case "SPACE_BETWEEN":
      return "space-between";
    default:
      return "flex-start";
  }
}

export function mapInteractionTrigger(type: string | undefined): string {
  switch (type) {
    case "ON_HOVER":
      return "hover";
    case "ON_CLICK":
      return "click";
    case "ON_DRAG":
      return "drag";
    case "ON_KEY_DOWN":
      return "key";
    default:
      return type ?? "unknown";
  }
}

export function mapInteractionAction(
  type: string | undefined,
  navigation: string | undefined,
): string {
  if (type === "NODE") {
    switch (navigation) {
      case "NAVIGATE":
        return "navigate";
      case "CHANGE_TO":
        return "swap";
      case "OVERLAY":
        return "overlay";
      case "SCROLL_TO":
        return "scroll";
      default:
        return navigation ?? "navigate";
    }
  }
  return type?.toLowerCase() ?? "unknown";
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

export function extractFillColor(fills: unknown): string | undefined {
  const f = fills as
    | Array<{ type?: string; color?: { r: number; g: number; b: number } }>
    | undefined;
  if (!f || f.length === 0) return undefined;
  if (f[0].type !== "SOLID") return undefined;
  return colorToHex(f[0].color);
}
