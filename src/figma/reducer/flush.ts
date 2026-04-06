import type { V3Node } from "~/figma";
import type { SvgPathEntry, SvgBounds } from "~/figma/svg";

export type PendingVectorWriteInput = {
  fileKey: string;
  nodeId: string;
  paths: Array<{ d: string; fillRule?: string }>;
  target: V3Node;
  entries?: SvgPathEntry[];
  bounds?: SvgBounds;
};
import {
  buildSvgContentFromEntries,
  getSvgContentFromCache,
  svgContentCache,
  writeMergedVectorSvgToDisk,
  writeVectorSvg,
  writeVectorSvgToDisk,
} from "../svg-writer";

const globalPendingVectorWrites: PendingVectorWriteInput[] = [];

export function getPendingVectorWrites(): PendingVectorWriteInput[] {
  return globalPendingVectorWrites;
}

export function addPendingVectorWrite(write: PendingVectorWriteInput): void {
  globalPendingVectorWrites.push(write);
}

export async function flushAllPendingVectorSvgs(outputDir: string): Promise<void> {
  await Promise.all(
    globalPendingVectorWrites.map(async ({ fileKey, nodeId, paths, target, entries, bounds }) => {
      const safeNodeId = nodeId.replace(/[:/\\]/g, "_");

      if (entries && entries.length > 0) {
        const mergedContent = buildSvgContentFromEntries(entries, bounds);
        const cacheKey = `${fileKey}_${safeNodeId}`;
        svgContentCache.set(cacheKey, mergedContent);

        const fileName = `${fileKey}_${safeNodeId}.svg`;
        (target as V3Node).svgPathInAssetFolder = fileName;

        if (outputDir) {
          await writeMergedVectorSvgToDisk(outputDir, fileKey, nodeId, entries, bounds);
        }

        return;
      }

      const uri = await writeVectorSvg(fileKey, nodeId, paths);
      if (!uri) return;

      const fileName = `${fileKey}_${safeNodeId}.svg`;
      (target as V3Node).svgPathInAssetFolder = fileName;

      if (outputDir) {
        const cacheKey = `${fileKey}_${safeNodeId}`;
        const content = getSvgContentFromCache(cacheKey);
        if (!content) return;

        await writeVectorSvgToDisk(outputDir, fileKey, nodeId, content);
      }
    }),
  );
  globalPendingVectorWrites.length = 0;
}
