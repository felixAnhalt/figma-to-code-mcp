import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { MCPResponse } from "./types";
import { downloadBytes } from "~/utils/downloadBytes";
import { Logger } from "~/utils/logger";

const PNG_EXTENSION = ".png";
const UNSAFE_FILENAME_CHARS = /[:/\\]/g;

export type RenderedNodeImageReference = Pick<
  MCPResponse,
  "renderedDesignNodeAssetsFolder" | "renderedDesignNodePathInAssetFolder"
>;

type Download = (url: string) => Promise<Buffer>;

export function getRenderedNodeFilename(fileKey: string, nodeId: string): string {
  return `${fileKey}_${nodeId.replace(UNSAFE_FILENAME_CHARS, "_")}${PNG_EXTENSION}`;
}

/**
 * Saves the rendered PNG of a node into outputDir. A failed download or write is logged and
 * returns undefined, so the design data is still returned without the image fields.
 */
export async function writeRenderedNodeImage(
  outputDir: string,
  fileKey: string,
  nodeId: string,
  imageUrl: string,
  download: Download = downloadBytes,
): Promise<RenderedNodeImageReference | undefined> {
  try {
    const bytes = await download(imageUrl);
    const filename = getRenderedNodeFilename(fileKey, nodeId);
    await mkdir(outputDir, { recursive: true });
    await writeFile(join(outputDir, filename), bytes);
    return {
      renderedDesignNodeAssetsFolder: outputDir,
      renderedDesignNodePathInAssetFolder: filename,
    };
  } catch (error) {
    Logger.warn(`Failed to save rendered image for node ${nodeId}:`, error);
    return undefined;
  }
}
