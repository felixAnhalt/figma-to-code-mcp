import type { MCPResponse, DesignTokens, V3Node, Style, Layout } from "../types";
import { countFrequencies } from "./frequencies";
import {
  COLOR_SEMANTIC_NAMES,
  SHADOW_SEMANTIC_NAMES,
  PADDING_COMBO_SEMANTIC_NAMES,
} from "./constants";
import {
  buildSemanticTokenRegistry,
  parseString,
  parseNumber,
  parsePaddingCombo,
  parseTypographyKey,
  buildTypographySemanticNames,
  buildSpacingSemanticMap,
  buildRadiusSemanticMap,
  buildHeightSemanticMap,
} from "./registry";
import { replaceNodeTokens, replaceComponentSetTokens } from "./replace";

// ── Figma variable ref collection ─────────────────────────────────────────────

type FigmaVarMaps = {
  colorsByName: Map<string, string>;
  spacingsByName: Map<string, number>;
  radiiByName: Map<string, number>;
};

/**
 * Walks the full node tree (root + componentSets) collecting Figma variable
 * name references from _varRefs sidecars on Style and Layout objects.
 * First-encountered name wins if two variables resolve to the same raw value.
 */
function collectFigmaVarRefs(response: MCPResponse): FigmaVarMaps {
  const colorsByName = new Map<string, string>();
  const spacingsByName = new Map<string, number>();
  const radiiByName = new Map<string, number>();

  function collectStyle(style: Style | undefined): void {
    if (!style?._varRefs) return;
    const refs = style._varRefs;

    if (refs.background && typeof style.background === "string") {
      if (!colorsByName.has(refs.background)) colorsByName.set(refs.background, style.background);
    }
    if (refs.border && typeof style.border === "string") {
      if (!colorsByName.has(refs.border)) colorsByName.set(refs.border, style.border);
    }
    if (refs.color && typeof style.color === "string") {
      if (!colorsByName.has(refs.color)) colorsByName.set(refs.color, style.color);
    }
    if (refs.radius && typeof style.radius === "number") {
      if (!radiiByName.has(refs.radius)) radiiByName.set(refs.radius, style.radius);
    }
    if (refs.borderWidth && typeof style.borderWidth === "number") {
      if (!spacingsByName.has(refs.borderWidth))
        spacingsByName.set(refs.borderWidth, style.borderWidth);
    }
  }

  function collectLayout(layout: Layout | undefined): void {
    if (!layout?._varRefs) return;
    const refs = layout._varRefs;

    if (refs.gap && typeof layout.gap === "number") {
      if (!spacingsByName.has(refs.gap)) spacingsByName.set(refs.gap, layout.gap);
    }

    // Unified padding token: all four sides same variable name
    if (
      refs.paddingTop &&
      refs.paddingTop === refs.paddingRight &&
      refs.paddingTop === refs.paddingBottom &&
      refs.paddingTop === refs.paddingLeft
    ) {
      if (typeof layout.padding === "number") {
        if (!spacingsByName.has(refs.paddingTop))
          spacingsByName.set(refs.paddingTop, layout.padding);
      }
    }
  }

  function collectNode(node: V3Node): void {
    collectStyle(node.style);
    collectLayout(node.layout);
    for (const child of node.children ?? []) collectNode(child);
  }

  collectNode(response.root);

  for (const set of Object.values(response.componentSets ?? {})) {
    collectStyle(set.base?.style);
    collectLayout(set.base?.layout);
    for (const child of set.base?.children ?? []) collectNode(child);
    for (const variant of Object.values(set.variants ?? {})) {
      collectStyle(variant.style);
      collectLayout(variant.layout);
      for (const child of variant.children ?? []) collectNode(child);
    }
  }

  return { colorsByName, spacingsByName, radiiByName };
}

// ── _varRefs stripping ────────────────────────────────────────────────────────

function stripVarRefsFromStyle(style: Style | undefined): Style | undefined {
  if (!style) return undefined;
  if (!style._varRefs) return style;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _varRefs: _, ...rest } = style;
  return rest;
}

function stripVarRefsFromLayout(layout: Layout | undefined): Layout | undefined {
  if (!layout) return undefined;
  if (!layout._varRefs) return layout;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { _varRefs, ...rest } = layout;
  return rest;
}

function stripVarRefsFromNode(node: V3Node): V3Node {
  const stripped: V3Node = {
    ...node,
    style: stripVarRefsFromStyle(node.style),
    layout: stripVarRefsFromLayout(node.layout),
    children: node.children?.map(stripVarRefsFromNode),
  };
  if (!stripped.style) delete stripped.style;
  if (!stripped.layout) delete stripped.layout;
  return stripped;
}

