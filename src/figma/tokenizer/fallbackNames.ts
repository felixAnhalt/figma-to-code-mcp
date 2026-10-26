import { createHash } from "node:crypto";

const SHADOW_HASH_LENGTH = 8;

/**
 * Names for values that have no semantic name. Each name is derived from the raw value,
 * so every raw value gets its own unique token.
 */
export function colorFallbackName(raw: string): string {
  return `c${sanitizeValue(raw)}`;
}

export function spacingFallbackName(raw: string): string {
  return `n${numberSuffix(raw)}`;
}

export function radiusFallbackName(raw: string): string {
  return `r${numberSuffix(raw)}`;
}

export function heightFallbackName(raw: string): string {
  return `h${numberSuffix(raw)}`;
}

export function paddingComboFallbackName(raw: string): string {
  return `p${sanitizeValue(raw)}`;
}

export function shadowFallbackName(raw: string): string {
  const digest = createHash("sha256").update(raw).digest("hex");
  return `s${digest.slice(0, SHADOW_HASH_LENGTH)}`;
}

function numberSuffix(raw: string): string {
  return raw.replace("-", "m").replace(".", "_");
}

/** Keeps every separator as an underscore, so different values cannot collapse to one name. */
function sanitizeValue(raw: string): string {
  return raw
    .replace(/^#/, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}
