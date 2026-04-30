import type { Style } from "../../types";
import { buildTypographyKey } from "../registry";
import { normalizeShadowKey } from "../normalize";

export function replaceStyleTokens(
  style: Style | undefined,
  colorsByRaw: Map<string, string>,
  shadowsByRaw: Map<string, string>,
  radiiByRaw: Map<string, string>,
  typographiesByRaw: Map<string, string>,
): Style | undefined {
  if (!style) return undefined;
  const s = { ...style };

  if (typeof s.background === "string") {
    const t = style._varRefs?.background ?? colorsByRaw.get(s.background);
    if (t) s.background = `colors.${t}`;
  }
  if (typeof s.border === "string") {
    const t = style._varRefs?.border ?? colorsByRaw.get(s.border);
    if (t) s.border = `colors.${t}`;
  }
  if (typeof s.color === "string") {
    const t = style._varRefs?.color ?? colorsByRaw.get(s.color);
    if (t) s.color = `colors.${t}`;
  }
  if (typeof s.shadow === "string") {
    const normalized = normalizeShadowKey(s.shadow);
    const t = shadowsByRaw.get(normalized);
    if (t) s.shadow = `shadows.${t}`;
  }
  if (typeof s.radius === "number") {
    const t = style._varRefs?.radius ?? radiiByRaw.get(String(s.radius));
    if (t) s.radius = `radius.${t}` as never;
  }
  if (typeof s.borderWidth === "number" && style._varRefs?.borderWidth) {
    s.borderWidth = `spacing.${style._varRefs.borderWidth}` as never;
  }

  const typoKey = buildTypographyKey(style);
  if (typoKey) {
    const t = typographiesByRaw.get(typoKey);
    if (t) {
      s.typography = `typography.${t}`;
      delete s.font;
      delete s.fontSize;
      delete s.fontWeight;
      delete s.lineHeight;
    }
  }

  return Object.keys(s).length > 0 ? s : undefined;
}
