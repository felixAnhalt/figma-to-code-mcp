import { createHash } from "node:crypto";
import type { MCPResponse } from "../types";
import type { SvgAsset } from "../svg/assets";
import type { MCPOptions } from "./types";

export type CachedDesign = {
  response: MCPResponse;
  assets: SvgAsset[];
  renderedImageUrl: string | null;
};

export function getDesignCacheKey(options: MCPOptions): string {
  const inputs = {
    fileKey: options.fileKey,
    rootNodeId: options.rootNodeId,
    authHeaders: options.authHeaders,
    resolveVariables: options.resolveVariables ?? true,
    includeComponentVariants: options.includeComponentVariants ?? false,
    renderedImage: options.fetchRenderedImageUrl !== undefined,
    styleMap: options.styleMap ?? {},
    componentMap: options.componentMap,
    componentSetMap: options.componentSetMap,
    preloadedVariableContext: options.preloadedVariableContext ?? null,
  };
  const digest = createHash("sha256")
    .update(JSON.stringify(canonicalize(inputs)))
    .digest("hex");
  return `MCP:${digest}`;
}

function canonicalize(value: unknown): unknown {
  if (value instanceof Map) {
    return canonicalize(Object.fromEntries(value));
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}
