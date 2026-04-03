import { fetchNodesBatch } from "./batchFetch";
import { safeFetch } from "./rateLimit";
import { getCache, setCache } from "./cache";
import { buildNormalizedGraph, parseVariantProps } from "./reducer";
import { buildResolutionContext } from "./variableResolver";
import type {
  MCPResponse,
  V3Node,
  ComponentVariant,
  ComponentSet,
  ComponentDefinition,
  Layout,
  Style,
} from "./types";
import type { GetLocalVariablesResponse } from "@figma/rest-api-spec";
import { Logger } from "~/utils/logger";

/**
 * Rich component metadata with file_key and node_id resolved so callers can
 * fetch the component's actual node tree from its source library file.
 */
export type RichComponentMeta = {
  key: string;
  file_key: string;
  node_id: string;
  componentSetId?: string;
  name: string;
  description?: string;
};

export type MCPOptions = {
  fileKey: string;
  authHeaders: Record<string, string>;
  rootNodeId: string;
  styleMap?: Record<string, unknown>;
  cacheTTL?: number;
  resolveVariables?: boolean;
  /**
   * Pre-built component map keyed by local node ID.
   * When omitted, generateMCPResponse builds it automatically from the raw
   * node entry's embedded components dict using buildRichComponentMap.
   * Inject in tests to avoid mocking the internal resolution API calls.
   */
  componentMap?: Record<string, RichComponentMeta>;
  /**
   * Pre-built component set map keyed by set node ID.
   * When omitted, generateMCPResponse builds it automatically.
   * Inject in tests to avoid mocking the internal resolution API calls.
   */
  componentSetMap?: Record<string, { name: string }>;
};

/**
 * Builds a RichComponentMeta map from the raw components dict embedded in a
 * /nodes response entry (shape: Record<localNodeId, { key, name, componentSetId, remote }>).
 *
 * The raw dict has public keys but not file_key/node_id — those require API
 * resolution. Strategy (2 API calls total, regardless of component count):
 *   1. Resolve one representative public key → GET /v1/components/{key} → file_key
 *   2. GET /v1/files/{libFileKey}/components → all 1908+ components with node_id
 *   3. Cross-reference by public key to map localNodeId → { file_key, node_id, ... }
 *
 * Also fetches component sets from the same library file for componentSetMap.
 * Returns empty maps if rawComponents is empty (nothing to resolve).
 */
async function buildRichComponentMap(
  rawComponents: Record<
    string,
    { key: string; name: string; componentSetId?: string; remote?: boolean }
  >,
  rawComponentSets: Record<string, { name: string }>,
  authHeaders: Record<string, string>,
): Promise<{
  componentMap: Record<string, RichComponentMeta>;
  componentSetMap: Record<string, { name: string }>;
}> {
  const entries = Object.entries(rawComponents);
  if (entries.length === 0) return { componentMap: {}, componentSetMap: {} };

  // The consumer-file /nodes response already embeds componentSets keyed by the same
  // local node IDs that components reference via componentSetId — use it directly.
  // The library's own component_sets endpoint uses library-side node IDs which are a
  // completely different key space and cannot be cross-referenced with componentSetId.
  const componentSetMap: Record<string, { name: string }> = {};
  for (const [nodeId, set] of Object.entries(rawComponentSets)) {
    componentSetMap[nodeId] = { name: set.name };
  }

  // Try up to 3 entries to find one that resolves. Most will succeed on the first
  // try; the cap prevents stalling on files where many components are from private
  // libraries that return 404 for every key.
  let libFileKey: string | undefined;
  for (const [, raw] of entries.slice(0, 3)) {
    const resolveUrl = `https://api.figma.com/v1/components/${raw.key}`;
    const resolveRes = await safeFetch(resolveUrl, { headers: authHeaders });
    if (!resolveRes.ok) continue;
    const resolveJson = (await resolveRes.json()) as { meta?: { file_key?: string } };
    if (resolveJson.meta?.file_key) {
      libFileKey = resolveJson.meta.file_key;
      break;
    }
  }

  if (!libFileKey) {
    Logger.warn(`[buildRichComponentMap] Could not resolve any component key to a library file`);
    // Return what we have — componentSetMap is already populated from rawComponentSets
    return { componentMap: {}, componentSetMap };
  }
  // Fetch all components from the library file (for file_key + node_id resolution)
  const libComponentsUrl = `https://api.figma.com/v1/files/${libFileKey}/components`;
  const libCompRes = await safeFetch(libComponentsUrl, { headers: authHeaders });

  const libCompJson = libCompRes.ok
    ? ((await libCompRes.json()) as {
        meta?: {
          components?: Array<{
            key: string;
            file_key: string;
            node_id: string;
            name: string;
            description?: string;
          }>;
        };
      })
    : null;

  // Build lookup: public key → library component metadata
  const libByKey = new Map<
    string,
    { file_key: string; node_id: string; name: string; description?: string }
  >();
  for (const comp of libCompJson?.meta?.components ?? []) {
    libByKey.set(comp.key, comp);
  }

  // Cross-reference rawComponents (keyed by local node ID) with library data (by public key)
  const componentMap: Record<string, RichComponentMeta> = {};
  for (const [localNodeId, raw] of entries) {
    const lib = libByKey.get(raw.key);
    if (!lib) continue;
    componentMap[localNodeId] = {
      key: raw.key,
      file_key: lib.file_key,
      node_id: lib.node_id,
      name: raw.name,
      ...(raw.componentSetId ? { componentSetId: raw.componentSetId } : {}),
      ...(lib.description ? { description: lib.description } : {}),
    };
  }
  return { componentMap, componentSetMap };
}

