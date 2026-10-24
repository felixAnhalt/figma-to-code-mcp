import { httpClientRaw } from "~/utils/httpClient";
import { Logger } from "~/utils/logger";
import type { RichComponentMeta } from "./types";

type RawComponent = {
  key: string;
  name: string;
  componentSetId?: string;
  remote?: boolean;
};
type SetMetadata = Record<string, { name: string }>;
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

export async function buildRichComponentMap(
  rawComponents: Record<string, RawComponent>,
  rawComponentSets: SetMetadata,
  authHeaders: Record<string, string>,
) {
  const componentSetMap = { ...rawComponentSets };
  const resolved = await resolveComponentKeys(Object.values(rawComponents), authHeaders);
  const published = await fetchReferencedLibraries(resolved, authHeaders);
  const byKey = new Map(resolved);
  for (const source of published) {
    if (source.key) byKey.set(source.key, { ...byKey.get(source.key), ...source });
  }
  const componentMap = mapLocalComponents(rawComponents, byKey, componentSetMap);
  addPublishedSiblings(componentMap, published, componentSetMap);
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

async function resolveComponentKeys(raw: RawComponent[], authHeaders: Record<string, string>) {
  const keys = [...new Set(raw.map((component) => component.key).filter(Boolean))];
  const entries = await Promise.all(
    keys.map(async (key) => {
      const response = await fetchOptionalMetadata<{ meta?: PublishedComponent }>(
        `/components/${key}`,
        authHeaders,
      );
      return [key, response?.meta] as const;
    }),
  );
  return new Map(entries);
}

async function fetchReferencedLibraries(
  resolved: Map<string, PublishedComponent | undefined>,
  authHeaders: Record<string, string>,
) {
  const files = new Set([...resolved.values()].map((source) => source?.file_key).filter(Boolean));
  const responses = await Promise.all(
    [...files].map((file) =>
      fetchOptionalMetadata<{ meta?: { components?: PublishedComponent[] } }>(
        `/files/${file}/components`,
        authHeaders,
      ),
    ),
  );
  return responses.flatMap((response) => response?.meta?.components ?? []);
}

function publishedSet(source?: PublishedComponent) {
  return (
    source?.containing_frame?.containingComponentSet ??
    source?.containing_frame?.containingStateGroup
  );
}

function richMetadata(
  localId: string,
  raw: RawComponent,
  source?: PublishedComponent,
): RichComponentMeta {
  const componentSetId = publishedSet(source)?.nodeId ?? raw.componentSetId;
  return {
    key: raw.key,
    file_key: source?.node_id ? (source.file_key ?? "") : "",
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
) {
  const componentMap: Record<string, RichComponentMeta> = {};
  for (const [localId, raw] of Object.entries(rawComponents)) {
    const source = byKey.get(raw.key);
    const meta = richMetadata(localId, raw, source);
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
    if (name) componentSetMap[componentSetIdentity(meta)] = { name };
  }
}
