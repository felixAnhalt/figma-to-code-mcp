import { httpClientRaw } from "~/utils/httpClient";
import { Logger } from "~/utils/logger";
import type { ComponentSetMetadata, RichComponentMeta } from "./types";

type RawComponent = {
  key: string;
  name: string;
  componentSetId?: string;
  remote?: boolean;
};
type SetMetadata = Record<string, ComponentSetMetadata>;
type PublishedSet = { nodeId?: string; name?: string };
type PublishedComponent = {
  key?: string;
  file_key?: string;
  node_id?: string;
  name?: string;
  description?: string;
  containing_frame?: {
    containingComponentSet?: PublishedSet | null;
    containingStateGroup?: PublishedSet | null;
  };
};

const FIGMA_API_ROOT = "https://api.figma.com/v1";

export function componentSourceIdentity(meta: Pick<RichComponentMeta, "file_key" | "node_id">) {
  return JSON.stringify([meta.file_key, meta.node_id]);
}

export function componentSetIdentity(meta: Pick<RichComponentMeta, "file_key" | "componentSetId">) {
  return JSON.stringify([meta.file_key, meta.componentSetId]);
}

export type ComponentMapOptions = {
  localFileKey?: string;
  includeComponentVariants?: boolean;
};

export async function buildRichComponentMap(
  rawComponents: Record<string, RawComponent>,
  rawComponentSets: SetMetadata,
  authHeaders: Record<string, string>,
  { localFileKey = "", includeComponentVariants = true }: ComponentMapOptions = {},
) {
  const componentSetMap = { ...rawComponentSets };
  const { sources, published } = await discoverPublishedSources(
    Object.values(rawComponents),
    authHeaders,
    localFileKey,
  );
  const componentMap = mapLocalComponents(rawComponents, sources, componentSetMap, localFileKey);
  recordSetMemberNames(componentSetMap, [
    ...Object.values(componentMap),
    ...publishedMetadata(published),
  ]);
  if (includeComponentVariants) addPublishedSiblings(componentMap, published, componentSetMap);
  return { componentMap, componentSetMap };
}

async function fetchOptionalMetadata<T>(path: string, authHeaders: Record<string, string>) {
  try {
    const response = await httpClientRaw(`${FIGMA_API_ROOT}${path}`, { headers: authHeaders });
    if (!response.ok) {
      Logger.warn(`[componentMap] Optional metadata unavailable: ${path} (${response.status})`);
      return undefined;
    }
    return (await response.json()) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    Logger.warn(`[componentMap] Skipping optional metadata ${path}: ${message}`);
    return undefined;
  }
}

type PublishedDiscovery = {
  sources: Map<string, PublishedComponent>;
  published: PublishedComponent[];
  listedFiles: Set<string>;
};

async function discoverPublishedSources(
  raw: RawComponent[],
  authHeaders: Record<string, string>,
  localFileKey: string,
): Promise<PublishedDiscovery> {
  const discovery: PublishedDiscovery = {
    sources: new Map(),
    published: [],
    listedFiles: new Set(),
  };
  const localKeys = new Set(
    raw.filter((component) => component.remote === false).map((component) => component.key),
  );
  if (localFileKey && localKeys.size > 0) {
    await listFileComponents(localFileKey, authHeaders, discovery);
  }
  for (const key of new Set(raw.map((component) => component.key).filter(Boolean))) {
    if (discovery.sources.has(key)) continue;
    // A local component missing from this file's own listing is unpublished: nothing to look up.
    if (localFileKey && localKeys.has(key)) continue;
    await discoverComponentSource(key, authHeaders, discovery);
  }
  return discovery;
}

async function discoverComponentSource(
  key: string,
  authHeaders: Record<string, string>,
  discovery: PublishedDiscovery,
) {
  const response = await fetchOptionalMetadata<{ meta?: PublishedComponent }>(
    `/components/${key}`,
    authHeaders,
  );
  const source = response?.meta;
  if (!source) return;
  discovery.sources.set(key, source);
  if (source.file_key) await listFileComponents(source.file_key, authHeaders, discovery);
}

async function listFileComponents(
  fileKey: string,
  authHeaders: Record<string, string>,
  discovery: PublishedDiscovery,
) {
  if (discovery.listedFiles.has(fileKey)) return;
  discovery.listedFiles.add(fileKey);
  for (const item of await fetchPublishedComponents(fileKey, authHeaders)) {
    discovery.published.push(item);
    if (item.key) discovery.sources.set(item.key, { ...discovery.sources.get(item.key), ...item });
  }
}

