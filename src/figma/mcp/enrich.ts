import { fetchNodesBatch } from "../batchFetch";
import { buildNormalizedGraph, parseVariantProps } from "../reducer";
import { buildResolutionContext } from "../variableResolver";
import { Logger } from "~/utils/logger";
import type {
  MCPResponse,
  V3Node,
  ComponentDefinition,
  ComponentSet,
  ComponentVariant,
  Layout,
  Style,
} from "../types";
import type { RichComponentMeta } from "./types";

export { parseVariantProps };

function collectInstancesByComponentId(node: V3Node): Map<string, V3Node> {
  const map = new Map<string, V3Node>();
  function walk(n: V3Node): void {
    if (n.component && !map.has(n.component)) map.set(n.component, n);
    for (const child of n.children ?? []) walk(child);
  }
  walk(node);
  return map;
}

export async function enrichDefinitions(
  normalized: MCPResponse,
  componentMap: Record<string, RichComponentMeta>,
  componentSetMap: Record<string, { name: string }>,
  authHeaders: Record<string, string>,
  variableContext: ReturnType<typeof buildResolutionContext> | null,
): Promise<void> {
  const definitions = normalized.definitions!;

  const instancesByComponentId = collectInstancesByComponentId(normalized.root);
  for (const [componentId, def] of Object.entries(definitions)) {
    const instance = instancesByComponentId.get(componentId);
    if (!instance) continue;
    if (instance.layout) def.layout = instance.layout;
    if (instance.style) def.style = instance.style;
  }

  for (const [componentId, def] of Object.entries(definitions)) {
    const meta = componentMap[componentId];
    if (!meta) continue;

    def.variantName = meta.name;
    def.props = parseVariantProps(meta.name);

    if (meta.componentSetId) {
      const setMeta = componentSetMap[meta.componentSetId];
      if (setMeta) def.componentSetName = setMeta.name;
    }

    def.name = def.componentSetName ?? def.variantName ?? def.name;
  }

  const usedSetIds = new Set<string>();
  for (const componentId of Object.keys(definitions)) {
    const meta = componentMap[componentId];
    if (meta?.componentSetId) usedSetIds.add(meta.componentSetId);
  }

  const toFetch = new Map<string, Set<string>>();
  for (const meta of Object.values(componentMap)) {
    if (!meta.file_key || !meta.node_id) continue;
    const isDirect = meta.node_id in definitions;
    const isSibling = meta.componentSetId !== undefined && usedSetIds.has(meta.componentSetId);
    if (!isDirect && !isSibling) continue;

    if (!toFetch.has(meta.file_key)) toFetch.set(meta.file_key, new Set());
    toFetch.get(meta.file_key)!.add(meta.node_id);
  }

  if (toFetch.size > 0) {
    const fetchPromises = [...toFetch.entries()].map(([libFileKey, nodeIds]) =>
      fetchNodesBatch(libFileKey, [...nodeIds], authHeaders)
        .then((result) => ({ libFileKey, result }))
        .catch((err) => {
          Logger.warn(
            `[enrichDefinitions] Skipping node tree fetch for ${libFileKey}: ${err instanceof Error ? err.message : err}`,
          );
          return null;
        }),
    );
    const fetchResults = (await Promise.all(fetchPromises)).filter(
      (r): r is { libFileKey: string; result: Awaited<ReturnType<typeof fetchNodesBatch>> } =>
        r !== null,
    );

    const reducedNodes = new Map<string, ReturnType<typeof buildNormalizedGraph>["root"]>();
    for (const { libFileKey, result } of fetchResults) {
      for (const [nodeId, nodeEntry] of Object.entries(result)) {
        const nestedComponentMap = ((nodeEntry as Record<string, unknown>).components ??
          {}) as Record<string, RichComponentMeta>;
        const { ...reduced } = buildNormalizedGraph(
          nodeEntry as Record<string, unknown>,
          {},
          variableContext,
          nestedComponentMap,
          libFileKey,
        );
        reducedNodes.set(nodeId, reduced.root);
      }
    }

    for (const [componentId, def] of Object.entries(definitions)) {
      const meta = componentMap[componentId];
      if (!meta?.node_id) continue;

      const node = reducedNodes.get(meta.node_id);
      if (!node) continue;

      if (node.layout) def.layout = node.layout;
      if (node.style) def.style = node.style;
      if (node.children) def.children = node.children;
    }

    for (const [componentId, def] of Object.entries(definitions)) {
      const meta = componentMap[componentId];
      if (!meta?.componentSetId) continue;

      const variants: Record<string, ComponentVariant> = {};

      for (const [otherId, otherMeta] of Object.entries(componentMap)) {
        if (otherId === componentId) continue;
        if (otherMeta.componentSetId !== meta.componentSetId) continue;
        if (!otherMeta.node_id) continue;

        const otherNode = reducedNodes.get(otherMeta.node_id);
        if (!otherNode) continue;

        const variant: ComponentVariant = { name: otherMeta.name };
        if (otherMeta.description) variant.description = otherMeta.description;
        variant.variantName = otherMeta.name;
        variant.props = parseVariantProps(otherMeta.name);
        if (otherNode.layout) variant.layout = otherNode.layout;
        if (otherNode.style) variant.style = otherNode.style;
        if (otherNode.children) variant.children = otherNode.children;

        variants[otherId] = variant;
      }

      if (Object.keys(variants).length > 0) def.variants = variants;
    }
  }

  normalized.componentSets = buildComponentSets(definitions, componentMap);
  patchTreeInstances(normalized.root, definitions, componentMap);
  delete normalized.definitions;
}

