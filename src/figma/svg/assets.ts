import { writeVectorSvgToDisk } from "./writer";

export type SvgAsset = {
  fileKey: string;
  nodeId: string;
  content: string;
};

export function getVectorAssetFilename(fileKey: string, nodeId: string): string {
  return `${fileKey}_${nodeId.replace(/[:/\\]/g, "_")}.svg`;
}

export async function materializeSvgAssets(assets: SvgAsset[], outputDir: string): Promise<void> {
  if (!outputDir) return;
  const results = await Promise.allSettled(
    assets.map((asset) => materializeSvgAsset(asset, outputDir)),
  );
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
}

async function materializeSvgAsset(asset: SvgAsset, outputDir: string): Promise<void> {
  const filename = await writeVectorSvgToDisk(
    outputDir,
    asset.fileKey,
    asset.nodeId,
    asset.content,
  );
  if (!filename) {
    throw new Error(
      `Failed to write SVG asset ${getVectorAssetFilename(asset.fileKey, asset.nodeId)} to ${outputDir}`,
    );
  }
}
