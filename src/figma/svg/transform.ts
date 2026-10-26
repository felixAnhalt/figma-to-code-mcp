import { svgPathBbox } from "svg-path-bbox";
import svgPath from "svgpath";
import { Logger } from "~/utils/logger";
import type { V3Node } from "../types";
import type { SvgBounds, SvgPathEntry } from "./cache";

const BOUNDS_PADDING_RATIO = 0.01;
const DEGENERATE_AXIS_SIZE = 1;
const FALLBACK_BOUNDS: SvgBounds = { x: 0, y: 0, width: 1, height: 1 };
const PATH_COORDINATE_PRECISION = 4;
const VIEWPORT_ORIGIN_TOLERANCE = 0.01;

type EmittedSvgViewport = NonNullable<V3Node["svgViewport"]>;

/** Omits x or y when it is zero within float noise, since a missing offset means 0. */
export function toEmittedSvgViewport(viewport: SvgBounds): EmittedSvgViewport {
  const { x, y, width, height } = viewport;
  return {
    ...(isVisibleOffset(x) ? { x } : {}),
    ...(isVisibleOffset(y) ? { y } : {}),
    width,
    height,
  };
}

function isVisibleOffset(offset: number): boolean {
  return Math.abs(offset) >= VIEWPORT_ORIGIN_TOLERANCE;
}

function hasFiniteBounds(bounds: SvgBounds): boolean {
  return [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite);
}

function hasFinitePathCoordinates(path: ReturnType<typeof svgPath>): boolean {
  let finite = true;
  path.iterate((segment) => {
    finite &&= segment.slice(1).every(Number.isFinite);
  });
  return finite;
}

export function computePathBounds(d: string): SvgBounds | undefined {
  try {
    const path = svgPath(d).abs();
    // svg-path-bbox otherwise measures the valid prefix of malformed path data.
    if (("err" in path && path.err) || !hasFinitePathCoordinates(path)) return undefined;
    const [x, y, maxX, maxY] = svgPathBbox(path);
    const bounds = { x, y, width: maxX - x, height: maxY - y };
    return hasFiniteBounds(bounds) ? bounds : undefined;
  } catch (error) {
    Logger.warn(
      "Failed to compute SVG path bounds:",
      error instanceof Error ? error.message : String(error),
    );
    return undefined;
  }
}

function padBounds(bounds: SvgBounds): SvgBounds | undefined {
  const width = bounds.width || DEGENERATE_AXIS_SIZE;
  const height = bounds.height || DEGENERATE_AXIS_SIZE;
  const paddingX = width * BOUNDS_PADDING_RATIO;
  const paddingY = height * BOUNDS_PADDING_RATIO;
  const padded = {
    x: bounds.x - (width - bounds.width) / 2 - paddingX,
    y: bounds.y - (height - bounds.height) / 2 - paddingY,
    width: width + paddingX * 2,
    height: height + paddingY * 2,
  };
  return hasFiniteBounds(padded) ? padded : undefined;
}

function unionBounds(first: SvgBounds, second: SvgBounds): SvgBounds {
  const x = Math.min(first.x, second.x);
  const y = Math.min(first.y, second.y);
  return {
    x,
    y,
    width: Math.max(first.x + first.width, second.x + second.width) - x,
    height: Math.max(first.y + first.height, second.y + second.height) - y,
  };
}

export function computeBoundsFromPaths(
  paths: Array<{ d: string; fillRule?: string }>,
): SvgBounds | undefined {
  const bounds = computeInkBounds(paths);
  return bounds ? padBounds(bounds) : undefined;
}

function computeInkBounds(paths: Array<{ d: string }>): SvgBounds | undefined {
  const bounds = paths
    .map((path) => computePathBounds(path.d))
    .filter((bounds): bounds is SvgBounds => bounds !== undefined);
  return bounds.length ? bounds.reduce(unionBounds) : undefined;
}

function isUsableCanvas(bounds: SvgBounds): boolean {
  return hasFiniteBounds(bounds) && bounds.width >= 0 && bounds.height >= 0;
}

