import type { TextRun, TextStyleDelta } from "~/figma/types";
import type { VariableResolutionContext } from "~/figma/variableResolver";
import { processPaint } from "./paint";
import { extractTextStyleFromNode } from "./text";
import type { FigmaRawNode, FigmaRawPaint } from "./types";

const INHERITED_TEXT_DEFAULTS = {
  fontStyle: "normal",
  textDecoration: "none",
  textTransform: "none",
  letterSpacing: 0,
};
const TEXT_RUN_STYLE_FIELDS = [
  "color",
  "font",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "textDecoration",
  "textTransform",
] as const;
const BASE_OVERRIDE_ID = 0;
const LINE_HEIGHT_FIELDS = [
  "lineHeightPx",
  "lineHeightPercent",
  "lineHeightPercentFontSize",
  "lineHeightUnit",
];

export function extractTextRuns(
  node: FigmaRawNode,
  context?: VariableResolutionContext | null,
): TextRun[] | undefined {
  if (!node.characters || !node.characterStyleOverrides?.length) return undefined;
  const base = normalizeTextStyle(node, context);
  const styles = buildOverrideStyles(node, base, context);
  const runs: TextRun[] = [];
  let offset = 0;
  for (const character of node.characters) {
    appendTextRun(
      runs,
      character,
      styles.get(node.characterStyleOverrides[offset] ?? BASE_OVERRIDE_ID),
    );
    offset += character.length;
  }
  return runs.some((run) => run.style) ? runs : undefined;
}

function buildOverrideStyles(
  node: FigmaRawNode,
  base: TextStyleDelta,
  context?: VariableResolutionContext | null,
) {
  const styles = new Map<number, TextStyleDelta | undefined>();
  for (const id of new Set(node.characterStyleOverrides)) {
    const override = node.styleOverrideTable?.[String(id)];
    if (id === BASE_OVERRIDE_ID || !override) continue;
    const effective = normalizeTextStyle(
      mergeTextOverride(node, override),
      context,
      Object.hasOwn(override, "fills"),
    );
    styles.set(id, diffTextStyles(base, effective));
  }
  return styles;
}

function mergeTextOverride(node: FigmaRawNode, override: Record<string, unknown>): FigmaRawNode {
  const baseStyle = { ...node.style };
  if (LINE_HEIGHT_FIELDS.some((key) => Object.hasOwn(override, key))) {
    for (const key of LINE_HEIGHT_FIELDS) delete baseStyle[key];
  }
  const style = { ...baseStyle, ...override };
  if (Object.hasOwn(override, "fontStyle") && !Object.hasOwn(override, "italic"))
    delete style.italic;
  return { ...node, style, fills: Object.hasOwn(override, "fills") ? override.fills : node.fills };
}

function normalizeTextStyle(
  node: FigmaRawNode,
  context?: VariableResolutionContext | null,
  transparentIfEmpty: boolean = false,
): TextStyleDelta {
  return {
    ...INHERITED_TEXT_DEFAULTS,
    ...extractTextStyleFromNode(node),
    ...extractTextColor(node.fills, context, transparentIfEmpty),
  };
}

function extractTextColor(
  fills: unknown,
  context: VariableResolutionContext | null | undefined,
  transparentIfEmpty: boolean,
): TextStyleDelta {
  const paint = Array.isArray(fills)
    ? (fills as FigmaRawPaint[]).find((candidate) => candidate.visible !== false)
    : undefined;
  if (!paint) return transparentIfEmpty ? { color: "transparent" } : {};
  let name: string | undefined;
  const color = processPaint(paint, context, (reference) => {
    name = reference;
  });
  if (typeof color !== "string") return {};
  return { color, ...(name ? { _varRefs: { color: name } } : {}) };
}

function diffTextStyles(
  base: TextStyleDelta,
  effective: TextStyleDelta,
): TextStyleDelta | undefined {
  const changed = TEXT_RUN_STYLE_FIELDS.flatMap((key) => {
    const value = effective[key];
    return value !== undefined && value !== base[key] ? [[key, value]] : [];
  });
  const delta: TextStyleDelta = Object.fromEntries(changed);
  const colorReference = effective._varRefs?.color;
  if (colorReference !== base._varRefs?.color && effective.color !== undefined)
    delta.color = effective.color;
  if (delta.color !== undefined && colorReference) delta._varRefs = { color: colorReference };
  return Object.keys(delta).length ? delta : undefined;
}

function appendTextRun(runs: TextRun[], text: string, style?: TextStyleDelta): void {
  const previous = runs.at(-1);
  if (previous && JSON.stringify(previous.style) === JSON.stringify(style)) previous.text += text;
  else runs.push({ text, ...(style ? { style } : {}) });
}