/**
 * Main entry point: fetches a Figma node tree and returns a normalized MCP response
 * with layout, styling, and Flexbox primitives.
 *
 * Two-pass enrichment:
 *   Pass 1 — buildNormalizedGraph produces the filtered tree and a definitions dict
 *             containing only the component IDs that survived visibility filtering.
 *   Pass 2 — The surviving component IDs are fetched from their source library files
 *             (batched by file_key, one request per library) and reduced into full
 *             layout/style/children trees that are merged back into definitions.
 */
export async function generateMCPResponse(opts: MCPOptions): Promise<MCPResponse> {
  const {
    fileKey,
    authHeaders,
    rootNodeId,
    styleMap = {},
    cacheTTL = 5 * 60 * 1000,
    resolveVariables = true,
  } = opts;

  const cacheKey = `MCP:${fileKey}:${rootNodeId}`;
  const cached = getCache<MCPResponse>(cacheKey);
  if (cached) return cached;

  const rootNodeData = await fetchNodesBatch(fileKey, [rootNodeId], authHeaders);
  const rootNode = rootNodeData[rootNodeId];
  if (!rootNode) {
    throw new Error(`Root node ${rootNodeId} not found`);
  }

  // Build component maps — use injected maps (test seam) or resolve from root node entry.
  // The /nodes response embeds a components dict keyed by local node ID with public keys
  // but without file_key/node_id; buildRichComponentMap resolves those via 2 API calls.
  let componentMap: Record<string, RichComponentMeta>;
  let componentSetMap: Record<string, { name: string }>;

  if (opts.componentMap !== undefined) {
    componentMap = opts.componentMap;
    componentSetMap = opts.componentSetMap ?? {};
  } else {
    const rawComponents = (rootNode as Record<string, unknown>).components as
      | Record<string, { key: string; name: string; componentSetId?: string; remote?: boolean }>
      | undefined;
    const rawComponentSets = (rootNode as Record<string, unknown>).componentSets as
      | Record<string, { name: string }>
      | undefined;
    ({ componentMap, componentSetMap } = await buildRichComponentMap(
      rawComponents ?? {},
      rawComponentSets ?? {},
      authHeaders,
    ));
  }

  let variableContext = null;
  if (resolveVariables) {
    try {
      const variablesResponse = await fetchVariables(fileKey, authHeaders);
      if (
        variablesResponse &&
        variablesResponse.meta.variables &&
        Object.keys(variablesResponse.meta.variables).length > 0
      ) {
        variableContext = buildResolutionContext(variablesResponse);
        Logger.log(
          `[Variable Resolution] Built context with ${variableContext.variableValues.size} resolved variables`,
        );
      } else {
        Logger.log("[Variable Resolution] No variables found in response");
      }
    } catch (error) {
      Logger.warn(`Failed to fetch variables for ${fileKey}:`, error);
    }
  }

  // Pass 1 — build the filtered normalized tree
  const normalized = buildNormalizedGraph(rootNode, styleMap, variableContext, componentMap);

  // Enrich definitions if any INSTANCE nodes survived filtering
  if (normalized.definitions && Object.keys(normalized.definitions).length > 0) {
    await enrichDefinitions(
      normalized,
      componentMap,
      componentSetMap,
      authHeaders,
      variableContext,
    );
  }

  setCache(cacheKey, normalized, cacheTTL);

  return normalized;
}

