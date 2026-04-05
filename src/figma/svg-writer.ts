const SVG_URI_SCHEME = "figma://vector/";

/** In-memory cache of SVG content by URI key (e.g., "fileKey_nodeId") */
const svgContentCache = new Map<string, string>();

/** Gets SVG content from the cache by key */
export function getSvgContentFromCache(key: string): string | undefined {
  return svgContentCache.get(key);
}

import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

/** Bounding box for a node, used for SVG viewBox */
export interface SvgBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Returns the number of cached SVGs - useful for debugging */
export function getSvgCacheSize(): number {
  return svgContentCache.size;
}

/** Lists all cached SVG keys - useful for debugging */
export function getCachedSvgKeys(): string[] {
  return Array.from(svgContentCache.keys());
}

/**
 * Parses an SVG path string and computes its bounding box.
 * Handles M, L, H, V, C, S, Q, T, A, Z commands (relative and absolute).
 * Returns undefined if no valid points found.
 */
function computePathBounds(d: string): SvgBounds | undefined {
  // Extract all numbers from the path
  const numbers: number[] = [];
  const numRegex = /-?(?:\d+\.?\d*|\d*\.?\d+)(?:[eE][+-]?\d+)?/g;
  let match;
  while ((match = numRegex.exec(d)) !== null) {
    numbers.push(parseFloat(match[0]));
  }

  if (numbers.length < 2) return undefined;

  // Track current position and bounds
  let x = 0,
    y = 0;
  let startX = 0,
    startY = 0;
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let numIdx = 0;

  function updateBounds(px: number, py: number) {
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
  }

  // Process path string character by character
  let i = 0;
  while (i < d.length) {
    // Find command letter
    const cmdMatch = d.slice(i).match(/[MLHVCSQTAZ]/i);
    if (!cmdMatch) break;
    const cmd = cmdMatch[0];
    const isRelative = cmd >= "a" && cmd <= "z";
    const ucmd = cmd.toUpperCase();

    // Move past command
    i = d.indexOf(cmd, i) + 1;

    switch (ucmd) {
      case "M": {
        x = numbers[numIdx++];
        y = numbers[numIdx++];
        startX = x;
        startY = y;
        updateBounds(x, y);
        // Implicit L commands follow M
        while (numIdx + 1 < numbers.length && d.slice(i).match(/^-?[.\d]/)) {
          x = numbers[numIdx++];
          y = numbers[numIdx++];
          if (isRelative) {
            x += startX;
            y += startY;
          }
          updateBounds(x, y);
        }
        break;
      }
      case "L": {
        while (numIdx + 1 < numbers.length) {
          x = numbers[numIdx++];
          y = numbers[numIdx++];
          if (isRelative) {
            x += startX;
            y += startY;
          }
          updateBounds(x, y);
        }
        break;
      }
      case "H": {
        while (numIdx < numbers.length) {
          x = numbers[numIdx++];
          if (isRelative) x += startX;
          updateBounds(x, y);
        }
        break;
      }
      case "V": {
        while (numIdx < numbers.length) {
          y = numbers[numIdx++];
          if (isRelative) y += startY;
          updateBounds(x, y);
        }
        break;
      }
      case "C": {
        // Cubic bezier: 3 pairs of control points + end point
        while (numIdx + 5 < numbers.length) {
          // Control point 1
          let cx1 = numbers[numIdx++];
          let cy1 = numbers[numIdx++];
          if (isRelative) {
            cx1 += startX;
            cy1 += startY;
          }
          updateBounds(cx1, cy1);
          // Control point 2
          let cx2 = numbers[numIdx++];
          let cy2 = numbers[numIdx++];
          if (isRelative) {
            cx2 += startX;
            cy2 += startY;
          }
          updateBounds(cx2, cy2);
          // End point
          x = numbers[numIdx++];
          y = numbers[numIdx++];
          if (isRelative) {
            x += startX;
            y += startY;
          }
          updateBounds(x, y);
        }
        break;
      }
      case "Q": {
        // Quadratic bezier: 1 control point + end point
        while (numIdx + 3 < numbers.length) {
          // Control point
          let cx = numbers[numIdx++];
          let cy = numbers[numIdx++];
          if (isRelative) {
            cx += startX;
            cy += startY;
          }
          updateBounds(cx, cy);
          // End point
          x = numbers[numIdx++];
          y = numbers[numIdx++];
          if (isRelative) {
            x += startX;
            y += startY;
          }
          updateBounds(x, y);
        }
        break;
      }
      case "S": {
        // Smooth cubic: control point (reflected) + end point
        while (numIdx + 3 < numbers.length) {
          // Control point (can be outside curve)
          let cx = numbers[numIdx++];
          let cy = numbers[numIdx++];
          if (isRelative) {
            cx += startX;
            cy += startY;
          }
          updateBounds(cx, cy);
          // End point
          x = numbers[numIdx++];
          y = numbers[numIdx++];
          if (isRelative) {
            x += startX;
            y += startY;
          }
          updateBounds(x, y);
        }
        break;
      }
      case "T": {
        while (numIdx + 1 < numbers.length) {
          x = numbers[numIdx++];
          y = numbers[numIdx++];
          if (isRelative) {
            x += startX;
            y += startY;
          }
          updateBounds(x, y);
        }
        break;
      }
      case "A": {
        while (numIdx + 6 < numbers.length) {
          numIdx += 7;
          x = numbers[numIdx - 2];
          y = numbers[numIdx - 1];
          if (isRelative) {
            x += startX;
            y += startY;
          }
          updateBounds(x, y);
        }
        break;
      }
      case "Z": {
        x = startX;
        y = startY;
        updateBounds(x, y);
        break;
      }
    }
    startX = x;
    startY = y;
  }

  if (minX === Infinity) return undefined;

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Computes the bounding box from all path data in the array.
 * Returns undefined if no paths have valid points.
 */
function computeBoundsFromPaths(
  paths: Array<{ d: string; fillRule?: string }>,
): SvgBounds | undefined {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let hasPoints = false;

  for (const path of paths) {
    const bounds = computePathBounds(path.d);
    if (bounds) {
      hasPoints = true;
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      maxY = Math.max(maxY, bounds.y + bounds.height);
    }
  }

  if (!hasPoints) return undefined;

  const width = maxX - minX;
  const height = maxY - minY;
  const paddingX = width * 0.01;
  const paddingY = height * 0.01;

  return {
    x: Math.max(0, minX - paddingX),
    y: Math.max(0, minY - paddingY),
    width: width + paddingX * 2,
    height: height + paddingY * 2,
  };
}

/**
 * Builds a minimal valid SVG file from a Figma vector node's geometry.
 * Includes viewBox derived from the node's absoluteBoundingBox.
 */
function buildSvgContent(
  paths: Array<{ d: string; fillRule?: string }>,
  bounds?: SvgBounds,
): string {
  const pathElements = paths
    .map((p) => {
      const fillRuleAttr = p.fillRule ? ` fill-rule="${p.fillRule}"` : "";
      return `  <path d="${p.d}"${fillRuleAttr} />`;
    })
    .join("\n");

  const viewBoxAttr = bounds
    ? ` viewBox="${bounds.x.toFixed(2)} ${bounds.y.toFixed(2)} ${bounds.width.toFixed(2)} ${bounds.height.toFixed(2)}"`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg"${viewBoxAttr} fill="currentColor">\n${pathElements}\n</svg>\n`;
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
  _bounds?: SvgBounds, // Deprecated - we now compute from path data
): Promise<string | undefined> {
  try {
    // Guard: need at least one path with valid d attribute
    if (!paths || paths.length === 0 || !paths.some((p) => p.d)) {
      return undefined;
    }
    // Compute bounds from path data to get local coordinates, not absolute canvas position
    const computedBounds = computeBoundsFromPaths(paths);
    // Sanitize nodeId (colons → underscores) for safe cache keys
    const safeNodeId = nodeId.replace(/[:/\\]/g, "_");
    const cacheKey = `${fileKey}_${safeNodeId}`;
    const content = buildSvgContent(paths, computedBounds);
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

/**
 * Writes an SVG file to disk and returns the relative filename.
 * Returns undefined if the SVG content is invalid or write fails.
 *
 * @param outputDir - Absolute path to the output directory
 * @param fileKey - The Figma file key
 * @param nodeId - The Figma node ID (colons will be replaced with underscores)
 * @param content - The SVG content string
 */
export async function writeVectorSvgToDisk(
  outputDir: string,
  fileKey: string,
  nodeId: string,
  content: string,
): Promise<string | undefined> {
  try {
    const safeNodeId = nodeId.replace(/[:/\\]/g, "_");
    const fileName = `${fileKey}_${safeNodeId}.svg`;
    const filePath = join(outputDir, fileName);

    await mkdir(outputDir, { recursive: true });
    await writeFile(filePath, content, "utf-8");

    return fileName;
  } catch {
    return undefined;
  }
}
