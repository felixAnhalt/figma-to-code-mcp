const SVG_URI_SCHEME = "figma://vector/";

/** In-memory cache of SVG content by URI key (e.g., "fileKey_nodeId") */
export const svgContentCache = new Map<string, string>();

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
 * A group of paths that share the same fill/stroke, with an optional transform matrix.
 * The transform is a 2x3 affine transform: [a, b, c, d, tx, ty] representing:
 * x' = a*x + c*y + tx
 * y' = b*x + d*y + ty
 */
export type SvgPathEntry = {
  paths: Array<{ d: string; fillRule?: string; fillColor?: string }>;
  transform?: [number, number, number, number, number, number];
};

/**
 * Applies a 2D affine transform to a path string.
 * Returns a new path string with transformed coordinates.
 * Properly handles SVG path commands: M, L, H, V, C, S, Q, T, A, Z
 */
function transformPath(
  d: string,
  transform: [number, number, number, number, number, number],
): string {
  const [a, b, c, d_val, tx, ty] = transform;

  function transformPoint(x: number, y: number): [number, number] {
    return [a * x + c * y + tx, b * x + d_val * y + ty];
  }

  function transformX(x: number, y: number): number {
    return a * x + c * y + tx;
  }

  function transformY(x: number, y: number): number {
    return b * x + d_val * y + ty;
  }

  function formatNum(n: number): string {
    return Number(n.toFixed(4)).toString();
  }

  const tokens: string[] = [];
  let i = 0;

  function nextNumber(): number | undefined {
    skipWhitespace();
    const slice = d.slice(i);
    const match = slice.match(/^-?(?:\d+\.?\d*|\d*\.?\d+)(?:[eE][+-]?\d+)?/);
    if (!match) return undefined;
    i += match[0].length;
    return parseFloat(match[0]);
  }

  function skipWhitespace() {
    const slice = d.slice(i);
    const match = slice.match(/^[\s,]+/);
    if (match) i += match[0].length;
  }

  while (i < d.length) {
    skipWhitespace();
    if (i >= d.length) break;

    const cmdChar = d[i];
    if (/[MLHVCSQTAZ]/i.test(cmdChar)) {
      const cmd = cmdChar;
      const isRelative = cmd >= "a" && cmd <= "z";
      const ucmd = cmd.toUpperCase();
      tokens.push(cmd);
      i++;

      let x = 0,
        y = 0;
      let startX = 0,
        startY = 0;

      switch (ucmd) {
        case "M": {
          const x1 = nextNumber();
          const y1 = nextNumber();
          if (x1 !== undefined && y1 !== undefined) {
            const [newX, newY] = transformPoint(x1, y1);
            tokens.push(formatNum(newX), formatNum(newY));
            x = isRelative ? x + x1 : x1;
            y = isRelative ? y + y1 : y1;
            startX = x;
            startY = y;
          }
          let x2 = nextNumber();
          let y2 = nextNumber();
          while (x2 !== undefined && y2 !== undefined) {
            if (isRelative) {
              x2 = x + x2;
              y2 = y + y2;
            }
            const [newX, newY] = transformPoint(x2, y2);
            tokens.push(formatNum(newX), formatNum(newY));
            x = newX;
            y = newY;
            x2 = nextNumber();
            y2 = nextNumber();
          }
          break;
        }
        case "L": {
          let x1 = nextNumber();
          let y1 = nextNumber();
          while (x1 !== undefined && y1 !== undefined) {
            if (isRelative) {
              x1 = x + x1;
              y1 = y + y1;
            }
            const [newX, newY] = transformPoint(x1, y1);
            tokens.push(formatNum(newX), formatNum(newY));
            x = newX;
            y = newY;
            x1 = nextNumber();
            y1 = nextNumber();
          }
          break;
        }
        case "H": {
          let x1 = nextNumber();
          while (x1 !== undefined) {
            if (isRelative) {
              x1 = x + x1;
            }
            const newX = transformX(x1, y);
            tokens.push(formatNum(newX));
            x = newX;
            x1 = nextNumber();
          }
          break;
        }
        case "V": {
          let y1 = nextNumber();
          while (y1 !== undefined) {
            if (isRelative) {
              y1 = y + y1;
            }
            const newY = transformY(x, y1);
            tokens.push(formatNum(newY));
            y = newY;
            y1 = nextNumber();
          }
          break;
        }
        case "C": {
          let cx1 = nextNumber();
          let cy1 = nextNumber();
          let cx2 = nextNumber();
          let cy2 = nextNumber();
          let x1 = nextNumber();
          let y1 = nextNumber();
          while (
            cx1 !== undefined &&
            cy1 !== undefined &&
            cx2 !== undefined &&
            cy2 !== undefined &&
            x1 !== undefined &&
            y1 !== undefined
          ) {
            if (isRelative) {
              cx1 = x + cx1;
              cy1 = y + cy1;
              cx2 = x + cx2;
              cy2 = y + cy2;
              x1 = x + x1;
              y1 = y + y1;
            }
            const [newCx1, newCy1] = transformPoint(cx1, cy1);
            const [newCx2, newCy2] = transformPoint(cx2, cy2);
            const [newX, newY] = transformPoint(x1, y1);
            tokens.push(
              formatNum(newCx1),
              formatNum(newCy1),
              formatNum(newCx2),
              formatNum(newCy2),
              formatNum(newX),
              formatNum(newY),
            );
            x = newX;
            y = newY;
            cx1 = nextNumber();
            cy1 = nextNumber();
            cx2 = nextNumber();
            cy2 = nextNumber();
            x1 = nextNumber();
            y1 = nextNumber();
          }
          break;
        }
        case "S": {
          let cx2 = nextNumber();
          let cy2 = nextNumber();
          let x1 = nextNumber();
          let y1 = nextNumber();
          while (cx2 !== undefined && cy2 !== undefined && x1 !== undefined && y1 !== undefined) {
            if (isRelative) {
              cx2 = x + cx2;
              cy2 = y + cy2;
              x1 = x + x1;
              y1 = y + y1;
            }
            const [newCx2, newCy2] = transformPoint(cx2, cy2);
            const [newX, newY] = transformPoint(x1, y1);
            tokens.push(formatNum(newCx2), formatNum(newCy2), formatNum(newX), formatNum(newY));
            x = newX;
            y = newY;
            cx2 = nextNumber();
            cy2 = nextNumber();
            x1 = nextNumber();
            y1 = nextNumber();
          }
          break;
        }
        case "Q": {
          let cx = nextNumber();
          let cy = nextNumber();
          let x1 = nextNumber();
          let y1 = nextNumber();
          while (cx !== undefined && cy !== undefined && x1 !== undefined && y1 !== undefined) {
            if (isRelative) {
              cx = x + cx;
              cy = y + cy;
              x1 = x + x1;
              y1 = y + y1;
            }
            const [newCx, newCy] = transformPoint(cx, cy);
            const [newX, newY] = transformPoint(x1, y1);
            tokens.push(formatNum(newCx), formatNum(newCy), formatNum(newX), formatNum(newY));
            x = newX;
            y = newY;
            cx = nextNumber();
            cy = nextNumber();
            x1 = nextNumber();
            y1 = nextNumber();
          }
          break;
        }
        case "T": {
          let x1 = nextNumber();
          let y1 = nextNumber();
          while (x1 !== undefined && y1 !== undefined) {
            if (isRelative) {
              x1 = x + x1;
              y1 = y + y1;
            }
            const [newX, newY] = transformPoint(x1, y1);
            tokens.push(formatNum(newX), formatNum(newY));
            x = newX;
            y = newY;
            x1 = nextNumber();
            y1 = nextNumber();
          }
          break;
        }
        case "A": {
          let rx = nextNumber();
          let ry = nextNumber();
          let rot = nextNumber();
          let largeArc = nextNumber();
          let sweep = nextNumber();
          let x1 = nextNumber();
          let y1 = nextNumber();
          while (
            rx !== undefined &&
            ry !== undefined &&
            rot !== undefined &&
            largeArc !== undefined &&
            sweep !== undefined &&
            x1 !== undefined &&
            y1 !== undefined
          ) {
            if (rx === null) rx = 0;
            if (ry === null) ry = 0;
            tokens.push(formatNum(rx), formatNum(ry));
            if (rot !== undefined) tokens.push(formatNum(rot));
            if (largeArc !== undefined) tokens.push(String(largeArc));
            if (sweep !== undefined) tokens.push(String(sweep));
            if (isRelative) {
              x1 = x + x1;
              y1 = y + y1;
            }
            const [newX, newY] = transformPoint(x1, y1);
            tokens.push(formatNum(newX), formatNum(newY));
            x = newX;
            y = newY;
            rx = nextNumber();
            ry = nextNumber();
            rot = nextNumber();
            largeArc = nextNumber();
            sweep = nextNumber();
            x1 = nextNumber();
            y1 = nextNumber();
          }
          break;
        }
        case "Z": {
          x = startX;
          y = startY;
          break;
        }
      }
    } else {
      tokens.push(d[i]);
      i++;
    }
  }

  return tokens.join(" ");
}

