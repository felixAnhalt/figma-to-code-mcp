export function normalizeShadowKey(raw: string): string {
  return raw.replace(/rgba\(([^)]+)\)/g, (_match, inner) => {
    const parts = inner.split(",").map((s: string) => s.trim());
    const r = parseInt(parts[0], 10).toString(16).padStart(2, "0");
    const g = parseInt(parts[1], 10).toString(16).padStart(2, "0");
    const b = parseInt(parts[2], 10).toString(16).padStart(2, "0");
    const a = parseFloat(parts[3]);

    if (a === 1) {
      return `#${r}${g}${b}`.toUpperCase();
    }

    const aHex = Math.round(a * 255)
      .toString(16)
      .padStart(2, "0");
    return `#${r}${g}${b}${aHex}`.toUpperCase();
  });
}
