import type { V3Node, MCPResponse } from "../../types";
import { replaceStyleTokens } from "./style";
import { replaceLayoutTokens } from "./layout";

export function replaceNodeTokens(
  node: V3Node,
  colorsByRaw: Map<string, string>,
  shadowsByRaw: Map<string, string>,
  radiiByRaw: Map<string, string>,
  spacingsByRaw: Map<string, string>,
  typographiesByRaw: Map<string, string>,
  paddingCombosByRaw: Map<string, string>,
  heightsByRaw: Map<string, string>,
): V3Node {
  const n: V3Node = {
    ...node,
    style: replaceStyleTokens(node.style, colorsByRaw, shadowsByRaw, radiiByRaw, typographiesByRaw),
    layout: replaceLayoutTokens(node.layout, spacingsByRaw, paddingCombosByRaw, heightsByRaw),
    children: node.children?.map((child) =>
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

  return n;
}

export function replaceComponentSetTokens(
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
