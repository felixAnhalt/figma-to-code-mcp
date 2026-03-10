import { z } from "zod";
import type { FigmaService } from "~/services/figma.js";
import { generateMCPResponse, fetchStyles, fetchComponents } from "~/figma/index.js";
import yaml from "js-yaml";
import { Logger, writeLogs } from "~/utils/logger.js";

const parameters = {
  fileKey: z
    .string()
    .regex(/^[a-zA-Z0-9]+$/, "File key must be alphanumeric")
    .describe(
      "The key of the Figma file to fetch, often found in a provided URL like figma.com/(file|design)/<fileKey>/...",
    ),
  nodeId: z
    .string()
    .regex(
      /^I?\d+[:|-]\d+(?:;\d+[:|-]\d+)*$/,
      "Node ID must be like '1234:5678' or 'I5666:180910;1:10515;1:10336'",
    )
    .describe(
      "The ID of the node to fetch, often found as URL parameter node-id=<nodeId>, always use if provided. Use format '1234:5678' or 'I5666:180910;1:10515;1:10336' for multiple nodes.",
    ),
};

const parametersSchema = z.object(parameters);
export type GetFigmaDesignParams = z.infer<typeof parametersSchema>;

/**
 * New unified Figma tool that fetches complete design data with:
 * - Full layout information
 * - All styling (fills, strokes, effects, text)
 * - Flexbox primitives for auto-layout
 * - Component relationships
 * - Deduplicated paints
 */
async function getFigmaDesign(
  params: GetFigmaDesignParams,
  figmaService: FigmaService,
  outputFormat: "yaml" | "json",
) {
  try {
    const { fileKey, nodeId: rawNodeId } = parametersSchema.parse(params);

    // Replace - with : in nodeId for Figma API
    const nodeId = rawNodeId.replace(/-/g, ":");

    Logger.log(`Fetching design data for node ${nodeId} from file ${fileKey}`);

    // Get auth token from figmaService
    const token = figmaService.getToken();

    // Fetch styles and components in parallel
    Logger.log("Fetching styles and components...");
    const [styleMap, componentMap] = await Promise.all([
      fetchStyles(fileKey, token),
      fetchComponents(fileKey, token),
    ]);

    Logger.log(
      `Found ${Object.keys(styleMap).length} styles and ${Object.keys(componentMap).length} components`,
    );

    // Generate normalized MCP response
    Logger.log("Building normalized graph...");
    const mcpResponse = await generateMCPResponse({
      fileKey,
      token,
      rootNodeId: nodeId,
      styleMap,
      componentMap,
    });

    writeLogs("figma-mcp-response.json", mcpResponse);

    Logger.log(
      `Successfully extracted: ${Object.keys(mcpResponse.nodes).length} nodes${mcpResponse.variables ? `, ${Object.keys(mcpResponse.variables).length} variables` : ""}`,
    );

    Logger.log(`Generating ${outputFormat.toUpperCase()} result`);
    const formattedResult =
      outputFormat === "json" ? JSON.stringify(mcpResponse) : yaml.dump(mcpResponse);

    Logger.log("Sending result to client");
    return {
      content: [{ type: "text" as const, text: formattedResult }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    Logger.error(`Error fetching design:`, message);
    return {
      isError: true,
      content: [{ type: "text" as const, text: `Error fetching design: ${message}` }],
    };
  }
}

// Export tool configuration
export const getFigmaDesignTool = {
  name: "get_figma_design",
  description:
    "Get complete Figma design data with full layout, styling, Flexbox primitives, and component relationships. Returns normalized graph optimized for LLM code generation.",
  parametersSchema,
  handler: getFigmaDesign,
} as const;
