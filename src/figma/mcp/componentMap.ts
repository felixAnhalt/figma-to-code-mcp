import { safeFetch } from "../rateLimit";
import type { RichComponentMeta } from "./types";

export async function buildRichComponentMap(
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

  const componentSetMap: Record<string, { name: string }> = {};
  for (const [nodeId, set] of Object.entries(rawComponentSets)) {
    componentSetMap[nodeId] = { name: set.name };
  }

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
    return { componentMap: {}, componentSetMap };
  }

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

  const libByKey = new Map<
    string,
    { file_key: string; node_id: string; name: string; description?: string }
  >();
  for (const comp of libCompJson?.meta?.components ?? []) {
    libByKey.set(comp.key, comp);
  }

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