function stripVarRefsFromResponse(response: MCPResponse): MCPResponse {
  const newRoot = stripVarRefsFromNode(response.root);

  const newComponentSets = response.componentSets
    ? Object.fromEntries(
        Object.entries(response.componentSets).map(([key, set]) => [
          key,
          {
            ...set,
            base: set.base
              ? {
                  ...set.base,
                  style: stripVarRefsFromStyle(set.base.style),
                  layout: stripVarRefsFromLayout(set.base.layout),
                  children: set.base.children?.map(stripVarRefsFromNode),
                }
              : undefined,
            variants: Object.fromEntries(
              Object.entries(set.variants).map(([vk, variant]) => [
                vk,
                {
                  ...variant,
                  style: stripVarRefsFromStyle(variant.style),
                  layout: stripVarRefsFromLayout(variant.layout),
                  children: variant.children?.map(stripVarRefsFromNode),
                },
              ]),
            ),
          },
        ]),
      )
    : undefined;

  return {
    ...response,
    root: newRoot,
    ...(newComponentSets ? { componentSets: newComponentSets } : {}),
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

export function extractTokens(response: MCPResponse): MCPResponse {
  // Step 1: collect Figma variable name refs from _varRefs sidecars
  const { colorsByName, spacingsByName, radiiByName } = collectFigmaVarRefs(response);

  // Step 2: count frequencies (var-bound values are skipped inside countFrequencies)
  const { colors, spacings, radii, shadows, typographies, paddingCombos, heights } =
    countFrequencies(response);

  // Step 3: build semantic token registries from frequency-based invented names
  const { tokensByRaw: colorsByRaw, registry: colorRegistry } = buildSemanticTokenRegistry(
    colors,
    COLOR_SEMANTIC_NAMES,
    parseString,
  );
  const { tokensByRaw: shadowsByRaw, registry: shadowRegistry } = buildSemanticTokenRegistry(
    shadows,
    SHADOW_SEMANTIC_NAMES,
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
  const { tokensByRaw: paddingCombosByRaw, registry: paddingRegistry } = buildSemanticTokenRegistry(
    paddingCombos,
    PADDING_COMBO_SEMANTIC_NAMES,
    parsePaddingCombo,
  );
  const { tokensByRaw: heightsByRaw, registry: heightRegistry } = buildSemanticTokenRegistry(
    heights,
    buildHeightSemanticMap(heights),
    parseNumber,
  );

  const typographySemanticNames = buildTypographySemanticNames(typographies);
  const { tokensByRaw: typographiesByRaw, registry: typographyRegistry } =
    buildSemanticTokenRegistry(typographies, typographySemanticNames, parseTypographyKey);

  // Step 4: build the tokens registry including every Figma variable entry.
  // Multiple Figma variables may resolve to the same raw value; keep them distinct.
  const tokens: DesignTokens = {};

  if (Object.keys(colorRegistry).length > 0 || colorsByName.size > 0) {
    const merged: Record<string, string> = { ...colorRegistry };
    for (const [varName, hex] of colorsByName) {
      merged[varName] = hex;
    }
    if (Object.keys(merged).length > 0) tokens.colors = merged;
  }

  if (Object.keys(spacingRegistry).length > 0 || spacingsByName.size > 0) {
    const merged: Record<string, number> = { ...spacingRegistry };
    for (const [varName, val] of spacingsByName) {
      merged[varName] = val;
    }
    if (Object.keys(merged).length > 0) tokens.spacing = merged;
  }

  if (Object.keys(radiusRegistry).length > 0 || radiiByName.size > 0) {
    const merged: Record<string, number> = { ...radiusRegistry };
    for (const [varName, val] of radiiByName) {
      merged[varName] = val;
    }
    if (Object.keys(merged).length > 0) tokens.radius = merged;
  }

  if (Object.keys(shadowRegistry).length > 0) tokens.shadows = shadowRegistry;
  if (Object.keys(typographyRegistry).length > 0) tokens.typography = typographyRegistry;
  if (Object.keys(heightRegistry).length > 0) tokens.heights = heightRegistry;
  if (Object.keys(paddingRegistry).length > 0) tokens.paddingCombos = paddingRegistry;

  // Step 6: replace raw values in tree with token refs
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

  const withReplacements: MCPResponse = {
    ...response,
    tokens: Object.keys(tokens).length > 0 ? tokens : undefined,
    root: newRoot,
    ...(newComponentSets ? { componentSets: newComponentSets } : {}),
  };

  // Step 7: strip all _varRefs sidecars — must not appear in final output
  return stripVarRefsFromResponse(withReplacements);
}

export { normalizeShadowKey } from "./normalize";
