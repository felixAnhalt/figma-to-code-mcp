import { fetchNodesBatch } from "../batchFetch";
import { buildNormalizedGraph, flushAllPendingVectorSvgs } from "../reducer";
import { buildResolutionContext } from "../variableResolver";
import { fetchVariables } from "../fetch";
import { getCache, setCache } from "../cache";
import { Logger } from "~/utils/logger";
import type { RichComponentMeta, MCPOptions } from "./types";
import type { MCPResponse } from "../types";
import { buildRichComponentMap } from "./componentMap";
import { enrichDefinitions } from "./enrich";

export async function generateMCPResponse(opts: MCPOptions): Promise<MCPResponse> {
  const {
    fileKey,
    authHeaders,
    rootNodeId,
    styleMap = {},
    cacheTTL = 5 * 60 * 1000,
    resolveVariables = true,
    svgOutputDir,
  } = opts;

  const cacheKey = `MCP:${fileKey}:${rootNodeId}`;
  const cached = getCache<MCPResponse>(cacheKey);
  if (cached) return cached;

  const rootNodeData = await fetchNodesBatch(fileKey, [rootNodeId], authHeaders);
  const rootNode = rootNodeData[rootNodeId];
  if (!rootNode) {
    throw new Error(`Root node ${rootNodeId} not found`);
  }

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

  // flushVectorSvgs is intentionally unused - actual flushing happens via flushAllPendingVectorSvgs() below
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { flushVectorSvgs, ...normalized } = buildNormalizedGraph(
    rootNode,
    styleMap,
    variableContext,
    componentMap,
    fileKey,
  );

  if (normalized.definitions && Object.keys(normalized.definitions).length > 0) {
    await enrichDefinitions(
      normalized,
      componentMap,
      componentSetMap,
      authHeaders,
      variableContext,
    );
  }

  const outputDir = svgOutputDir || "";
  await flushAllPendingVectorSvgs(outputDir);

  if (outputDir) {
    normalized.svgAssetsFolder = outputDir;
  }

  setCache(cacheKey, normalized, cacheTTL);

  return normalized;
}

export type { RichComponentMeta, MCPOptions } from "./types";
