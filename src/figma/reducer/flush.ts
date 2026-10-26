import type { V3Node } from "~/figma/types";
import type { SvgPathEntry, SvgBounds } from "~/figma/svg";
import { svgContentCache } from "../svg-writer";
import { buildSvgExport } from "../svg/transform";
import { getVectorAssetFilename, materializeSvgAssets, type SvgAsset } from "../svg/assets";

export type PendingVectorWriteInput = {
  fileKey: string;
  nodeId: string;
  paths: Array<{ d: string; fillRule?: string }>;
  target: V3Node;
  entries?: SvgPathEntry[];
  bounds?: SvgBounds;
  fillColor?: string;
};

export function addPendingVectorWrite(
  write: PendingVectorWriteInput,
  pendingWrites: PendingVectorWriteInput[],
): void {
  write.target.svgPathInAssetFolder = getVectorAssetFilename(write.fileKey, write.nodeId);
  pendingWrites.push(write);
}

export function prepareVectorAssets(pendingWrites: PendingVectorWriteInput[]): SvgAsset[] {
  return pendingWrites.splice(0).map(prepareVectorAsset);
}

function prepareVectorAsset(write: PendingVectorWriteInput): SvgAsset {
  const entries = write.entries?.length ? write.entries : [{ paths: write.paths }];
  const { content, viewport } = buildSvgExport(entries, write.bounds, write.fillColor);
  const filename = getVectorAssetFilename(write.fileKey, write.nodeId);
  write.target.svgPathInAssetFolder = filename;
  write.target.svgViewport = viewport;
  // Retained for legacy URI readers; request exports never read this mutable cache.
  svgContentCache.set(filename.slice(0, -".svg".length), content);
  return { fileKey: write.fileKey, nodeId: write.nodeId, content };
}

/** Source-level helper: callers must supply the collector owned by their request. */
export async function flushAllPendingVectorSvgs(
  outputDir: string,
  pendingWrites: PendingVectorWriteInput[],
): Promise<void> {
  await materializeSvgAssets(prepareVectorAssets(pendingWrites), outputDir);
}