/**
 * Rounds a number to 4 decimal places for cleaner SVG output
 */
function roundCoord(num: number): string {
  return Number(num.toFixed(4)).toString();
}

/**
 * Rounds all coordinates in an SVG path string
 */
function roundPathCoordinates(d: string): string {
  return d.replace(/-?(?:\d+\.?\d*|\d*\.?\d+)(?:[eE][+-]?\d+)?/g, (match) => {
    const num = parseFloat(match);
    if (isNaN(num)) return match;
    return roundCoord(num);
  });
}

/**
 * Builds a minimal valid SVG file from path entries.
 * Each entry contains paths and an optional transform matrix.
 * Exported for use in reducer.ts for vector group merging.
 */
export function buildSvgContentFromEntries(entries: SvgPathEntry[], bounds?: SvgBounds): string {
  const allPaths: Array<{ d: string; fillRule?: string; fillColor?: string }> = [];

  for (const entry of entries) {
    if (!entry.paths) continue;

    for (const pathObj of entry.paths) {
      if (!pathObj.d) continue;

      let d = pathObj.d;
      if (entry.transform) {
        d = transformPath(d, entry.transform);
      }
      d = roundPathCoordinates(d);

      allPaths.push({
        d,
        fillRule: pathObj.fillRule,
        fillColor: pathObj.fillColor,
      });
    }
  }

  return buildSvgContentWithFills(allPaths, bounds);
}

