import { z } from "zod";
import { writeFile, mkdir } from "node:fs/promises";
import { resolveVectorUri, getCachedSvgKeys, getSvgCacheSize } from "~/figma/svg-writer";
import { Logger } from "~/utils/logger";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SVG_FILES_DIR = join(tmpdir(), "figma-mcp-svg-files");

async function ensureSvgFilesDir(): Promise<string> {
  try {
    await mkdir(SVG_FILES_DIR, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
  }
  return SVG_FILES_DIR;
}

const readParameters = {
  uri: z
    .string()
    .regex(/^figma:\/\/vector\/.+$/, "URI must be figma://vector/...")
    .describe("The vector URI to read (e.g., figma://vector/fileKey_nodeId)"),
};

const readParametersSchema = z.object(readParameters);
export type ReadVectorSvgParams = z.infer<typeof readParametersSchema>;

const readVectorSvgTool = {
  name: "read_vector_svg",
  description:
    "Reads cached SVG content for a Figma VECTOR node. Use this after calling get_figma_design to retrieve the SVG geometry for vectors that have vectorPathUri. The URI should be taken from the vectorPathUri field in the design response.",
  parametersSchema: readParametersSchema,
  handler: async (params: ReadVectorSvgParams) => {
    try {
      const { uri } = params;

      Logger.log(`[read_vector_svg] Reading URI: ${uri}`);

      const svgContent = await resolveVectorUri(uri);

      if (!svgContent) {
        const availableKeys = getCachedSvgKeys();
        const cacheSize = getSvgCacheSize();
        Logger.warn(`[read_vector_svg] URI not found in cache. Cache has ${cacheSize} items.`);

        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `SVG not found for URI: ${uri}\n\nCache has ${cacheSize} items.\nAvailable keys: ${availableKeys.slice(0, 10).join(", ")}${availableKeys.length > 10 ? "..." : ""}`,
            },
          ],
        };
      }

      Logger.log(`[read_vector_svg] Successfully retrieved SVG (${svgContent.length} bytes)`);

      return {
        content: [
          {
            type: "text" as const,
            text: svgContent,
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.error(`[read_vector_svg] Error: ${message}`);
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error reading SVG: ${message}`,
          },
        ],
      };
    }
  },
};

const saveVectorSvgsTool = {
  name: "save_vector_svgs_to_files",
  description:
    "Saves multiple SVG files to disk and returns the file paths. Use this to export SVG assets that can be copied into a project assets folder. Input is an array of vector URIs from the design response.",
  parametersSchema: z.object({
    uris: z
      .array(z.string().regex(/^figma:\/\/vector\/.+$/))
      .describe(
        "Array of vector URIs to save (e.g., ['figma://vector/fileKey_nodeId1', 'figma://vector/fileKey_nodeId2'])",
      ),
  }),
  handler: async (params: { uris: string[] }) => {
    try {
      const { uris } = params;
      const dir = await ensureSvgFilesDir();
      const savedFiles: string[] = [];
      const errors: string[] = [];

      for (const uri of uris) {
        const svgContent = await resolveVectorUri(uri);
        if (!svgContent) {
          errors.push(`Not found: ${uri}`);
          continue;
        }

        const key = uri.replace("figma://vector/", "");
        const fileName = `${key}.svg`;
        const filePath = join(dir, fileName);

        await writeFile(filePath, svgContent, "utf-8");
        savedFiles.push(filePath);
        Logger.log(`[save_vector_svgs] Wrote ${filePath}`);
      }

      if (savedFiles.length === 0) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `No SVGs saved. Errors: ${errors.join(", ")}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Saved ${savedFiles.length} SVG file(s):\n\n${savedFiles.join("\n")}\n\nCopy these files to your assets folder.`,
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      Logger.error(`[save_vector_svgs] Error: ${message}`);
      return {
        isError: true,
        content: [
          {
            type: "text" as const,
            text: `Error saving SVGs: ${message}`,
          },
        ],
      };
    }
  },
};

export { readVectorSvgTool, saveVectorSvgsTool };
