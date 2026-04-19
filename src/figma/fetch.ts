import type { GetLocalVariablesResponse } from "@figma/rest-api-spec";
import { httpClient } from "~/utils/http-client";
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

  const json = await httpClient<{ meta?: { styles?: Array<{ key: string }> } }>(url, {
    headers: authHeaders,
    skipCurlFallback: true,
  });

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

  const json = await httpClient<{
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
  }>(url, {
    headers: authHeaders,
    skipCurlFallback: true,
  });

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

  try {
    const json = await httpClient<GetLocalVariablesResponse>(url, {
      headers: authHeaders,
      skipCurlFallback: true,
    });
    return json;
  } catch (error) {
    Logger.warn(`Failed to fetch variables:`, error);
    return null;
  }
}

export async function fetchComments(
  fileKey: string,
  authHeaders: Record<string, string>,
): Promise<FigmaComment[]> {
  const url = `https://api.figma.com/v1/files/${fileKey}/comments`;

  try {
    const json = await httpClient<{ comments: FigmaComment[] }>(url, {
      headers: authHeaders,
      skipCurlFallback: true,
    });
    return json.comments ?? [];
  } catch (error) {
    Logger.warn(`Failed to fetch comments:`, error);
    return [];
  }
}
