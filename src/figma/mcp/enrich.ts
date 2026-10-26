import { Logger } from "~/utils/logger";
import { fetchNodesBatch } from "../batchFetch";
import { buildNormalizedGraph, parseVariantProps } from "../reducer";
import type { PendingVectorWriteInput } from "../reducer/flush";
import type { VariableResolutionContext } from "../variableResolver";
import type {
  MCPResponse,
  V3Node,
  ComponentDefinition,
  ComponentSet,
  ComponentVariant,
  Layout,
  Style,
} from "../types";
import { componentSetIdentity, componentSourceIdentity } from "./componentMap";
import type { RichComponentMeta } from "./types";

export { parseVariantProps };

type ComponentMetadata = Record<string, RichComponentMeta>;
type Definitions = Record<string, ComponentDefinition>;
type VariantMember = { componentId: string; value: ComponentDefinition | ComponentVariant };
type DefinitionGroup = { name: string; suffix: string; componentIds: string[] };
type NestedComponentMetadata = Record<string, { key?: string; remote?: boolean }>;
type InstanceReference = { name: string; props: Record<string, string> };

const PUBLISHED_COMPONENT_REFERENCE = "published-component";
const PUBLISHED_REFERENCE_PREFIX = `["${PUBLISHED_COMPONENT_REFERENCE}"`;
const UNKNOWN_REMOTE_REFERENCE = "unknown-remote";

function collectInstancesByComponentId(node: V3Node): Map<string, V3Node> {
  const map = new Map<string, V3Node>();
  function walk(instance: V3Node): void {
    if (instance.component && !map.has(instance.component)) map.set(instance.component, instance);
    for (const child of instance.children ?? []) walk(child);
  }
  walk(node);
  return map;
}

export async function enrichDefinitions(
  normalized: MCPResponse,
  componentMap: ComponentMetadata,
  componentSetMap: Record<string, { name: string }>,
  authHeaders: Record<string, string>,
  variableContext: VariableResolutionContext | null,
  pendingVectors: PendingVectorWriteInput[] = [],
): Promise<void> {
  const definitions = normalized.definitions ?? {};
  applyInstanceFallbacks(definitions, normalized.root);
  applyDefinitionMetadata(definitions, componentMap, componentSetMap);
  const requests = collectSourceNodeRequests(definitions, componentMap);
  const reducedNodes = await fetchReducedSourceNodes(
    requests,
    authHeaders,
    variableContext,
    pendingVectors,
  );
  applySourceDefinitions(definitions, componentMap, reducedNodes);
  registerReferencedComponents(definitions, componentMap, componentSetMap, reducedNodes);
  addSiblingVariants(definitions, componentMap, reducedNodes);
  const { componentSets, namesByComponentId } = buildComponentSets(definitions, componentMap);
  normalized.componentSets = componentSets;
  patchEmittedInstances(normalized, namesByComponentId, componentMap);
  delete normalized.definitions;
}

function applyInstanceFallbacks(definitions: Definitions, root: V3Node) {
  const instances = collectInstancesByComponentId(root);
  for (const [id, definition] of Object.entries(definitions)) {
    const instance = instances.get(id);
    if (instance?.layout) definition.layout = instance.layout;
    if (instance?.style) definition.style = instance.style;
    if (instance?.children) definition.children = instance.children;
  }
}

function applyDefinitionMetadata(
  definitions: Definitions,
  componentMap: ComponentMetadata,
  componentSetMap: Record<string, { name: string }>,
) {
  for (const [id, definition] of Object.entries(definitions)) {
    const meta = componentMap[id];
    if (!meta) continue;
    definition.variantName = meta.name;
    definition.props = parseVariantProps(meta.name);
    const setMeta =
      componentSetMap[componentSetIdentity(meta)] ?? componentSetMap[meta.componentSetId ?? ""];
    if (meta.componentSetId && setMeta) definition.componentSetName = setMeta.name;
    definition.name = definition.componentSetName ?? definition.variantName;
  }
}

function collectSourceNodeRequests(definitions: Definitions, componentMap: ComponentMetadata) {
  const requests = new Map<string, Set<string>>();
  for (const id of Object.keys(definitions)) {
    const meta = componentMap[id];
    if (!meta?.file_key || !meta.node_id) continue;
    if (!requests.has(meta.file_key)) requests.set(meta.file_key, new Set());
    requests.get(meta.file_key)!.add(meta.node_id);
  }
  return requests;
}

