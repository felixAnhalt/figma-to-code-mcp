import { z } from "zod";
import { FigmaService } from "../../services/figma.js";
import { Logger } from "../../utils/logger.js";

const parametersSchema = z.object({
  fileKey: z
    .string()
    .regex(/^[a-zA-Z0-9]+$/, "File key must be alphanumeric")
    .describe("The key of the Figma file to retrieve image fill URLs from"),
});

export type GetImageFillsParams = z.infer<typeof parametersSchema>;

async function getImageFills(params: GetImageFillsParams, figmaService: FigmaService) {
  try {
    const { fileKey } = parametersSchema.parse(params);
    const images = await figmaService.getImageFillUrls(fileKey);

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ images }, null, 2),
        },
      ],
    };
  } catch (error) {
    Logger.error(`Error fetching image fills from ${params.fileKey}:`, error);
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Failed to fetch image fills: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}

export const getImageFillsTool = {
  name: "get_image_fills",
  description:
    "Returns download URLs for all image fills in a Figma file. Image fills are user-supplied images placed into nodes. Use this to resolve imageRef values found in node fills to their actual download URLs.",
  parametersSchema,
  handler: getImageFills,
} as const;
