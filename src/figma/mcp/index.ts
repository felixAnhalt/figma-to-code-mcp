import { fetchNodesBatch } from "../batchFetch";
import { buildNormalizedGraph, flushAllPendingVectorSvgs } from "../reducer";
import { buildResolutionContext, mergeResolutionContext } from "../variableResolver";
import { fetchVariables, fetchComments } from "../fetch";
import { getCache, setCache } from "../cache";
import { Logger } from "~/utils/logger";
import type { RichComponentMeta, MCPOptions } from "./types";
import type { MCPResponse, VariableResolutionReport } from "../types";
import { buildRichComponentMap } from "./componentMap";
import { enrichDefinitions } from "./enrich";
import { transformComments, type NodeCommentsMap } from "../transform/comments";

const MAX_UNRESOLVED_VARIABLE_SAMPLE_SIZE = 10;

export async function generateMCPResponse(opts: MCPOptions): Promise<MCPResponse> {
  const {
    fileKey,
    authHeaders,
    rootNodeId,
    styleMap = {},
    cacheTTL = 5 * 60 * 1000,
    resolveVariables = true,
    svgOutputDir,
    preloadedVariableContext = null,
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

    // Merge preloaded library context — file-local entries win, library fills gaps
    if (preloadedVariableContext) {
      if (variableContext) {
        mergeResolutionContext(variableContext, preloadedVariableContext);
        Logger.log(
          `[Variable Resolution] Merged preloaded library context (${preloadedVariableContext.variableValues.size} entries)`,
        );
      } else {
        variableContext = preloadedVariableContext;
        Logger.log(
          `[Variable Resolution] Using preloaded library context (${preloadedVariableContext.variableValues.size} entries)`,
        );
      }
    }
  }

  Logger.log("Fetching comments...");
  const rawComments = await fetchComments(fileKey, authHeaders);
  const commentsMap: NodeCommentsMap = transformComments(rawComments);
  const nodesWithComments = Object.keys(commentsMap).length;
  Logger.log(`[Comments] Found ${nodesWithComments} nodes with comments`);

  // flushVectorSvgs is intentionally unused - actual flushing happens via flushAllPendingVectorSvgs() below
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { flushVectorSvgs, ...normalized } = buildNormalizedGraph(
    rootNode,
    styleMap,
    variableContext,
    componentMap,
    fileKey,
    commentsMap,
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

  const resolutionReport = buildVariableResolutionReport(normalized);
  if (resolutionReport.unresolvedVariableAliasCount > 0) {
    normalized.resolutionReport = resolutionReport;
    Logger.warn(
      `[Variable Resolution] Unresolved aliases: ${resolutionReport.unresolvedVariableAliasCount} (sample: ${resolutionReport.unresolvedVariableAliasIds.join(", ")})`,
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

function buildVariableResolutionReport(response: MCPResponse): VariableResolutionReport {
  const sampleIds = new Set<string>();
  const unresolvedCount = collectVariableAliasCount(response, sampleIds);
  return {
    unresolvedVariableAliasCount: unresolvedCount,
    unresolvedVariableAliasIds: [...sampleIds].slice(0, MAX_UNRESOLVED_VARIABLE_SAMPLE_SIZE),
  };
}

function collectVariableAliasCount(value: unknown, sampleIds: Set<string>): number {
  if (Array.isArray(value)) {
    let count = 0;
    for (const item of value) {
      count += collectVariableAliasCount(item, sampleIds);
    }
    return count;
  }

  if (!value || typeof value !== "object") return 0;

  const record = value as Record<string, unknown>;
  if (record.type === "VARIABLE_ALIAS" && typeof record.id === "string") {
    if (sampleIds.size < MAX_UNRESOLVED_VARIABLE_SAMPLE_SIZE) {
      sampleIds.add(record.id);
    }
    return 1;
  }

  let count = 0;
  for (const child of Object.values(record)) {
    count += collectVariableAliasCount(child, sampleIds);
  }
  return count;
}

export type { RichComponentMeta, MCPOptions } from "./types";