/** Measure already serialized geometry; retain zero canvas axes until after the union. */
export function computeSvgViewport(paths: Array<{ d: string }>, canvas?: SvgBounds): SvgBounds {
  const ink = computeInkBounds(paths);
  const combined =
    canvas && isUsableCanvas(canvas) ? (ink ? unionBounds(canvas, ink) : canvas) : ink;
  const bounds = combined && isUsableCanvas(combined) ? combined : FALLBACK_BOUNDS;
  const width = bounds.width || DEGENERATE_AXIS_SIZE;
  const height = bounds.height || DEGENERATE_AXIS_SIZE;
  return {
    x: bounds.x - (width - bounds.width) / 2,
    y: bounds.y - (height - bounds.height) / 2,
    width,
    height,
  };
}

export function transformPath(
  d: string,
  transform: [number, number, number, number, number, number],
): string {
  return svgPath(d).matrix(transform).round(PATH_COORDINATE_PRECISION).toString();
}

function roundCoord(num: number): string {
  return Number(num.toFixed(PATH_COORDINATE_PRECISION)).toString();
}

export function roundPathCoordinates(d: string): string {
  const rounded = d.replace(/-?(?:\d+\.?\d*|\d*\.?\d+)(?:[eE][+-]?\d+)?/g, (match) => {
    const num = parseFloat(match);
    if (isNaN(num)) return match;
    return roundCoord(num);
  });
  // Keep existing spelling when unchanged; the parser preserves separators and arc flags otherwise.
  return rounded === d ? d : svgPath(d).round(PATH_COORDINATE_PRECISION).toString();
}

function resolveSvgBounds(paths: Array<{ d: string }>, bounds?: SvgBounds): SvgBounds {
  if (bounds && hasFiniteBounds(bounds) && bounds.width > 0 && bounds.height > 0) {
    return bounds;
  }
  return computeBoundsFromPaths(paths) ?? FALLBACK_BOUNDS;
}

function buildCanvasAttributes(paths: Array<{ d: string }>, bounds?: SvgBounds): string {
  const { x, y, width, height } = resolveSvgBounds(paths, bounds);
  // Keep the local canvas exact; expanded stroke outlines may extend beyond its origin.
  return `width="${width}" height="${height}" viewBox="${x} ${y} ${width} ${height}" overflow="visible"`;
}

export function buildSvgContent(
  paths: Array<{ d: string; fillRule?: string }>,
  bounds?: SvgBounds,
): string {
  const pathElements = paths
    .map((p) => {
      const fillRuleAttr = p.fillRule ? ` fill-rule="${p.fillRule}"` : "";
      return `  <path d="${p.d}"${fillRuleAttr} />`;
    })
    .join("\n");

  const canvasAttrs = buildCanvasAttributes(paths, bounds);
  return `<svg xmlns="http://www.w3.org/2000/svg" ${canvasAttrs} fill="currentColor">\n${pathElements}\n</svg>\n`;
}

export function buildSvgContentWithFills(
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

  const canvasAttrs = buildCanvasAttributes(paths, bounds);
  return `<svg xmlns="http://www.w3.org/2000/svg" ${canvasAttrs}>\n${pathElements}\n</svg>\n`;
}

function serializeSvgEntries(entries: SvgPathEntry[]) {
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

  return allPaths;
}

export function buildSvgContentFromEntries(entries: SvgPathEntry[], bounds?: SvgBounds): string {
  return buildSvgContentWithFills(serializeSvgEntries(entries), bounds);
}

/** Standalone image exports must include ink that external image viewports would otherwise clip. */
export function buildSvgExport(entries: SvgPathEntry[], canvas?: SvgBounds, fillColor?: string) {
  const paths = serializeSvgEntries(entries);
  const viewport = computeSvgViewport(paths, canvas);
  const coloredPaths = paths.map((path) => ({
    ...path,
    fillColor: path.fillColor ?? fillColor ?? "currentColor",
  }));
  return { content: buildSvgContentWithFills(coloredPaths, viewport), viewport };
}
