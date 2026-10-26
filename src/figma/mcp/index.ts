import { fetchNodesBatch } from "../batchFetch";
import { buildNormalizedGraph } from "../reducer";
import { prepareVectorAssets, type PendingVectorWriteInput } from "../reducer/flush";
import { materializeSvgAssets } from "../svg/assets";
import { getDesignCacheKey, type CachedDesign } from "./cache";
import { buildResolutionContext, mergeResolutionContext } from "../variableResolver";
import type { VariableResolutionContext } from "../variableResolver";
import { fetchVariables, fetchComments } from "../fetch";
import { getCache, setCache } from "../cache";
import { Logger } from "~/utils/logger";
import type { MCPOptions } from "./types";
import type { MCPResponse, VariableResolutionReport } from "../types";
import { buildRichComponentMap } from "./componentMap";
import { enrichDefinitions } from "./enrich";
import { transformComments, type NodeCommentsMap } from "../transform/comments";

const MAX_UNRESOLVED_VARIABLE_SAMPLE_SIZE = 10;
const DEFAULT_DESIGN_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_INCLUDE_COMPONENT_VARIANTS = false;
type RootNode = NonNullable<Awaited<ReturnType<typeof fetchNodesBatch>>[string]>;

export async function generateMCPResponse(opts: MCPOptions): Promise<MCPResponse> {
  const ttl = opts.cacheTTL ?? DEFAULT_DESIGN_CACHE_TTL_MS;
  const cacheKey = getDesignCacheKey(opts);
  let artifact = ttl > 0 ? getCache<CachedDesign>(cacheKey) : null;
  if (!artifact) {
    artifact = await buildDesignArtifact(opts);
    if (ttl > 0) setCache(cacheKey, structuredClone(artifact), ttl);
  }
  const response = structuredClone(artifact.response);
  const outputDir = opts.svgOutputDir || "";
  await materializeSvgAssets(artifact.assets, outputDir);
  if (outputDir) response.svgAssetsFolder = outputDir;
  return response;
}

async function buildDesignArtifact(opts: MCPOptions): Promise<CachedDesign> {
  const rootNode = await fetchRootNode(opts);
  const { componentMap, componentSetMap } = await resolveComponentMetadata(rootNode, opts);
  const variableContext = await resolveVariableContext(opts);
  const commentsMap = await fetchNodeComments(opts);
  const pendingVectors: PendingVectorWriteInput[] = [];
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { flushVectorSvgs, ...normalized } = buildNormalizedGraph(
    rootNode,
    opts.styleMap ?? {},
    variableContext,
    componentMap,
    opts.fileKey,
    commentsMap,
    pendingVectors,
  );

  if (normalized.definitions && Object.keys(normalized.definitions).length > 0) {
    await enrichDefinitions(
      normalized,
      componentMap,
      componentSetMap,
      opts.authHeaders,
      variableContext,
      pendingVectors,
      includeComponentVariants(opts),
    );
  }

  attachVariableResolutionReport(normalized);
  return { response: normalized, assets: prepareVectorAssets(pendingVectors) };
}

async function fetchRootNode(opts: MCPOptions): Promise<RootNode> {
  const nodes = await fetchNodesBatch(opts.fileKey, [opts.rootNodeId], opts.authHeaders);
  const rootNode = nodes[opts.rootNodeId];
  if (!rootNode) throw new Error(`Root node ${opts.rootNodeId} not found`);
  return rootNode;
}

async function resolveComponentMetadata(rootNode: RootNode, opts: MCPOptions) {
  if (opts.componentMap !== undefined) {
    return { componentMap: opts.componentMap, componentSetMap: opts.componentSetMap ?? {} };
  }
  return buildRichComponentMap(
    rootNode.components ?? {},
    rootNode.componentSets ?? {},
    opts.authHeaders,
    {
      localFileKey: opts.fileKey,
      includeComponentVariants: includeComponentVariants(opts),
    },
  );
}

function includeComponentVariants(opts: MCPOptions): boolean {
  return opts.includeComponentVariants ?? DEFAULT_INCLUDE_COMPONENT_VARIANTS;
}

async function resolveVariableContext(opts: MCPOptions): Promise<VariableResolutionContext | null> {
  if (opts.resolveVariables === false) return null;
  const local = await fetchLocalVariableContext(opts);
  const preloaded = opts.preloadedVariableContext;
  if (!preloaded) return local;
  if (!local) return structuredClone(preloaded);
  mergeResolutionContext(local, preloaded);
  return local;
}

async function fetchLocalVariableContext(
  opts: MCPOptions,
): Promise<VariableResolutionContext | null> {
  try {
    const response = await fetchVariables(opts.fileKey, opts.authHeaders);
    if (!response?.meta.variables || Object.keys(response.meta.variables).length === 0) return null;
    return buildResolutionContext(response);
  } catch (error) {
    Logger.warn(`Failed to fetch variables for ${opts.fileKey}:`, error);
    return null;
  }
}

async function fetchNodeComments(opts: MCPOptions): Promise<NodeCommentsMap> {
  const comments = await fetchComments(opts.fileKey, opts.authHeaders);
  return transformComments(comments);
}

function attachVariableResolutionReport(response: MCPResponse): void {
  const report = buildVariableResolutionReport(response);
  if (report.unresolvedVariableAliasCount > 0) {
    response.resolutionReport = report;
    Logger.warn(
      `[Variable Resolution] Unresolved aliases: ${report.unresolvedVariableAliasCount} (sample: ${report.unresolvedVariableAliasIds.join(", ")})`,
    );
  }
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
