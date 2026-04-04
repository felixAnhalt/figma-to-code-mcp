import { writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SVG_URI_SCHEME = "figma://vector/";
const SVG_DIR_PREFIX = "figma-mcp-svg-";

/** Stable temp directory for this process — created on first use. */
let svgDir: string | null = null;
/** Promise to ensure directory creation only happens once */
let svgDirPromise: Promise<string> | null = null;

async function getSvgDir(): Promise<string> {
  if (svgDir) return svgDir;

  // Use a promise to ensure only one mkdir call happens, even with concurrent calls
  if (!svgDirPromise) {
    svgDirPromise = (async () => {
      // Use a per-process directory so concurrent server instances don't collide.
      const dir = join(tmpdir(), `${SVG_DIR_PREFIX}${process.pid}`);
      try {
        await mkdir(dir, { recursive: true });
      } catch (err) {
        // Ignore "already exists" errors (can happen in race conditions)
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
          throw err;
        }
      }
      svgDir = dir;
      return dir;
    })();
  }

  return svgDirPromise;
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
 * Writes SVG geometry for a Figma VECTOR node to the process-scoped temp directory.
 *
 * Returns the MCP resource URI (e.g. "figma://vector/fileKey_nodeId") on success,
 * or undefined if the write fails (callers should skip the vectorPathUri field).
 *
 * The file name is node-id-based: figma_{fileKey}_{sanitizedNodeId}.svg
 * so each vector node has a stable, traceable file on disk.
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
    const dir = await getSvgDir();
    // Sanitize nodeId (colons → underscores) for safe file names
    const safeNodeId = nodeId.replace(/[:/\\]/g, "_");
    const fileName = `figma_${fileKey}_${safeNodeId}.svg`;
    const filePath = join(dir, fileName);
    const content = buildSvgContent(paths);
    await writeFile(filePath, content, "utf-8");
    return `${SVG_URI_SCHEME}${fileKey}_${safeNodeId}`;
  } catch {
    return undefined;
  }
}

/**
 * Resolves a vector URI back to the absolute file path on disk.
 * Returns undefined if the URI doesn't match the expected scheme.
 */
export async function resolveVectorUri(uri: string): Promise<string | undefined> {
  if (!uri.startsWith(SVG_URI_SCHEME)) return undefined;
  const key = uri.slice(SVG_URI_SCHEME.length);
  const dir = await getSvgDir();
  return join(dir, `figma_${key}.svg`);
}