async function fetchReducedSourceNodes(
  requests: Map<string, Set<string>>,
  authHeaders: Record<string, string>,
  variableContext: VariableResolutionContext | null,
  pendingVectors: PendingVectorWriteInput[],
) {
  const files = await Promise.all(
    [...requests].map(async ([fileKey, nodeIds]) => {
      try {
        const nodes = await fetchNodesBatch(fileKey, [...nodeIds], authHeaders);
        return reduceSourceNodes(fileKey, nodes, variableContext, pendingVectors);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        Logger.warn(`[enrichDefinitions] Skipping node tree fetch for ${fileKey}: ${message}`);
        return [];
      }
    }),
  );
  return new Map(files.flat());
}

function reduceSourceNodes(
  fileKey: string,
  nodes: Awaited<ReturnType<typeof fetchNodesBatch>>,
  variableContext: VariableResolutionContext | null,
  pendingVectors: PendingVectorWriteInput[],
): Array<[string, V3Node]> {
  return Object.entries(nodes).flatMap(([nodeId, entry]) => {
    if (!entry) return [];
    const nestedComponentMap = entry.components ?? {};
    const reduced = buildNormalizedGraph(
      entry as Record<string, unknown>,
      {},
      variableContext,
      nestedComponentMap,
      fileKey,
      {},
      pendingVectors,
    );
    // Keep source-local references unambiguous before discarding the source response metadata.
    scopeSourceReferences(reduced.root, fileKey, nestedComponentMap);
    return [[componentSourceIdentity({ file_key: fileKey, node_id: nodeId }), reduced.root]];
  });
}

function componentKeyReference(key: string) {
  return JSON.stringify([PUBLISHED_COMPONENT_REFERENCE, key, null]);
}

function scopeSourceReferences(
  node: V3Node,
  fileKey: string,
  metadata: NestedComponentMetadata,
): void {
  if (node.component) {
    const localId = node.component;
    const meta = metadata[localId];
    if (meta?.key) node.component = componentKeyReference(meta.key);
    else if (meta?.remote)
      node.component = JSON.stringify([UNKNOWN_REMOTE_REFERENCE, fileKey, localId]);
    else node.component = componentSourceIdentity({ file_key: fileKey, node_id: localId });
  }
  for (const child of node.children ?? []) scopeSourceReferences(child, fileKey, metadata);
}

function applySourceDefinitions(
  definitions: Definitions,
  componentMap: ComponentMetadata,
  reducedNodes: Map<string, V3Node>,
) {
  for (const [id, definition] of Object.entries(definitions)) {
    const meta = componentMap[id];
    const node = meta && reducedNodes.get(componentSourceIdentity(meta));
    if (!node) continue;
    definition.layout = node.layout;
    definition.style = node.style;
    definition.children = node.children;
  }
}

function registerReferencedComponents(
  definitions: Definitions,
  componentMap: ComponentMetadata,
  componentSetMap: Record<string, { name: string }>,
  reducedNodes: Map<string, V3Node>,
) {
  const idsByKey = new Map<string, string>();
  for (const [id, meta] of Object.entries(componentMap)) if (meta.key) idsByKey.set(meta.key, id);
  const registered: Definitions = {};
  for (const root of reducedNodes.values()) {
    for (const key of collectPublishedReferenceKeys(root)) {
      const id = idsByKey.get(key);
      if (id && !(id in definitions)) registered[id] = { name: componentMap[id].name };
    }
  }
  applyDefinitionMetadata(registered, componentMap, componentSetMap);
  Object.assign(definitions, registered);
}

function collectPublishedReferenceKeys(node: V3Node, keys: string[] = []): string[] {
  const key = publishedReferenceKey(node.component);
  if (key) keys.push(key);
  for (const child of node.children ?? []) collectPublishedReferenceKeys(child, keys);
  return keys;
}

function publishedReferenceKey(component: string | undefined): string | undefined {
  if (!component?.startsWith(PUBLISHED_REFERENCE_PREFIX)) return undefined;
  const [, key] = JSON.parse(component) as [string, string, null];
  return key;
}

