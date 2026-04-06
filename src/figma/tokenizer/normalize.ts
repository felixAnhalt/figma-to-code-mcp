export function normalizeShadowKey(raw: string): string {
  return raw.replace(/rgba\(([^)]+)\)/g, (_match, inner) => {
    const parts = inner.split(",").map((s: string) => s.trim());
    const normalized = parts.map((p: string, i: number) => {
      if (i < 3) return p;
      const n = parseFloat(p);
      const rounded = Math.round(n * 100) / 100;
      return String(rounded);
    });
    return `rgba(${normalized.join(",")})`;
  });
}
