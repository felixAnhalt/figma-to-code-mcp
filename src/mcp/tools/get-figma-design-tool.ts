import { z } from "zod";
import type { FigmaService } from "~/services/figma";
import { generateMCPResponse, fetchStyles } from "~/figma";
import yaml from "js-yaml";
import { Logger, writeLogs } from "~/utils/logger";

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
  resolveVariables: z
    .boolean()
    .default(true)
    .describe(
      "Whether to resolve variable references to their actual values. Set to false if already fetched once.",
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
    const { fileKey, nodeId: rawNodeId, resolveVariables } = parametersSchema.parse(params);

    // Replace - with : in nodeId for Figma API
    const nodeId = rawNodeId.replace(/-/g, ":");

    Logger.log(`Fetching design data for node ${nodeId} from file ${fileKey}`);

    const authHeaders = figmaService.getAuthHeaders();

    // Fetch styles (component maps are built internally by generateMCPResponse)
    Logger.log("Fetching styles...");
    const styleMap = await fetchStyles(fileKey, authHeaders);

    Logger.log(`Found ${Object.keys(styleMap).length} styles`);

    // Generate normalized MCP response — component map resolution happens internally
    Logger.log("Building normalized graph...");
    const mcpResponse = await generateMCPResponse({
      fileKey,
      authHeaders,
      rootNodeId: nodeId,
      styleMap,
      resolveVariables,
    });

    writeLogs("figma-mcp-response.json", mcpResponse);

    Logger.log(
      `Successfully extracted design tree${mcpResponse.definitions ? `, ${Object.keys(mcpResponse.definitions).length} component definitions` : ""}`,
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
