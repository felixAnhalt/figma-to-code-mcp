import type { MCPResponse, DesignTokens } from "../types";
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

export function extractTokens(response: MCPResponse): MCPResponse {
  const { colors, spacings, radii, shadows, typographies, paddingCombos, heights } =
    countFrequencies(response);

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

  const tokens: DesignTokens = {};
  if (Object.keys(colorRegistry).length > 0) tokens.colors = colorRegistry;
  if (Object.keys(spacingRegistry).length > 0) tokens.spacing = spacingRegistry;
  if (Object.keys(radiusRegistry).length > 0) tokens.radius = radiusRegistry;
  if (Object.keys(shadowRegistry).length > 0) tokens.shadows = shadowRegistry;
  if (Object.keys(typographyRegistry).length > 0) tokens.typography = typographyRegistry;
  if (Object.keys(heightRegistry).length > 0) tokens.heights = heightRegistry;
  if (Object.keys(paddingRegistry).length > 0) tokens.paddingCombos = paddingRegistry;

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

  return {
    ...response,
    tokens: Object.keys(tokens).length > 0 ? tokens : undefined,
    root: newRoot,
    ...(newComponentSets ? { componentSets: newComponentSets } : {}),
  };
}

export { normalizeShadowKey } from "./normalize";
