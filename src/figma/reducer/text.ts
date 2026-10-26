import type { Style } from "../types";
import type { FigmaRawNode } from "./types";
import { roundTo } from "./utils";

const TEXT_CASE_VALUES: Record<string, string> = {
  UPPER: "uppercase",
  LOWER: "lowercase",
  TITLE: "capitalize",
};
const NORMAL_LINE_HEIGHT_PERCENT = 100;
const TEXT_DECORATION_VALUES: Record<string, string> = {
  STRIKETHROUGH: "line-through",
};

export function extractTextStyleFromNode(node: FigmaRawNode): Partial<Style> | undefined {
  const style = { ...extractFontStyle(node), ...extractTextMetrics(node.style ?? {}) };
  return Object.keys(style).length > 0 ? style : undefined;
}

function extractFontStyle(node: FigmaRawNode): Partial<Style> {
  const source = node.style ?? {};
  const fontName = node.fontName as { family?: string; style?: string } | undefined;
  const font = source.fontFamily ?? fontName?.family;
  const fontSize = source.fontSize ?? node.fontSize;
  const fontWeight = source.fontWeight ?? node.fontWeight;
  const fontStyle = source.fontStyle ?? fontName?.style;
  const italic =
    typeof source.italic === "boolean"
      ? source.italic
      : typeof fontStyle === "string" && fontStyle.toLowerCase().includes("italic");
  return {
    ...(typeof font === "string" && font ? { font } : {}),
    ...(isFiniteNumber(fontSize) && fontSize > 0 ? { fontSize } : {}),
    ...(isFiniteNumber(fontWeight) && fontWeight > 0 ? { fontWeight } : {}),
    ...(italic ? { fontStyle: "italic" } : {}),
  };
}

function extractTextMetrics(source: Record<string, unknown>): Partial<Style> {
  const style: Partial<Style> = {};
  const lineHeight = extractLineHeight(source);
  if (lineHeight !== undefined) style.lineHeight = lineHeight;
  if (isFiniteNumber(source.letterSpacing) && source.letterSpacing !== 0)
    style.letterSpacing = roundTo(source.letterSpacing, 2);
  if (typeof source.textAlignHorizontal === "string")
    style.textAlign = source.textAlignHorizontal.toLowerCase();
  if (typeof source.textDecoration === "string" && source.textDecoration !== "NONE")
    style.textDecoration =
      TEXT_DECORATION_VALUES[source.textDecoration] ?? source.textDecoration.toLowerCase();
  if (typeof source.textCase === "string" && source.textCase !== "ORIGINAL")
    style.textTransform = TEXT_CASE_VALUES[source.textCase] ?? source.textCase.toLowerCase();
  return style;
}

function extractLineHeight(source: Record<string, unknown>): Style["lineHeight"] {
  if (source.lineHeightUnit === "FONT_SIZE_%" && isFiniteNumber(source.lineHeightPercentFontSize))
    return `${roundTo(source.lineHeightPercentFontSize, 0)}%`;
  if (isFiniteNumber(source.lineHeightPx)) return roundTo(source.lineHeightPx, 2);
  if (
    source.lineHeightUnit === "INTRINSIC_%" &&
    (source.lineHeightPercent === undefined ||
      source.lineHeightPercent === NORMAL_LINE_HEIGHT_PERCENT)
  )
    return "normal";
  const percentage = source.lineHeightPercentFontSize ?? source.lineHeightPercent;
  return isFiniteNumber(percentage) ? `${roundTo(percentage, 0)}%` : undefined;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
