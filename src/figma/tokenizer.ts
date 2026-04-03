import type { MCPResponse, V3Node, Style, Layout, DesignTokens, TypographyToken } from "./types";

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_USES_FOR_TOKEN = 2;

// Semantic names for well-known rgba() color values found in the design.
// ONLY values listed here are tokenized — no fallback names for unknown colors.
const COLOR_SEMANTIC_NAMES: Record<string, string> = {
  "rgba(255, 255, 255, 1)": "white",
  "rgba(151, 71, 255, 1)": "primary",
  "rgba(48, 52, 63, 1)": "surfaceDark",
  "rgba(22, 25, 34, 1)": "textPrimary",
  "rgba(106, 110, 121, 1)": "textSecondary",
  "rgba(250, 250, 255, 1)": "surfaceLight",
  "rgba(74, 78, 89, 1)": "textMuted",
  "rgba(236, 238, 247, 1)": "borderLight",
  "rgba(64, 74, 136, 1)": "primaryDark",
  "rgba(185, 28, 28, 1)": "destructive",
  "rgba(0, 0, 0, 1)": "black",
  "rgba(0, 0, 0, 0)": "transparent",
};

// Semantic names for shadow values (normalized form — see normalizeShadowKey).
// ONLY values listed here are tokenized.
const SHADOW_SEMANTIC_NAMES: Record<string, string> = {
  "0px 1px 2px 0px rgba(0,0,0,0.05)": "sm",
  "0px 1px 2px -1px rgba(0,0,0,0.1), 0px 1px 3px 0px rgba(0,0,0,0.1)": "md",
  "0px 0px 0px 3px rgba(6,182,212,1)": "focusRing",
  "0px 0px 0px 3px rgba(239,68,68,1)": "focusRingDestructive",
};

// Semantic names for gap/padding scalar values.
// ONLY values listed here are tokenized — no fallback names for unknown spacings.
const SPACING_SEMANTIC_NAMES: Record<number, string> = {
  2: "xs",
  4: "sm",
  6: "md",
  8: "lg",
  10: "xl",
  12: "2xl",
  16: "3xl",
  20: "4xl",
  24: "5xl",
  32: "6xl",
  48: "7xl",
  64: "8xl",
};

// Semantic names for border-radius values.
// ONLY values listed here are tokenized.
const RADIUS_SEMANTIC_NAMES: Record<number, string> = {
  2: "xs",
  4: "sm",
  8: "md",
  16: "lg",
  9999: "full",
};

// Semantic names for [vertical, horizontal] padding combos.
// Key is "v,h" serialization.
const PADDING_COMBO_SEMANTIC_NAMES: Record<string, string> = {
  "8,16": "buttonMd",
  "5.5,12": "buttonSm",
  "10,24": "buttonLg",
  "3,8": "buttonXs",
};

// Semantic names for minHeight values.
const HEIGHT_SEMANTIC_NAMES: Record<number, string> = {
  24: "xs",
  32: "sm",
  36: "md",
  40: "lg",
};

// ── Shadow normalization ───────────────────────────────────────────────────────

/**
 * Normalises a raw Figma shadow string for semantic name lookup:
 * - Removes spaces inside rgba() calls: "rgba(0, 0, 0, 0.05)" → "rgba(0,0,0,0.05)"
 * - Rounds float alpha values to 2 decimal places: 0.05000000074505806 → 0.05
 *
 * This compensates for Figma's float precision noise in exported values.
 */
export function normalizeShadowKey(raw: string): string {
  return raw.replace(/rgba\(([^)]+)\)/g, (_match, inner) => {
    const parts = inner.split(",").map((s: string) => s.trim());
    const normalized = parts.map((p: string, i: number) => {
      if (i < 3) return p; // r, g, b — integers, pass through
      // alpha channel — round to 2 decimal places
      const n = parseFloat(p);
      const rounded = Math.round(n * 100) / 100;
      // Use minimal representation: 0.05 not 0.050
      return String(rounded);
    });
    return `rgba(${normalized.join(",")})`;
  });
}

// ── Frequency counters ────────────────────────────────────────────────────────

type FrequencyMap = Map<string, number>;

/**
 * Walks the full MCPResponse (tree + componentSets) and counts how many times
 * each raw value appears in style/layout fields. Returns one map per token category.
 */