/**
 * Builds a minimal valid SVG file from a Figma vector node's geometry.
 * Includes viewBox derived from computed bounds.
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
 * Builds an SVG with fill colors on each path
 */
function buildSvgContentWithFills(
  paths: Array<{ d: string; fillRule?: string; fillColor?: string }>,
  bounds?: SvgBounds,
): string {
  const pathElements = paths
    .map((p) => {
      const fillRuleAttr = p.fillRule ? ` fill-rule="${p.fillRule}"` : "";
      const fillAttr = p.fillColor ? ` fill="${p.fillColor}"` : "";
      return `  <path d="${p.d}"${fillAttr}${fillRuleAttr} />`;
    })
    .join("\n");

  let svgAttrs = 'xmlns="http://www.w3.org/2000/svg"';
  if (bounds) {
    svgAttrs += ` width="${Math.ceil(bounds.width)}" height="${Math.ceil(bounds.height)}" viewBox="0 0 ${Math.ceil(bounds.width)} ${Math.ceil(bounds.height)}"`;
  }

  return `<svg ${svgAttrs}>\n${pathElements}\n</svg>\n`;
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

/**
 * Writes a merged SVG from multiple path entries to disk.
 * Each entry has paths and an optional transform matrix.
 *
 * @param outputDir - Absolute path to the output directory
 * @param fileKey - The Figma file key
 * @param nodeId - The Figma node ID (colons will be replaced with underscores)
 * @param entries - Array of path entries with optional transforms
 * @param bounds - Optional bounding box for viewBox/width/height
 */
export async function writeMergedVectorSvgToDisk(
  outputDir: string,
  fileKey: string,
  nodeId: string,
  entries: SvgPathEntry[],
  bounds?: SvgBounds,
): Promise<string | undefined> {
  try {
    const safeNodeId = nodeId.replace(/[:/\\]/g, "_");
    const fileName = `${fileKey}_${safeNodeId}.svg`;
    const filePath = join(outputDir, fileName);

    const content = buildSvgContentFromEntries(entries, bounds);

    await mkdir(outputDir, { recursive: true });
    await writeFile(filePath, content, "utf-8");

    return fileName;
  } catch {
    return undefined;
  }
}
