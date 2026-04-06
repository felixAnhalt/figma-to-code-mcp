import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  svgContentCache,
  getSvgContentFromCache,
  SVG_URI_SCHEME,
  type SvgBounds,
  type SvgPathEntry,
} from "./cache";
import { computeBoundsFromPaths, buildSvgContent } from "./transform";

export async function writeVectorSvg(
  fileKey: string,
  nodeId: string,
  paths: Array<{ d: string; fillRule?: string }>,
  _bounds?: SvgBounds,
): Promise<string | undefined> {
  try {
    if (!paths || paths.length === 0 || !paths.some((p) => p.d)) {
      return undefined;
    }
    const computedBounds = computeBoundsFromPaths(paths);
    const safeNodeId = nodeId.replace(/[:/\\]/g, "_");
    const cacheKey = `${fileKey}_${safeNodeId}`;
    const content = buildSvgContent(paths, computedBounds);
    svgContentCache.set(cacheKey, content);
    return `${SVG_URI_SCHEME}${cacheKey}`;
  } catch {
    return undefined;
  }
}

export async function resolveVectorUri(uri: string): Promise<string | undefined> {
  if (!uri.startsWith(SVG_URI_SCHEME)) return undefined;
  const key = uri.slice(SVG_URI_SCHEME.length);
  return svgContentCache.get(key);
}

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

    const { buildSvgContentFromEntries } = await import("./transform.js");
    const content = buildSvgContentFromEntries(entries, bounds);

    await mkdir(outputDir, { recursive: true });
    await writeFile(filePath, content, "utf-8");

    return fileName;
  } catch {
    return undefined;
  }
}

export {
  svgContentCache,
  getSvgContentFromCache,
  SVG_URI_SCHEME,
  type SvgBounds,
  type SvgPathEntry,
};