function buildComponentSets(
  definitions: Record<string, ComponentDefinition>,
  componentMap: Record<string, RichComponentMeta>,
): Record<string, ComponentSet> {
  const bySetName = new Map<string, string[]>();
  for (const [componentId, def] of Object.entries(definitions)) {
    const setName = def.componentSetName ?? def.name;
    if (!bySetName.has(setName)) bySetName.set(setName, []);
    bySetName.get(setName)!.push(componentId);
  }

  const componentSets: Record<string, ComponentSet> = {};

  for (const [setName, componentIds] of bySetName.entries()) {
    const allMembers = collectAllSetMembers(componentIds, definitions);
    const base = computeBaseStyles(allMembers);
    const propKeys = extractPropKeys(allMembers);
    const variants = buildVariantOverrides(allMembers, base, componentMap);

    const set: ComponentSet = { name: setName, propKeys, variants };
    if (base.layout || base.style || base.children) set.base = base;
    componentSets[setName] = set;
  }

  return componentSets;
}

type VariantMember = {
  componentId: string;
  def: ComponentDefinition;
  variant?: ComponentVariant;
};

function collectAllSetMembers(
  componentIds: string[],
  definitions: Record<string, ComponentDefinition>,
): VariantMember[] {
  const seen = new Set<string>();
  const members: VariantMember[] = [];

  for (const componentId of componentIds) {
    const def = definitions[componentId];
    if (!def) continue;

    if (!seen.has(componentId)) {
      seen.add(componentId);
      members.push({ componentId, def });
    }

    for (const [variantId, variant] of Object.entries(def.variants ?? {})) {
      if (!seen.has(variantId)) {
        seen.add(variantId);
        members.push({ componentId: variantId, def, variant });
      }
    }
  }

  return members;
}

function computeBaseStyles(members: VariantMember[]): NonNullable<ComponentSet["base"]> {
  if (members.length === 0) return {};

  const layouts = members.map((m) => m.variant?.layout ?? m.def.layout);
  const styles = members.map((m) => m.variant?.style ?? m.def.style);
  const children = members.map((m) => m.variant?.children ?? m.def.children);

  return {
    layout: intersectObjects(layouts) as Layout | undefined,
    style: intersectObjects(styles) as Style | undefined,
    children: allEqual(children) ? children[0] : undefined,
  };
}

function intersectObjects(
  objects: Array<Record<string, unknown> | undefined>,
): Record<string, unknown> | undefined {
  const defined = objects.filter((o): o is Record<string, unknown> => o !== undefined);
  if (defined.length === 0) return undefined;

  const first = defined[0];
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(first)) {
    const serialised = JSON.stringify(value);
    const allMatch = defined.every((obj) => JSON.stringify(obj[key]) === serialised);
    if (allMatch) result[key] = value;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function allEqual<T>(items: Array<T | undefined>): boolean {
  if (items.length === 0) return false;
  const first = JSON.stringify(items[0]);
  return items.every((item) => JSON.stringify(item) === first);
}

function extractPropKeys(members: VariantMember[]): string[] {
  const keySet = new Set<string>();
  for (const { def, variant } of members) {
    const props = variant?.props ?? def.props ?? {};
    for (const key of Object.keys(props)) keySet.add(key);
  }
  return [...keySet].sort();
}

function buildVariantOverrides(
  members: VariantMember[],
  base: NonNullable<ComponentSet["base"]>,
  componentMap: Record<string, RichComponentMeta>,
): ComponentSet["variants"] {
  const variants: ComponentSet["variants"] = {};

  for (const { componentId, def, variant: siblingVariant } of members) {
    const layout = siblingVariant?.layout ?? def.layout;
    const style = siblingVariant?.style ?? def.style;
    const children = siblingVariant?.children ?? def.children;
    const props = siblingVariant?.props ?? def.props;
    const description = siblingVariant?.description ?? def.description;

    const entry: ComponentSet["variants"][string] = {};

    if (props && Object.keys(props).length > 0) entry.props = props;
    if (description) entry.description = description;

    const layoutOverride = diffObjects(layout, base.layout) as Layout | undefined;
    const styleOverride = diffObjects(style, base.style) as Style | undefined;

    if (layoutOverride) entry.layout = layoutOverride;
    if (styleOverride) entry.style = styleOverride;

    if (!allEqual([children, base.children])) {
      if (children) entry.children = children;
    }

    void componentMap;
    variants[componentId] = entry;
  }

  return variants;
}

function diffObjects(
  obj: Record<string, unknown> | undefined,
  base: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!obj) return undefined;

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!base || JSON.stringify(value) !== JSON.stringify(base[key])) {
      result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function patchTreeInstances(
  node: V3Node,
  definitions: Record<string, ComponentDefinition>,
  componentMap: Record<string, RichComponentMeta>,
): void {
  if (node.component) {
    const componentId = node.component;
    const def = definitions[componentId];

    if (def) {
      node.component = def.componentSetName ?? def.name;
    }

    if (componentMap[componentId]) {
      const instanceProps = parseVariantProps(componentMap[componentId].name);
      if (Object.keys(instanceProps).length > 0) node.props = instanceProps;
    }
  }

  for (const child of node.children ?? []) {
    patchTreeInstances(child, definitions, componentMap);
  }
}
