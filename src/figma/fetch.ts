import type { GetLocalVariablesResponse } from "@figma/rest-api-spec";
import { safeFetch } from "./rateLimit";
import type { RichComponentMeta } from "./index";
import { Logger } from "~/utils/logger";

export interface FigmaComment {
  id: string;
  uuid: string;
  file_key: string;
  parent_id: string;
  user: {
    handle: string;
    img_url: string;
    id: string;
  };
  created_at: string;
  resolved_at: string | null;
  message: string;
  reactions: Array<{
    emoji: string;
    created_at: string;
    user: {
      id: string;
      handle: string;
      img_url: string;
    };
  }>;
  client_meta: {
    node_id: string;
    node_offset: { x: number; y: number };
    stable_path: string[];
  } | null;
  order_id: string | null;
}

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

export async function fetchVariables(
  fileKey: string,
  authHeaders: Record<string, string>,
): Promise<GetLocalVariablesResponse | null> {
  const url = `https://api.figma.com/v1/files/${fileKey}/variables/local`;
  const res = await safeFetch(url, {
    headers: authHeaders,
  });

  if (!res.ok) {
    Logger.warn(`Failed to fetch variables: ${res.status} ${res.statusText}`);
    return null;
  }

  const json = await res.json();
  return json as GetLocalVariablesResponse;
}

export async function fetchComments(
  fileKey: string,
  authHeaders: Record<string, string>,
): Promise<FigmaComment[]> {
  const url = `https://api.figma.com/v1/files/${fileKey}/comments`;
  const res = await safeFetch(url, {
    headers: authHeaders,
  });

  if (!res.ok) {
    Logger.warn(`Failed to fetch comments: ${res.status} ${res.statusText}`);
    return [];
  }

  const json = (await res.json()) as { comments: FigmaComment[] };
  return json.comments ?? [];
}
