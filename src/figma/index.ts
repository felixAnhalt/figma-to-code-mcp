import { fetchNodesBatch } from "./batchFetch.js";
import { safeFetch } from "./rateLimit.js";
import { getCache, setCache } from "./cache.js";
import { buildNormalizedGraph } from "./reducer.js";
import { buildResolutionContext } from "./variableResolver.js";
import type { MCPResponse, Component } from "./types.js";
import type { GetLocalVariablesResponse } from "@figma/rest-api-spec";

export type MCPOptions = {
  fileKey: string;
  token: string;
  rootNodeId: string;
  componentMap?: Record<string, unknown>;
  styleMap?: Record<string, unknown>;
  cacheTTL?: number;
  resolveVariables?: boolean; // New option to enable variable resolution
};

/**
 * Main entry point: fetches a Figma node tree and returns a normalized MCP response
 * with layout, styling, and Flexbox primitives.
 */
export async function generateMCPResponse(opts: MCPOptions): Promise<MCPResponse> {
  const {
    fileKey,
    token,
    rootNodeId,
    componentMap = {},
    styleMap = {},
    cacheTTL = 5 * 60 * 1000,
    resolveVariables = true, // Default to true for Q2 choice A
  } = opts;

  // Check cache
  const cacheKey = `MCP:${fileKey}:${rootNodeId}`;
  const cached = getCache<MCPResponse>(cacheKey);
  if (cached) return cached;

  // Fetch node data (batched)
  const rootNodeData = await fetchNodesBatch(fileKey, [rootNodeId], token);
  const rootNode = rootNodeData[rootNodeId];
  if (!rootNode) {
    throw new Error(`Root node ${rootNodeId} not found`);
  }

  // Fetch and build variable resolution context if enabled
  let variableContext = null;
  if (resolveVariables) {
    try {
      const variablesResponse = await fetchVariables(fileKey, token);
      if (
        variablesResponse &&
        variablesResponse.meta.variables &&
        Object.keys(variablesResponse.meta.variables).length > 0
      ) {
        variableContext = buildResolutionContext(variablesResponse);
        console.log(
          `[Variable Resolution] Built context with ${variableContext.variableValues.size} resolved variables`,
        );
      } else {
        console.log("[Variable Resolution] No variables found in response");
      }
    } catch (error) {
      // Log warning but don't fail - continue without variable resolution
      console.warn(`Failed to fetch variables for ${fileKey}:`, error);
    }
  }

  // Build normalized graph (layout + styles + Flex primitives)
  const normalized = buildNormalizedGraph(rootNode, styleMap, variableContext, componentMap);

  // Cache result
  setCache(cacheKey, normalized, cacheTTL);

  return normalized;
}

/**
 * Fetches all styles for a Figma file.
 */
export async function fetchStyles(
  fileKey: string,
  token: string,
): Promise<Record<string, unknown>> {
  const url = `https://api.figma.com/v1/files/${fileKey}/styles`;
  const res = await safeFetch(url, {
    headers: { "X-Figma-Token": token },
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
 * Fetches all components for a Figma file.
 */
export async function fetchComponents(
  fileKey: string,
  token: string,
): Promise<Record<string, Component>> {
  const url = `https://api.figma.com/v1/files/${fileKey}/components`;
  const res = await safeFetch(url, {
    headers: { "X-Figma-Token": token },
  });

  if (!res.ok) {
    throw new Error(`Figma API error: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as {
    meta?: {
      components?: Record<
        string,
        { node_id: string; key: string; name: string; description?: string }
      >;
    };
  };
  const componentMap: Record<string, Component> = {};

  for (const comp of Object.values(json.meta?.components ?? {})) {
    componentMap[comp.node_id] = {
      key: comp.key,
      name: comp.name,
      ...(comp.description ? { description: comp.description } : {}),
    };
  }

  return componentMap;
}

/**
 * Fetches all local variables for a Figma file.
 */
export async function fetchVariables(
  fileKey: string,
  token: string,
): Promise<GetLocalVariablesResponse | null> {
  const url = `https://api.figma.com/v1/files/${fileKey}/variables/local`;
  const res = await safeFetch(url, {
    headers: { "X-Figma-Token": token },
  });

  if (!res.ok) {
    // Variables endpoint might fail if the file has no variables or permissions issue
    console.warn(`Failed to fetch variables: ${res.status} ${res.statusText}`);
    return null;
  }

  const json = await res.json();
  return json as GetLocalVariablesResponse;
}

// Re-export types
export type { MCPResponse } from "./types.js";
export { IdMapper } from "./idMapper.js";
