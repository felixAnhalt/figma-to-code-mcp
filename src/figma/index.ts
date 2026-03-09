import { fetchNodesBatch } from "./batchFetch.js";
import { safeFetch } from "./rateLimit.js";
import { getCache, setCache } from "./cache.js";
import { buildNormalizedGraph } from "./reducer.js";
import { resolveInstances } from "./instanceResolver.js";
import type { MCPResponse } from "./types.js";

export type MCPOptions = {
  fileKey: string;
  token: string;
  rootNodeId: string;
  componentMap?: Record<string, any>;
  styleMap?: Record<string, any>;
  cacheTTL?: number;
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
  } = opts;

  // Check cache
  const cacheKey = `MCP:${fileKey}:${rootNodeId}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  // Fetch node data (batched)
  const rootNodeData = await fetchNodesBatch(fileKey, [rootNodeId], token);
  const rootNode = rootNodeData[rootNodeId];
  if (!rootNode) {
    throw new Error(`Root node ${rootNodeId} not found`);
  }

  // Resolve component instances
  resolveInstances(rootNode, componentMap);

  // Build normalized graph (layout + styles + Flex primitives)
  const normalized = buildNormalizedGraph(rootNode, styleMap);

  // Cache result
  setCache(cacheKey, normalized, cacheTTL);

  return normalized;
}

/**
 * Fetches all styles for a Figma file.
 */
export async function fetchStyles(fileKey: string, token: string): Promise<Record<string, any>> {
  const url = `https://api.figma.com/v1/files/${fileKey}/styles`;
  const res = await safeFetch(url, {
    headers: { "X-Figma-Token": token },
  });

  if (!res.ok) {
    throw new Error(`Figma API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const stylesMap: Record<string, any> = {};

  for (const style of json.meta?.styles || []) {
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
): Promise<Record<string, any>> {
  const url = `https://api.figma.com/v1/files/${fileKey}/components`;
  const res = await safeFetch(url, {
    headers: { "X-Figma-Token": token },
  });

  if (!res.ok) {
    throw new Error(`Figma API error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const componentMap: Record<string, any> = {};

  for (const comp of Object.values(json.meta?.components || {})) {
    const c = comp as any;
    componentMap[c.node_id] = c;
  }

  return componentMap;
}

// Re-export types
export type { MCPResponse } from "./types.js";
export { IdMapper } from "./idMapper.js";