/**
 * Walks the reduced consumer-file tree and returns a map of componentId → first
 * INSTANCE node that references it. Used to seed definitions with layout/style/children
 * when the source library file is inaccessible (e.g. 403).
 */
function collectInstancesByComponentId(node: V3Node): Map<string, V3Node> {
  const map = new Map<string, V3Node>();
  function walk(n: V3Node): void {
    if (n.component && !map.has(n.component)) map.set(n.component, n);
    for (const child of n.children ?? []) walk(child);
  }
  walk(node);
  return map;
}

/**
 * Pass 2 — enriches the definitions dict in-place with:
 *   - Phase 0: layout/style/children from the first matching INSTANCE in the consumer
 *              tree (zero extra API calls; always available; used as fallback)
 *   - Phase 1: variantName, componentSetName, and corrected name (no API calls)
 *   - Phase 2: full layout/style/children from the component's authoritative source node
 *              in the library file, plus sibling variants from the same component set.
 *              Overrides Phase 0 data when accessible. Skipped gracefully on 403.
 *
 * Groups all required node IDs by their source file_key so each library only
 * needs a single batched request regardless of how many components come from it.
 */
async function enrichDefinitions(
  normalized: MCPResponse,
  componentMap: Record<string, RichComponentMeta>,
  componentSetMap: Record<string, { name: string }>,
  authHeaders: Record<string, string>,
  variableContext: ReturnType<typeof buildResolutionContext> | null,
): Promise<void> {
  const definitions = normalized.definitions!;

  // Phase 0 — seed layout/style from the first consumer-file instance of each component.
  // This is always available without API calls and ensures definitions carry structural
  // information even when the source library file denies access in Phase 2.
  // Children are intentionally excluded: they contain instance-specific overrides
  // (e.g. actual link text), not canonical component defaults, so including them would
  // mislead an LLM and duplicate large subtrees. Children are only written in Phase 2
  // when fetched from the authoritative library source node.
  const instancesByComponentId = collectInstancesByComponentId(normalized.root);
  for (const [componentId, def] of Object.entries(definitions)) {
    const instance = instancesByComponentId.get(componentId);
    if (!instance) continue;
    if (instance.layout) def.layout = instance.layout;
    if (instance.style) def.style = instance.style;
  }

  // Phase 1 — set metadata from already-fetched maps (no API calls).
  // Corrects def.name to the human-readable component set name (e.g. "Link") rather
  // than the variant property string (e.g. "state=default, color=primary, version=v1").
  for (const [componentId, def] of Object.entries(definitions)) {
    const meta = componentMap[componentId];
    if (!meta) continue;

    def.variantName = meta.name;
    def.props = parseVariantProps(meta.name);

    if (meta.componentSetId) {
      const setMeta = componentSetMap[meta.componentSetId];
      if (setMeta) def.componentSetName = setMeta.name;
    }

    // Use the component set name as the primary name when available; it is more
    // meaningful to an LLM than the raw variant property string.
    def.name = def.componentSetName ?? def.variantName ?? def.name;
  }

  // Phase 2 — collect node IDs to fetch, grouped by source file_key.
  // Include not just the directly-referenced variants but all sibling variants
  // from the same component sets, so the variants dict can be fully populated.
  const usedSetIds = new Set<string>();
  for (const componentId of Object.keys(definitions)) {
    const meta = componentMap[componentId];
    if (meta?.componentSetId) usedSetIds.add(meta.componentSetId);
  }

  // toFetch: file_key → Set of node_ids to retrieve from that file
  const toFetch = new Map<string, Set<string>>();
  for (const meta of Object.values(componentMap)) {
    if (!meta.file_key || !meta.node_id) continue;
    // Include if directly in definitions OR a sibling of one that is
    const isDirect = meta.node_id in definitions;
    const isSibling = meta.componentSetId !== undefined && usedSetIds.has(meta.componentSetId);
    if (!isDirect && !isSibling) continue;

    if (!toFetch.has(meta.file_key)) toFetch.set(meta.file_key, new Set());
    toFetch.get(meta.file_key)!.add(meta.node_id);
  }

  if (toFetch.size > 0) {
    // One batched request per source library file, all in parallel.
    // Gracefully skip files that return 403 (no edit access) — Phase 0+1 data is
    // already written; only authoritative source-node layout and sibling variants
    // will be absent.
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

    // Flatten into node_id → raw node entry
    const fetchedNodes = new Map<string, Record<string, unknown>>();
    for (const { result } of fetchResults) {
      for (const [nodeId, nodeEntry] of Object.entries(result)) {
        fetchedNodes.set(nodeId, nodeEntry as Record<string, unknown>);
      }
    }

    // Reduce each fetched node reusing the existing reducer.
    // Pass the per-node components/componentSets maps through so nested instance
    // names resolve correctly inside component definitions.
    const reducedNodes = new Map<string, ReturnType<typeof buildNormalizedGraph>["root"]>();
    for (const [nodeId, nodeEntry] of fetchedNodes.entries()) {
      const nestedComponentMap = (nodeEntry.components ?? {}) as Record<string, RichComponentMeta>;
      const reduced = buildNormalizedGraph(nodeEntry, {}, variableContext, nestedComponentMap);
      reducedNodes.set(nodeId, reduced.root);
    }

    // Override Phase 0 data with authoritative source-node layout/style/children
    for (const [componentId, def] of Object.entries(definitions)) {
      const meta = componentMap[componentId];
      if (!meta?.node_id) continue;

      const node = reducedNodes.get(meta.node_id);
      if (!node) continue;

      if (node.layout) def.layout = node.layout;
      if (node.style) def.style = node.style;
      if (node.children) def.children = node.children;
    }

    // Populate variants for each definition that belongs to a component set
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

  // Phase 3 — convert definitions to componentSets and patch tree INSTANCE nodes.
  // Runs unconditionally so definitions are always cleaned up, even when
  // component library access was denied or componentMap is empty.
  normalized.componentSets = buildComponentSets(definitions, componentMap);
  patchTreeInstances(normalized.root, definitions, componentMap);
  delete normalized.definitions;
}

// ── Phase 3 helpers ───────────────────────────────────────────────────────────

/**
 * Converts the flat definitions dict into a componentSets dict.
 *
 * Groups definitions by componentSetName (or the component name for singletons),
 * computes base styles (values shared across ALL variants in a set), and stores
 * only the per-variant overrides — the delta against the base.
 */
function buildComponentSets(
  definitions: Record<string, ComponentDefinition>,
  componentMap: Record<string, RichComponentMeta>,
): Record<string, ComponentSet> {
  // Group component IDs by their set name
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

/**
 * Collects the primary definition plus all its sibling variants into a flat list.
 * For sets with multiple definitions (multiple directly-used variants from same set),
 * deduplicates by componentId.
 */
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

    // Include sibling variants from this definition
    for (const [variantId, variant] of Object.entries(def.variants ?? {})) {
      if (!seen.has(variantId)) {
        seen.add(variantId);
        members.push({ componentId: variantId, def, variant });
      }
    }
  }

  return members;
}

