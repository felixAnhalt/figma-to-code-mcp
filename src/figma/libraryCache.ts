/**
 * Library Variable Cache
 *
 * Persists the merged VariableResolutionContext for prefetched library files
 * to disk so subsequent server restarts can skip re-fetching from the Figma API.
 *
 * Cache format (JSON):
 * {
 *   "fileKeys": ["abc123", "def456"],   // sorted, for key-set comparison
 *   "fetchedAt": 1234567890123,          // Unix ms timestamp
 *   "variableValues": [[id, value], ...],
 *   "activeModes": [[collectionId, modeId], ...],
 *   "variableNames": [[id, name], ...]
 * }
 *
 * Invalidation rules (checked in order):
 *   1. forceRefresh flag → always re-fetch
 *   2. File keys changed → re-fetch
 *   3. fetchedAt + ttlMs < now → re-fetch
 *   4. Otherwise → use cached context
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { Logger } from "~/utils/logger";
import type { VariableResolutionContext, VariableValue } from "./variableResolver";

const CACHE_FILE_NAME = "figma-mcp-library-cache.json";

type SerializedContext = {
  fileKeys: string[];
  fetchedAt: number;
  variableValues: [string, VariableValue][];
  activeModes: [string, string][];
  variableNames: [string, string][];
};

export type LibraryCacheOptions = {
  cachePath: string;
  ttlMs: number;
  forceRefresh: boolean;
};

function serializeContext(
  context: VariableResolutionContext,
  fileKeys: string[],
): SerializedContext {
  return {
    fileKeys: [...fileKeys].sort(),
    fetchedAt: Date.now(),
    variableValues: [...context.variableValues.entries()],
    activeModes: [...context.activeModes.entries()],
    variableNames: [...context.variableNames.entries()],
  };
}

function deserializeContext(serialized: SerializedContext): VariableResolutionContext {
  return {
    variableValues: new Map(serialized.variableValues),
    activeModes: new Map(serialized.activeModes),
    variableNames: new Map(serialized.variableNames),
  };
}

function resolveCacheFilePath(cachePath: string): string {
  if (extname(cachePath) === ".json") return cachePath;
  return join(cachePath, CACHE_FILE_NAME);
}

function isSerializedContext(value: unknown): value is SerializedContext {
  if (!value || typeof value !== "object") return false;

  const candidate = value as Record<string, unknown>;
  return (
    Array.isArray(candidate.fileKeys) &&
    typeof candidate.fetchedAt === "number" &&
    Array.isArray(candidate.variableValues) &&
    Array.isArray(candidate.activeModes) &&
    Array.isArray(candidate.variableNames)
  );
}

function fileKeySetMatches(cached: string[], current: string[]): boolean {
  const a = [...cached].sort();
  const b = [...current].sort();
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/**
 * Attempts to load a valid library variable context from the cache file.
 * Returns null if the cache is missing, stale, or has mismatched file keys.
 */
export function readLibraryCache(
  fileKeys: string[],
  opts: LibraryCacheOptions,
): VariableResolutionContext | null {
  const cacheFilePath = resolveCacheFilePath(opts.cachePath);

  if (opts.forceRefresh) {
    Logger.log("[Library Cache] Force refresh requested — skipping cache read");
    return null;
  }

  let raw: string;
  try {
    raw = readFileSync(cacheFilePath, "utf-8");
  } catch {
    Logger.log("[Library Cache] No cache file found at", cacheFilePath);
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isSerializedContext(parsed)) {
      Logger.warn("[Library Cache] Cache file has an unexpected shape — will re-fetch");
      return null;
    }

    if (!fileKeySetMatches(parsed.fileKeys, fileKeys)) {
      Logger.log("[Library Cache] File keys changed — cache invalidated");
      return null;
    }

    const ageMs = Date.now() - parsed.fetchedAt;
    if (ageMs > opts.ttlMs) {
      const ageMin = Math.round(ageMs / 60_000);
      Logger.log(`[Library Cache] Cache expired (age: ${ageMin}min) — will re-fetch`);
      return null;
    }

    const context = deserializeContext(parsed);
    const ageMin = Math.round(ageMs / 60_000);
    Logger.log(
      `[Library Cache] Loaded ${context.variableValues.size} variables from cache (age: ${ageMin}min, path: ${cacheFilePath})`,
    );
    return context;
  } catch {
    Logger.warn("[Library Cache] Cache file is corrupt — will re-fetch");
    return null;
  }
}

/**
 * Persists a library variable context to the cache file.
 * Creates parent directories if needed. Failures are non-fatal (logged as warnings).
 */
export function writeLibraryCache(
  context: VariableResolutionContext,
  fileKeys: string[],
  opts: LibraryCacheOptions,
): void {
  try {
    const cacheFilePath = resolveCacheFilePath(opts.cachePath);
    mkdirSync(dirname(cacheFilePath), { recursive: true });
    const serialized = serializeContext(context, fileKeys);
    writeFileSync(cacheFilePath, JSON.stringify(serialized, null, 2), "utf-8");
    Logger.log(
      `[Library Cache] Saved ${context.variableValues.size} variables to cache (path: ${cacheFilePath})`,
    );
  } catch (error) {
    Logger.warn(
      "[Library Cache] Failed to write cache file:",
      error instanceof Error ? error.message : String(error),
    );
  }
}
