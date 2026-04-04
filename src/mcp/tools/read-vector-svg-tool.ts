import { z } from "zod";
import { resolveVectorUri, getCachedSvgKeys, getSvgCacheSize } from "~/figma/svg-writer";
import { Logger } from "~/utils/logger";

const parameters = {
  uri: z
    .string()
    .regex(/^figma:\/\/vector\/.+$/, "URI must be figma://vector/...")
    .describe("The vector URI to read (e.g., figma://vector/fileKey_nodeId)"),
};

const parametersSchema = z.object(parameters);
export type ReadVectorSvgParams = z.infer<typeof parametersSchema>;

export const readVectorSvgTool = {
  name: "read_vector_svg",
  description:
    "Reads cached SVG content for a Figma VECTOR node. Use this after calling get_figma_design to retrieve the SVG geometry for vectors that have vectorPathUri. The URI should be taken from the vectorPathUri field in the design response.",
  parametersSchema,
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