/**
 * Computes the base styles by finding layout/style values that are identical
 * across ALL members. Only serialisation-equal values are promoted to base.
 *
 * Children are included in base only when all members share the same children
 * (identical JSON) — rare but correct.
 */
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

/**
 * Returns an object containing only the key-value pairs whose serialised value
 * is identical across all input objects. Returns undefined when no common keys exist
 * or when the input array is empty.
 */
function intersectObjects(
  objects: Array<Record<string, unknown> | undefined>,
): Record<string, unknown> | undefined {
  const defined = objects.filter((o): o is Record<string, unknown> => o !== undefined);
  if (defined.length === 0) return undefined;

  // Start with all keys from the first object, then narrow down
  const first = defined[0];
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(first)) {
    const serialised = JSON.stringify(value);
    const allMatch = defined.every((obj) => JSON.stringify(obj[key]) === serialised);
    if (allMatch) result[key] = value;
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Returns true when all elements of the array serialise identically.
 */
function allEqual<T>(items: Array<T | undefined>): boolean {
  if (items.length === 0) return false;
  const first = JSON.stringify(items[0]);
  return items.every((item) => JSON.stringify(item) === first);
}

/**
 * Collects all unique prop dimension keys across members.
 * E.g. members with props { variant, size } and { variant, state } → ["variant", "size", "state"]
 */
function extractPropKeys(members: VariantMember[]): string[] {
  const keySet = new Set<string>();
  for (const { def, variant } of members) {
    const props = variant?.props ?? def.props ?? {};
    for (const key of Object.keys(props)) keySet.add(key);
  }
  return [...keySet].sort();
}

/**
 * Builds the per-variant overrides: only the fields that differ from base are kept.
 * Keyed by component node ID.
 */
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
    const meta = componentMap[componentId];

    const entry: ComponentSet["variants"][string] = {};

    if (props && Object.keys(props).length > 0) entry.props = props;
    if (description) entry.description = description;

    const layoutOverride = diffObjects(layout, base.layout) as Layout | undefined;
    const styleOverride = diffObjects(style, base.style) as Style | undefined;

    if (layoutOverride) entry.layout = layoutOverride;
    if (styleOverride) entry.style = styleOverride;

    // Children: only include when different from base
    if (!allEqual([children, base.children])) {
      if (children) entry.children = children;
    }

    // Always emit the entry even if it only has props (identifies the variant)
    void meta;
    variants[componentId] = entry;
  }

  return variants;
}