async function fetchPublishedComponents(
  fileKey: string,
  authHeaders: Record<string, string>,
): Promise<PublishedComponent[]> {
  const response = await fetchOptionalMetadata<{ meta?: { components?: PublishedComponent[] } }>(
    `/files/${fileKey}/components`,
    authHeaders,
  );
  return response?.meta?.components ?? [];
}

/** Records the member names of the sets in the given library files, without adding any bodies. */
export async function recordLibraryMemberNames(
  fileKeys: string[],
  componentSetMap: SetMetadata,
  authHeaders: Record<string, string>,
): Promise<void> {
  for (const fileKey of new Set(fileKeys)) {
    const components = await fetchPublishedComponents(fileKey, authHeaders);
    recordSetMemberNames(componentSetMap, publishedMetadata(components));
  }
}

function publishedSet(source?: PublishedComponent) {
  return (
    source?.containing_frame?.containingComponentSet ??
    source?.containing_frame?.containingStateGroup
  );
}

function ownerFileKey(
  raw: RawComponent,
  source: PublishedComponent | undefined,
  localFileKey: string,
): string {
  if (source?.node_id) return source.file_key ?? "";
  return raw.remote === false ? localFileKey : "";
}

function richMetadata(
  localId: string,
  raw: RawComponent,
  source?: PublishedComponent,
  localFileKey = "",
): RichComponentMeta {
  const componentSetId = publishedSet(source)?.nodeId ?? raw.componentSetId;
  return {
    key: raw.key,
    file_key: ownerFileKey(raw, source, localFileKey),
    node_id: source?.node_id ?? localId,
    name: raw.name,
    ...(componentSetId ? { componentSetId } : {}),
    ...(source?.description ? { description: source.description } : {}),
  };
}

function mapLocalComponents(
  rawComponents: Record<string, RawComponent>,
  byKey: Map<string, PublishedComponent | undefined>,
  componentSetMap: SetMetadata,
  localFileKey: string,
) {
  const componentMap: Record<string, RichComponentMeta> = {};
  for (const [localId, raw] of Object.entries(rawComponents)) {
    const source = byKey.get(raw.key);
    const meta = richMetadata(localId, raw, source, localFileKey);
    componentMap[localId] = meta;
    const name = publishedSet(source)?.name ?? componentSetMap[raw.componentSetId ?? ""]?.name;
    if (meta.componentSetId && name) componentSetMap[componentSetIdentity(meta)] = { name };
  }
  return componentMap;
}

function addPublishedSiblings(
  componentMap: Record<string, RichComponentMeta>,
  published: PublishedComponent[],
  componentSetMap: SetMetadata,
) {
  const referencedSets = new Set(
    Object.values(componentMap)
      .filter((meta) => meta.componentSetId)
      .map(componentSetIdentity),
  );
  const seenSources = new Set(Object.values(componentMap).map(componentSourceIdentity));
  for (const source of published) {
    if (!source.key || !source.file_key || !source.node_id) continue;
    const meta = richMetadata(
      source.node_id,
      { key: source.key, name: source.name ?? source.key },
      source,
    );
    const identity = componentSourceIdentity(meta);
    if (
      !meta.componentSetId ||
      !referencedSets.has(componentSetIdentity(meta)) ||
      seenSources.has(identity)
    )
      continue;
    componentMap[identity] = meta;
    seenSources.add(identity);
    const name = publishedSet(source)?.name;
    const setIdentity = componentSetIdentity(meta);
    if (name) componentSetMap[setIdentity] = { ...componentSetMap[setIdentity], name };
  }
}

function publishedMetadata(published: PublishedComponent[]): RichComponentMeta[] {
  return published.flatMap((source) =>
    source.key && source.file_key && source.node_id
      ? [richMetadata(source.node_id, { key: source.key, name: source.name ?? source.key }, source)]
      : [],
  );
}

function recordSetMemberNames(componentSetMap: SetMetadata, metas: RichComponentMeta[]) {
  const namesByIdentity = new Map<string, Set<string>>();
  for (const meta of metas) {
    if (!meta.componentSetId) continue;
    const identity = componentSetIdentity(meta);
    if (!componentSetMap[identity]) continue;
    const names = namesByIdentity.get(identity) ?? new Set<string>();
    names.add(meta.name);
    namesByIdentity.set(identity, names);
  }
  for (const [identity, names] of namesByIdentity) {
    componentSetMap[identity] = { ...componentSetMap[identity], memberNames: [...names] };
  }
}
