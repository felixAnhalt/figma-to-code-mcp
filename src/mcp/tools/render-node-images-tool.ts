import { z } from "zod";
import { FigmaService } from "~/services/figma";
import { Logger } from "~/utils/logger";

const parametersSchema = z.object({
  fileKey: z
    .string()
    .regex(/^[a-zA-Z0-9]+$/, "File key must be alphanumeric")
    .describe("The key of the Figma file containing the nodes to render"),
  nodeIds: z
    .array(z.string())
    .min(1, "At least one node ID must be provided")
    .describe("Array of node IDs to render as images (e.g., ['1:2', '1:3', '1:4'])"),
});

export type RenderNodeImagesParams = z.infer<typeof parametersSchema>;

async function renderNodeImages(params: RenderNodeImagesParams, figmaService: FigmaService) {
  try {
    const { fileKey, nodeIds } = parametersSchema.parse(params);
    const images = await figmaService.renderNodeImages(fileKey, nodeIds);

    // Build a helpful response that highlights failed renders
    const failedNodes = Object.entries(images)
      .filter(([, url]) => url === null)
      .map(([nodeId]) => nodeId);

    const successCount = Object.values(images).filter((url) => url !== null).length;
    const failureCount = failedNodes.length;

    let summary = `Successfully rendered ${successCount} node(s).`;
    if (failureCount > 0) {
      summary += ` Failed to render ${failureCount} node(s): ${failedNodes.join(", ")}. This may occur if the node doesn't exist, is invisible, has 0% opacity, or has no renderable components.`;
    }

    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              summary,
              images,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    Logger.error(`Error rendering node images from ${params.fileKey}:`, error);
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: `Failed to render node images: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    };
  }
}

export const renderNodeImagesTool = {
  name: "render_node_images",
  description: "Renders specified nodes from a Figma file as images to visualize how they appear.",
  parametersSchema,
  handler: renderNodeImages,
} as const;
