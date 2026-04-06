import type { Style } from "../types";
import type { FigmaRawNode } from "./types";
import { roundTo } from "./utils";

export function extractTextStyleFromNode(node: FigmaRawNode): Partial<Style> | undefined {
  const style: Partial<Style> = {};

  const s = (node.style ?? {}) as Record<string, unknown>;
  const fontName = node.fontName as { family?: string; style?: string } | undefined;

  if (s.fontFamily || fontName?.family) {
    style.font = (s.fontFamily ?? fontName?.family) as string;
  }
  if (s.fontSize || node.fontSize) {
    style.fontSize = (s.fontSize ?? node.fontSize) as number;
  }
  if (s.fontWeight || node.fontWeight) {
    style.fontWeight = (s.fontWeight ?? node.fontWeight) as number;
  }
  const fontStyleStr = (s.fontStyle ?? fontName?.style) as string | undefined;
  if (fontStyleStr?.toLowerCase().includes("italic")) {
    style.fontStyle = "italic";
  }
  if (s.lineHeightPx) {
    style.lineHeight = roundTo(s.lineHeightPx as number, 2);
  } else if (s.lineHeightPercent) {
    style.lineHeight = `${roundTo(s.lineHeightPercent as number, 0)}%`;
  }
  if (s.letterSpacing) {
    style.letterSpacing = roundTo(s.letterSpacing as number, 2);
  }
  if (s.textAlignHorizontal) {
    style.textAlign = (s.textAlignHorizontal as string).toLowerCase();
  }
  if (s.textDecoration && s.textDecoration !== "NONE") {
    style.textDecoration = (s.textDecoration as string).toLowerCase().replace("_", "-");
  }
  if (s.textCase && s.textCase !== "ORIGINAL") {
    const caseMap: Record<string, string> = {
      UPPER: "uppercase",
      LOWER: "lowercase",
      TITLE: "capitalize",
    };
    style.textTransform = caseMap[s.textCase as string] ?? (s.textCase as string).toLowerCase();
  }

  return Object.keys(style).length > 0 ? style : undefined;
}