/**
 * Returns an object containing only the key-value pairs in `obj` that differ
 * from the corresponding values in `base`. Returns undefined if there are no
 * differences or if obj is undefined.
 */
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

/**
 * Walks the V3Node tree and updates every INSTANCE node:
 * - Sets node.component to the human-readable component set name
 * - Sets node.props to the parsed variant props for that specific instance
 */
function patchTreeInstances(
  node: V3Node,
  definitions: Record<string, ComponentDefinition>,
  componentMap: Record<string, RichComponentMeta>,
): void {
  if (node.component) {
    const componentId = node.component;
    const def = definitions[componentId];
    const meta = componentMap[componentId];

    if (def) {
      node.component = def.componentSetName ?? def.name;
    }

    // Resolve the specific instance's variant props from its componentId in componentMap
    if (meta) {
      const instanceProps = parseVariantProps(meta.name);
      if (Object.keys(instanceProps).length > 0) node.props = instanceProps;
    }
  }

  for (const child of node.children ?? []) {
    patchTreeInstances(child, definitions, componentMap);
  }
}

/**
 * Fetches all styles for a Figma file.
 */
export async function fetchStyles(
  fileKey: string,
  authHeaders: Record<string, string>,
): Promise<Record<string, unknown>> {
  const url = `https://api.figma.com/v1/files/${fileKey}/styles`;
  const res = await safeFetch(url, {
    headers: authHeaders,
  });

  if (!res.ok) {
    throw new Error(`Figma API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { meta?: { styles?: Array<{ key: string }> } };
  const stylesMap: Record<string, unknown> = {};

  for (const style of json.meta?.styles ?? []) {
    stylesMap[style.key] = style;
  }

  return stylesMap;
}

/**
 * Fetches all published components for a Figma file.
 *
 * Preserves file_key, node_id, and componentSetId from the API response so
 * callers can later fetch component node trees without extra resolution calls.
 */
export async function fetchComponents(
  fileKey: string,
  authHeaders: Record<string, string>,
): Promise<Record<string, RichComponentMeta>> {
  const url = `https://api.figma.com/v1/files/${fileKey}/components`;
  const res = await safeFetch(url, {
    headers: authHeaders,
  });

  if (!res.ok) {
    throw new Error(`Figma API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as {
    meta?: {
      components?: Array<{
        node_id: string;
        key: string;
        file_key: string;
        name: string;
        description?: string;
        component_set_id?: string;
      }>;
    };
  };

  const componentMap: Record<string, RichComponentMeta> = {};

  for (const comp of json.meta?.components ?? []) {
    componentMap[comp.node_id] = {
      key: comp.key,
      file_key: comp.file_key,
      node_id: comp.node_id,
      name: comp.name,
      ...(comp.description ? { description: comp.description } : {}),
      ...(comp.component_set_id ? { componentSetId: comp.component_set_id } : {}),
    };
  }

  return componentMap;
}

/**
 * Fetches all local variables for a Figma file.
 */
export async function fetchVariables(
  fileKey: string,
  authHeaders: Record<string, string>,
): Promise<GetLocalVariablesResponse | null> {
  const url = `https://api.figma.com/v1/files/${fileKey}/variables/local`;
  const res = await safeFetch(url, {
    headers: authHeaders,
  });

  if (!res.ok) {
    // Variables endpoint might fail if the file has no variables or permissions issue
    Logger.warn(`Failed to fetch variables: ${res.status} ${res.statusText}`);
    return null;
  }

  const json = await res.json();
  return json as GetLocalVariablesResponse;
}

// Re-export types
export type {
  MCPResponse,
  V3Node,
  Layout,
  Style,
  Paint,
  GradientStop,
  ComponentDefinition,
  ComponentVariant,
  ComponentSet,
} from "./types";
