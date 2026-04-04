const SVG_URI_SCHEME = "figma://vector/";

/** In-memory cache of SVG content by URI key (e.g., "fileKey_nodeId") */
const svgContentCache = new Map<string, string>();

/** Returns the number of cached SVGs - useful for debugging */
export function getSvgCacheSize(): number {
  return svgContentCache.size;
}

/** Lists all cached SVG keys - useful for debugging */
export function getCachedSvgKeys(): string[] {
  return Array.from(svgContentCache.keys());
}

/**
 * Builds a minimal valid SVG file from a Figma vector node's geometry.
 * Uses a viewBox derived from the path data bounds (not computed — just unbounded).
 * The LLM/consumer is expected to size the SVG via CSS or explicit attributes.
 */
function buildSvgContent(paths: Array<{ d: string; fillRule?: string }>): string {
  const pathElements = paths
    .map((p) => {
      const fillRuleAttr = p.fillRule ? ` fill-rule="${p.fillRule}"` : "";
      return `  <path d="${p.d}"${fillRuleAttr} />`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" fill="currentColor">\n${pathElements}\n</svg>\n`;
}

/**
 * Stores SVG geometry for a Figma VECTOR node in the in-memory cache.
 *
 * Returns the MCP resource URI (e.g. "figma://vector/fileKey_nodeId") on success,
 * or undefined if the geometry is invalid (callers should skip the vectorPathUri field).
 *
 * The URI key is stable and uniquely identifies this vector node across server lifetime.
 */
export async function writeVectorSvg(
  fileKey: string,
  nodeId: string,
  paths: Array<{ d: string; fillRule?: string }>,
): Promise<string | undefined> {
  try {
    // Guard: need at least one path with valid d attribute
    if (!paths || paths.length === 0 || !paths.some((p) => p.d)) {
      return undefined;
    }
    // Sanitize nodeId (colons → underscores) for safe cache keys
    const safeNodeId = nodeId.replace(/[:/\\]/g, "_");
    const cacheKey = `${fileKey}_${safeNodeId}`;
    const content = buildSvgContent(paths);
    svgContentCache.set(cacheKey, content);
    return `${SVG_URI_SCHEME}${cacheKey}`;
  } catch {
    return undefined;
  }
}

/**
 * Retrieves SVG content from the in-memory cache by URI.
 * Returns the SVG content string if found, undefined otherwise.
 */
export async function resolveVectorUri(uri: string): Promise<string | undefined> {
  if (!uri.startsWith(SVG_URI_SCHEME)) return undefined;
  const key = uri.slice(SVG_URI_SCHEME.length);
  return svgContentCache.get(key);
}