function countFrequencies(response: MCPResponse): {
  colors: FrequencyMap;
  spacings: FrequencyMap;
  radii: FrequencyMap;
  shadows: FrequencyMap;
  typographies: FrequencyMap;
  paddingCombos: FrequencyMap;
  heights: FrequencyMap;
} {
  const colors: FrequencyMap = new Map();
  const spacings: FrequencyMap = new Map();
  const radii: FrequencyMap = new Map();
  const shadows: FrequencyMap = new Map();
  const typographies: FrequencyMap = new Map();
  const paddingCombos: FrequencyMap = new Map();
  const heights: FrequencyMap = new Map();

  function countStyle(style: Style | undefined): void {
    if (!style) return;

    if (typeof style.background === "string") increment(colors, style.background);
    if (typeof style.border === "string") increment(colors, style.border);
    if (typeof style.color === "string") increment(colors, style.color);
    if (typeof style.shadow === "string") increment(shadows, normalizeShadowKey(style.shadow));
    if (typeof style.radius === "number") increment(radii, String(style.radius));

    const typoKey = buildTypographyKey(style);
    if (typoKey) increment(typographies, typoKey);
  }

  function countLayout(layout: Layout | undefined): void {
    if (!layout) return;

    if (typeof layout.gap === "number") increment(spacings, String(layout.gap));

    if (typeof layout.padding === "number") {
      increment(spacings, String(layout.padding));
    } else if (Array.isArray(layout.padding)) {
      const [v, h] = layout.padding;
      // Count as a combo unit (not individual scalars) so the combo can be tokenized
      increment(paddingCombos, `${v},${h}`);
    } else if (layout.padding && typeof layout.padding === "object") {
      const p = layout.padding as { top: number; right: number; bottom: number; left: number };
      increment(spacings, String(p.top));
      increment(spacings, String(p.right));
      increment(spacings, String(p.bottom));
      increment(spacings, String(p.left));
    }

    if (typeof layout.minHeight === "number") increment(heights, String(layout.minHeight));
  }

  function countNode(node: V3Node): void {
    countStyle(node.style);
    countLayout(node.layout);
    for (const child of node.children ?? []) countNode(child);
  }

  countNode(response.root);

  for (const set of Object.values(response.componentSets ?? {})) {
    countStyle(set.base?.style);
    countLayout(set.base?.layout);
    for (const child of set.base?.children ?? []) countNode(child);

    for (const variant of Object.values(set.variants ?? {})) {
      countStyle(variant.style);
      countLayout(variant.layout);
      for (const child of variant.children ?? []) countNode(child);
    }
  }

  return { colors, spacings, radii, shadows, typographies, paddingCombos, heights };
}

function increment(map: FrequencyMap, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

// ── Token key builders ────────────────────────────────────────────────────────

/**
 * Serialises the typography combo (font + size + weight + lineHeight) as a
 * stable string key used for frequency counting and token lookup.
 */
function buildTypographyKey(style: Style): string | null {
  if (!style.font || !style.fontSize || !style.fontWeight) return null;
  return `${style.font}/${style.fontSize}/${style.fontWeight}/${style.lineHeight ?? ""}`;
}

// ── Token registry builders ───────────────────────────────────────────────────

/**
 * Filters a frequency map to entries that:
 * 1. Appear MIN_USES_FOR_TOKEN or more times, AND
 * 2. Have a semantic name in the provided map (no fallback tokens for unnamed values)
 *
 * Returns a map from raw value → token name, and the registry of name → parsed value.
 */
function buildSemanticTokenRegistry<T>(
  frequencyMap: FrequencyMap,
  semanticNames: Record<string, string>,
  valueParser: (raw: string) => T,
): { tokensByRaw: Map<string, string>; registry: Record<string, T> } {
  const tokensByRaw = new Map<string, string>();
  const registry: Record<string, T> = {};

  for (const [raw, count] of frequencyMap.entries()) {
    if (count < MIN_USES_FOR_TOKEN) continue;
    const name = semanticNames[raw];
    if (!name) continue; // skip values without a semantic name
    tokensByRaw.set(raw, name);
    registry[name] = valueParser(raw);
  }

  return { tokensByRaw, registry };
}

/** Parses a raw spacing string ("8") to a number. */
function parseNumber(raw: string): number {
  return Number(raw);
}

/** Parses a raw shadow/color string as-is. */
function parseString(raw: string): string {
  return raw;
}

/** Parses a padding combo key ("8,16") to a [number, number] tuple. */
function parsePaddingCombo(raw: string): [number, number] {
  const [v, h] = raw.split(",").map(Number);
  return [v, h];
}

/** Parses a typography key ("Geist/14/600/18") into a TypographyToken. */
function parseTypographyKey(raw: string): TypographyToken {
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

// ── Typography semantic name resolution ───────────────────────────────────────

/**
 * Assigns a semantic name to each typography combo based on font size and weight.
 * Only assigns names to combos that appear MIN_USES_FOR_TOKEN or more times.
 */
function buildTypographySemanticNames(frequencyMap: FrequencyMap): Record<string, string> {
  const names: Record<string, string> = {};

  for (const [key, count] of frequencyMap.entries()) {
    if (count < MIN_USES_FOR_TOKEN) continue;
    const [, sizeStr, weightStr] = key.split("/");
    const size = Number(sizeStr);
    const weight = Number(weightStr);
    names[key] = resolveTypographyName(size, weight);
  }

  // Deduplicate: if two combos resolve to the same name, suffix them
  const seen = new Map<string, number>();
  for (const [key, name] of Object.entries(names)) {
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    if (count > 1) names[key] = `${name}${count}`;
  }

  return names;
}

function resolveTypographyName(size: number, weight: number): string {
  if (size >= 32) return "heading";
  if (size >= 24) return "headingSm";
  if (size >= 20) return "subheading";
  if (size >= 18) return "bodyLg";
  if (size >= 16) return weight >= 600 ? "labelLg" : "bodyMd";
  if (size >= 14) return weight >= 600 ? "labelMd" : "bodySm";
  if (size >= 12) return weight >= 600 ? "labelSm" : "caption";
  return "captionXs";
}

// ── Build semantic name maps for number-keyed categories ─────────────────────

function buildSpacingSemanticMap(frequencyMap: FrequencyMap): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [raw] of frequencyMap.entries()) {
    const n = Number(raw);
    const name = SPACING_SEMANTIC_NAMES[n];
    if (name) map[raw] = name;
  }
  return map;
}