function addSiblingVariants(
  definitions: Definitions,
  componentMap: ComponentMetadata,
  reducedNodes: Map<string, V3Node>,
) {
  for (const [id, definition] of Object.entries(definitions)) {
    const meta = componentMap[id];
    if (!meta?.componentSetId) continue;
    const variants: Record<string, ComponentVariant> = {};
    for (const [otherId, otherMeta] of Object.entries(componentMap)) {
      if (id === otherId || componentSetIdentity(meta) !== componentSetIdentity(otherMeta))
        continue;
      variants[otherId] = siblingVariant(
        otherMeta,
        reducedNodes.get(componentSourceIdentity(otherMeta)),
      );
    }
    if (Object.keys(variants).length > 0) definition.variants = variants;
  }
}

function siblingVariant(meta: RichComponentMeta, node?: V3Node): ComponentVariant {
  const identity = {
    name: meta.name,
    variantName: meta.name,
    props: parseVariantProps(meta.name),
    description: meta.description,
  };
  if (!node) return identity;
  return { ...identity, layout: node.layout, style: node.style, children: node.children };
}

function definitionIdentity(id: string, meta?: RichComponentMeta) {
  if (meta?.componentSetId) return JSON.stringify(["set", meta.file_key, meta.componentSetId]);
  if (meta?.file_key && meta.node_id)
    return JSON.stringify(["source", meta.file_key, meta.node_id]);
  return JSON.stringify(["local", id]);
}

function groupDefinitions(definitions: Definitions, componentMap: ComponentMetadata) {
  const groups = new Map<string, DefinitionGroup>();
  for (const [id, definition] of Object.entries(definitions)) {
    const meta = componentMap[id];
    const identity = definitionIdentity(id, meta);
    const name = definition.componentSetName ?? definition.name;
    const group = groups.get(identity) ?? {
      name,
      suffix: `${meta?.file_key || "local"}/${meta?.componentSetId ?? meta?.node_id ?? id}`,
      componentIds: [],
    };
    if (name < group.name) group.name = name;
    group.componentIds.push(id);
    groups.set(identity, group);
  }
  return groups;
}

function assignGroupNames(groups: Map<string, DefinitionGroup>) {
  const counts = new Map<string, number>();
  for (const group of groups.values()) counts.set(group.name, (counts.get(group.name) ?? 0) + 1);
  const reserved = new Set(counts.keys());
  const names = new Map<string, string>();
  for (const [identity, group] of [...groups].sort(([first], [second]) =>
    first.localeCompare(second),
  )) {
    let name = group.name;
    if (counts.get(name)! > 1) {
      name = `${group.name} [${group.suffix}]`;
      while (reserved.has(name)) name = `${name} [${identity}]`;
    }
    reserved.add(name);
    names.set(identity, name);
  }
  return names;
}

function buildComponentSets(definitions: Definitions, componentMap: ComponentMetadata) {
  const groups = groupDefinitions(definitions, componentMap);
  const names = assignGroupNames(groups);
  const componentSets: Record<string, ComponentSet> = {};
  const namesByComponentId = new Map<string, string>();
  for (const [identity, group] of groups) {
    const name = names.get(identity)!;
    const members = collectAllSetMembers(group.componentIds, definitions);
    const base = computeBaseStyles(members);
    const set: ComponentSet = {
      name,
      propKeys: extractPropKeys(members),
      variants: buildVariantOverrides(members, base),
    };
    if (base.layout || base.style || base.children) set.base = base;
    componentSets[name] = set;
    for (const { componentId } of members) namesByComponentId.set(componentId, name);
  }
  return { componentSets, namesByComponentId };
}

function collectAllSetMembers(componentIds: string[], definitions: Definitions): VariantMember[] {
  const members = new Map<string, ComponentDefinition | ComponentVariant>();
  for (const id of componentIds) members.set(id, definitions[id]);
  for (const id of componentIds) {
    for (const [variantId, variant] of Object.entries(definitions[id].variants ?? {})) {
      if (!members.has(variantId)) members.set(variantId, variant);
    }
  }
  return [...members].map(([componentId, value]) => ({ componentId, value }));
}

