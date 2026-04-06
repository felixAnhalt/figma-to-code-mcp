import type { TypographyToken } from "../types";
import {
  MIN_USES_FOR_TOKEN,
  SPACING_SEMANTIC_NAMES,
  RADIUS_SEMANTIC_NAMES,
  HEIGHT_SEMANTIC_NAMES,
} from "./constants";
import type { FrequencyMap } from "./frequencies";

export function buildTypographyKey(style: {
  font?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: string | number;
}): string | null {
  if (!style.font || !style.fontSize || !style.fontWeight) return null;
  return `${style.font}/${style.fontSize}/${style.fontWeight}/${style.lineHeight ?? ""}`;
}

export function buildSemanticTokenRegistry<T>(
  frequencyMap: FrequencyMap,
  semanticNames: Record<string, string>,
  valueParser: (raw: string) => T,
): { tokensByRaw: Map<string, string>; registry: Record<string, T> } {
  const tokensByRaw = new Map<string, string>();
  const registry: Record<string, T> = {};

  for (const [raw, count] of frequencyMap.entries()) {
    if (count < MIN_USES_FOR_TOKEN) continue;
    const name = semanticNames[raw];
    if (!name) continue;
    tokensByRaw.set(raw, name);
    registry[name] = valueParser(raw);
  }

  return { tokensByRaw, registry };
}

export function parseNumber(raw: string): number {
  return Number(raw);
}

export function parseString(raw: string): string {
  return raw;
}

export function parsePaddingCombo(raw: string): [number, number] {
  const [v, h] = raw.split(",").map(Number);
  return [v, h];
}

export function parseTypographyKey(raw: string): TypographyToken {
  const [font, size, weight, lineHeight] = raw.split("/");
  const token: TypographyToken = {
    font,
    size: Number(size),
    weight: Number(weight),
    lineHeight:
      lineHeight === "" ? "" : isNaN(Number(lineHeight)) ? lineHeight : Number(lineHeight),
  };
  if (token.lineHeight === "") delete (token as Partial<TypographyToken>).lineHeight;
  return token;
}

export function buildTypographySemanticNames(frequencyMap: FrequencyMap): Record<string, string> {
  const names: Record<string, string> = {};

  for (const [key, count] of frequencyMap.entries()) {
    if (count < MIN_USES_FOR_TOKEN) continue;
    const [, sizeStr, weightStr] = key.split("/");
    const size = Number(sizeStr);
    const weight = Number(weightStr);
    names[key] = resolveTypographyName(size, weight);
  }

  const seen = new Map<string, number>();
  for (const [key, name] of Object.entries(names)) {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    if (count > 1) names[key] = `${name}${count}`;
  }

  return names;
}

export function resolveTypographyName(size: number, weight: number): string {
  if (size >= 32) return "heading";
  if (size >= 24) return "headingSm";
  if (size >= 20) return "subheading";
  if (size >= 18) return "bodyLg";
  if (size >= 16) return weight >= 600 ? "labelLg" : "bodyMd";
  if (size >= 14) return weight >= 600 ? "labelMd" : "bodySm";
  if (size >= 12) return weight >= 600 ? "labelSm" : "caption";
  return "captionXs";
}

export function buildSpacingSemanticMap(frequencyMap: FrequencyMap): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [raw] of frequencyMap.entries()) {
    const n = Number(raw);
    const name = SPACING_SEMANTIC_NAMES[n];
    if (name) map[raw] = name;
  }
  return map;
}

export function buildRadiusSemanticMap(frequencyMap: FrequencyMap): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [raw] of frequencyMap.entries()) {
    const n = Number(raw);
    const name = RADIUS_SEMANTIC_NAMES[n];
    if (name) map[raw] = name;
  }
  return map;
}

export function buildHeightSemanticMap(frequencyMap: FrequencyMap): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [raw] of frequencyMap.entries()) {
    const n = Number(raw);
    const name = HEIGHT_SEMANTIC_NAMES[n];
    if (name) map[raw] = name;
  }
  return map;
}