function buildRadiusSemanticMap(frequencyMap: FrequencyMap): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [raw] of frequencyMap.entries()) {
    const n = Number(raw);
    const name = RADIUS_SEMANTIC_NAMES[n];
    if (name) map[raw] = name;
  }
  return map;
}

function buildHeightSemanticMap(frequencyMap: FrequencyMap): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [raw] of frequencyMap.entries()) {
    const n = Number(raw);
    const name = HEIGHT_SEMANTIC_NAMES[n];
    if (name) map[raw] = name;
  }
  return map;
}

// ── Token replacement ─────────────────────────────────────────────────────────

function replaceStyleTokens(
  style: Style | undefined,
  colorsByRaw: Map<string, string>,
  shadowsByRaw: Map<string, string>,
  radiiByRaw: Map<string, string>,
  typographiesByRaw: Map<string, string>,
): Style | undefined {
  if (!style) return undefined;
  const s = { ...style };

  if (typeof s.background === "string") {
    const t = colorsByRaw.get(s.background);
    if (t) s.background = `colors.${t}`;
  }
  if (typeof s.border === "string") {
    const t = colorsByRaw.get(s.border);
    if (t) s.border = `colors.${t}`;
  }
  if (typeof s.color === "string") {
    const t = colorsByRaw.get(s.color);
    if (t) s.color = `colors.${t}`;
  }
  if (typeof s.shadow === "string") {
    const normalized = normalizeShadowKey(s.shadow);
    const t = shadowsByRaw.get(normalized);
    if (t) s.shadow = `shadows.${t}`;
  }
  if (typeof s.radius === "number") {
    const t = radiiByRaw.get(String(s.radius));
    if (t) s.radius = `radius.${t}`;
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

  return s;
}

function replaceLayoutTokens(
  layout: Layout | undefined,
  spacingsByRaw: Map<string, string>,
  paddingCombosByRaw: Map<string, string>,
  heightsByRaw: Map<string, string>,
): Layout | undefined {
  if (!layout) return undefined;
  const l = { ...layout };

  // gap
  if (typeof l.gap === "number") {
    const t = spacingsByRaw.get(String(l.gap));
    if (t) l.gap = `spacing.${t}`;
  }

  // padding
  if (typeof l.padding === "number") {
    const t = spacingsByRaw.get(String(l.padding));
    if (t) l.padding = `spacing.${t}`;
  } else if (Array.isArray(l.padding)) {
    const [v, h] = l.padding;
    const comboKey = `${v},${h}`;
    const comboToken = paddingCombosByRaw.get(comboKey);
    if (comboToken) {
      l.padding = `paddingCombos.${comboToken}`;
    }
    // If no combo token: leave as raw [v, h] array (no partial replacement)
  } else if (l.padding && typeof l.padding === "object") {
    // Object padding: only replace if all four sides are the same token
    const p = l.padding as { top: number; right: number; bottom: number; left: number };
    const tt = spacingsByRaw.get(String(p.top));
    const tr = spacingsByRaw.get(String(p.right));
    const tb = spacingsByRaw.get(String(p.bottom));
    const tl = spacingsByRaw.get(String(p.left));
    if (tt && tt === tr && tt === tb && tt === tl) {
      l.padding = `spacing.${tt}`;
    }
  }

  // minHeight
  if (typeof l.minHeight === "number") {
    const t = heightsByRaw.get(String(l.minHeight));
    if (t) l.minHeight = `heights.${t}`;
  }

  // sizing shorthand collapse: if sizingH === sizingV, fold into sizing
  if (l.sizingH && l.sizingV && l.sizingH === l.sizingV) {
    l.sizing = l.sizingH;
    delete l.sizingH;
    delete l.sizingV;
  }

  return l;
}

function replaceNodeTokens(
  node: V3Node,
  colorsByRaw: Map<string, string>,
  shadowsByRaw: Map<string, string>,
  radiiByRaw: Map<string, string>,
  spacingsByRaw: Map<string, string>,
  typographiesByRaw: Map<string, string>,
  paddingCombosByRaw: Map<string, string>,
  heightsByRaw: Map<string, string>,
): V3Node {
  const n = { ...node };

  n.style = replaceStyleTokens(n.style, colorsByRaw, shadowsByRaw, radiiByRaw, typographiesByRaw);
  n.layout = replaceLayoutTokens(n.layout, spacingsByRaw, paddingCombosByRaw, heightsByRaw);

  if (n.children) {
    n.children = n.children.map((child) =>
      replaceNodeTokens(
        child,
        colorsByRaw,
        shadowsByRaw,
        radiiByRaw,
        spacingsByRaw,
        typographiesByRaw,
        paddingCombosByRaw,
        heightsByRaw,
      ),
    );
  }

  return n;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Post-pass tokenizer: scans the MCPResponse for repeated raw values and
 * replaces them with token reference strings (e.g. "colors.primary").
 * Returns a new MCPResponse with:
 * - `tokens` dict populated (categories: colors, spacing, radius, typography, shadows,
 *   paddingCombos, heights)
 * - All style/layout fields using flat token strings instead of repeated raw values
 * - sizingH + sizingV collapsed to sizing when both match
 *
 * Only values appearing MIN_USES_FOR_TOKEN (2+) times AND having a semantic name are tokenized.
 * The tree structure and componentSets shape are not changed.
 */
export function extractTokens(response: MCPResponse): MCPResponse {
  const { colors, spacings, radii, shadows, typographies, paddingCombos, heights } =
    countFrequencies(response);

  // Build per-category token registries (semantic names only — no fallback tokens)
  const { tokensByRaw: colorsByRaw, registry: colorRegistry } = buildSemanticTokenRegistry(
    colors,
    COLOR_SEMANTIC_NAMES,
    parseString,
  );

  const { tokensByRaw: spacingsByRaw, registry: spacingRegistry } = buildSemanticTokenRegistry(
    spacings,
    buildSpacingSemanticMap(spacings),
    parseNumber,
  );

  const { tokensByRaw: radiiByRaw, registry: radiusRegistry } = buildSemanticTokenRegistry(
    radii,
    buildRadiusSemanticMap(radii),
    parseNumber,
  );

  // Normalize shadow keys before lookup
  const normalizedShadows: FrequencyMap = new Map();
  for (const [raw, count] of shadows.entries()) {
    normalizedShadows.set(normalizeShadowKey(raw), count);
  }
  const { tokensByRaw: shadowsByRaw, registry: shadowRegistry } = buildSemanticTokenRegistry(
    normalizedShadows,
    SHADOW_SEMANTIC_NAMES,
    parseString,
  );

  const typographySemantics = buildTypographySemanticNames(typographies);
  const { tokensByRaw: typographiesByRaw, registry: typographyRegistry } =
    buildSemanticTokenRegistry(typographies, typographySemantics, parseTypographyKey);

  const paddingComboSemantics: Record<string, string> = {};
  for (const [raw] of paddingCombos.entries()) {
    const name = PADDING_COMBO_SEMANTIC_NAMES[raw];
    if (name) paddingComboSemantics[raw] = name;
  }
  const { tokensByRaw: paddingCombosByRaw, registry: paddingCombosRegistry } =
    buildSemanticTokenRegistry(paddingCombos, paddingComboSemantics, parsePaddingCombo);

  const { tokensByRaw: heightsByRaw, registry: heightsRegistry } = buildSemanticTokenRegistry(
    heights,
    buildHeightSemanticMap(heights),
    parseNumber,
  );

  // Assemble design tokens object — omit empty categories
  const tokens: DesignTokens = {};
  if (Object.keys(colorRegistry).length > 0) tokens.colors = colorRegistry;
  if (Object.keys(spacingRegistry).length > 0) tokens.spacing = spacingRegistry;
  if (Object.keys(radiusRegistry).length > 0) tokens.radius = radiusRegistry;
  if (Object.keys(shadowRegistry).length > 0) tokens.shadows = shadowRegistry;
  if (Object.keys(typographyRegistry).length > 0) tokens.typography = typographyRegistry;
  if (Object.keys(paddingCombosRegistry).length > 0) tokens.paddingCombos = paddingCombosRegistry;
  if (Object.keys(heightsRegistry).length > 0) tokens.heights = heightsRegistry;

  // Replace raw values in the tree
  const newRoot = replaceNodeTokens(
    response.root,
    colorsByRaw,
    shadowsByRaw,
    radiiByRaw,
    spacingsByRaw,
    typographiesByRaw,
    paddingCombosByRaw,
    heightsByRaw,
  );

  // Replace raw values in componentSets
  const newComponentSets = response.componentSets
    ? replaceComponentSetTokens(
        response.componentSets,
        colorsByRaw,
        shadowsByRaw,
        radiiByRaw,
        spacingsByRaw,
        typographiesByRaw,
        paddingCombosByRaw,
        heightsByRaw,
      )
    : undefined;

  return {
    ...response,
    tokens: Object.keys(tokens).length > 0 ? tokens : undefined,
    root: newRoot,
    ...(newComponentSets ? { componentSets: newComponentSets } : {}),
  };
}

function replaceComponentSetTokens(
  componentSets: NonNullable<MCPResponse["componentSets"]>,
  colorsByRaw: Map<string, string>,
  shadowsByRaw: Map<string, string>,
  radiiByRaw: Map<string, string>,
  spacingsByRaw: Map<string, string>,
  typographiesByRaw: Map<string, string>,
  paddingCombosByRaw: Map<string, string>,
  heightsByRaw: Map<string, string>,
): NonNullable<MCPResponse["componentSets"]> {
  const result: NonNullable<MCPResponse["componentSets"]> = {};

  for (const [setName, set] of Object.entries(componentSets)) {
    const newBase = set.base
      ? {
          style: replaceStyleTokens(
            set.base.style,
            colorsByRaw,
            shadowsByRaw,
            radiiByRaw,
            typographiesByRaw,
          ),
          layout: replaceLayoutTokens(
            set.base.layout,
            spacingsByRaw,
            paddingCombosByRaw,
            heightsByRaw,
          ),
          children: set.base.children?.map((child) =>
            replaceNodeTokens(
              child,
              colorsByRaw,
              shadowsByRaw,
              radiiByRaw,
              spacingsByRaw,
              typographiesByRaw,
              paddingCombosByRaw,
              heightsByRaw,
            ),
          ),
        }
      : undefined;

    const newVariants: typeof set.variants = {};
    for (const [variantId, variant] of Object.entries(set.variants)) {
      newVariants[variantId] = {
        ...variant,
        style: replaceStyleTokens(
          variant.style,
          colorsByRaw,
          shadowsByRaw,
          radiiByRaw,
          typographiesByRaw,
        ),
        layout: replaceLayoutTokens(
          variant.layout,
          spacingsByRaw,
          paddingCombosByRaw,
          heightsByRaw,
        ),
        children: variant.children?.map((child) =>
          replaceNodeTokens(
            child,
            colorsByRaw,
            shadowsByRaw,
            radiiByRaw,
            spacingsByRaw,
            typographiesByRaw,
            paddingCombosByRaw,
            heightsByRaw,
          ),
        ),
      };
    }

    result[setName] = {
      ...set,
      ...(newBase ? { base: newBase } : {}),
      variants: newVariants,
    };
  }

  return result;
}