function computeBaseStyles(members: VariantMember[]): NonNullable<ComponentSet["base"]> {
  if (members.length === 0) return {};
  const layouts = members.map(({ value }) => value.layout);
  const styles = members.map(({ value }) => value.style);
  const children = members.map(({ value }) => value.children);
  return {
    layout: intersectObjects(layouts) as Layout | undefined,
    style: intersectObjects(styles) as Style | undefined,
    children: allEqual(children) ? children[0] : undefined,
  };
}

function intersectObjects(objects: Array<Record<string, unknown> | undefined>) {
  const first = objects[0];
  if (!first || objects.some((object) => object === undefined)) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(first)) {
    const serialised = JSON.stringify(value);
    if (
      objects.every(
        (object) =>
          object && Object.hasOwn(object, key) && JSON.stringify(object[key]) === serialised,
      )
    ) {
      result[key] = value;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function allEqual<T>(items: Array<T | undefined>): boolean {
  if (items.length === 0) return false;
  const first = JSON.stringify(items[0]);
  return items.every((item) => JSON.stringify(item) === first);
}

function extractPropKeys(members: VariantMember[]): string[] {
  return [...new Set(members.flatMap(({ value }) => Object.keys(value.props ?? {})))].sort();
}

function buildVariantOverrides(members: VariantMember[], base: NonNullable<ComponentSet["base"]>) {
  const variants: ComponentSet["variants"] = {};
  for (const { componentId, value } of members) {
    const entry: ComponentSet["variants"][string] = {};
    if (value.props && Object.keys(value.props).length > 0) entry.props = value.props;
    if (value.description) entry.description = value.description;
    const layout = diffObjects(value.layout, base.layout) as Layout | undefined;
    const style = diffObjects(value.style, base.style) as Style | undefined;
    if (layout) entry.layout = layout;
    if (style) entry.style = style;
    if (!allEqual([value.children, base.children]) && value.children)
      entry.children = value.children;
    variants[componentId] = entry;
  }
  return variants;
}

function diffObjects(
  obj: Record<string, unknown> | undefined,
  base: Record<string, unknown> | undefined,
) {
  if (!obj) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!base || JSON.stringify(value) !== JSON.stringify(base[key])) result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function patchEmittedInstances(
  normalized: MCPResponse,
  namesByComponentId: Map<string, string>,
  componentMap: ComponentMetadata,
): void {
  const references = buildInstanceReferences(namesByComponentId, componentMap);
  const visited = new WeakSet<V3Node>();
  patchTreeInstances(normalized.root, references, visited);
  for (const set of Object.values(normalized.componentSets ?? {})) {
    const children = [
      set.base?.children,
      ...Object.values(set.variants).map((variant) => variant.children),
    ];
    for (const child of children.flatMap((nodes) => nodes ?? []))
      patchTreeInstances(child, references, visited);
  }
}

function buildInstanceReferences(names: Map<string, string>, componentMap: ComponentMetadata) {
  const references = new Map<string, InstanceReference>();
  const ambiguous = new Set<string>();
  for (const [id, name] of names) {
    const meta = componentMap[id];
    const target = { name, props: parseVariantProps(meta?.name ?? "") };
    references.set(id, target);
    if (meta?.file_key && meta.node_id)
      addReferenceAlias(references, ambiguous, componentSourceIdentity(meta), target);
    if (meta?.key)
      addReferenceAlias(references, ambiguous, componentKeyReference(meta.key), target);
  }
  return references;
}

function addReferenceAlias(
  references: Map<string, InstanceReference>,
  ambiguous: Set<string>,
  identity: string,
  target: InstanceReference,
) {
  if (ambiguous.has(identity)) return;
  const existing = references.get(identity);
  if (existing && existing.name !== target.name) {
    references.delete(identity);
    ambiguous.add(identity);
  } else references.set(identity, target);
}

function patchTreeInstances(
  node: V3Node,
  references: Map<string, InstanceReference>,
  visited: WeakSet<V3Node>,
): void {
  if (visited.has(node)) return;
  visited.add(node);
  if (node.component) {
    const target = references.get(node.component);
    if (target) {
      node.component = target.name;
      if (Object.keys(target.props).length > 0) node.props = { ...node.props, ...target.props };
    }
  }
  for (const child of node.children ?? []) patchTreeInstances(child, references, visited);
}
