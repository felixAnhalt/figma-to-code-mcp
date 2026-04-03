import { z } from "zod";
import type { FigmaService } from "~/services/figma";
import { generateMCPResponse, fetchStyles } from "~/figma";
import { extractTokens } from "~/figma/tokenizer";
import { decompressTree } from "~/figma/compress";
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
  decompress: z
    .boolean()
    .default(false)
    .describe(
      "Whether to decompress repeated nodes. Default (false) returns v4 compressed format. Set to true for expanded v3 format (larger output, easier for some LLMs to parse).",
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
    const {
      fileKey,
      nodeId: rawNodeId,
      resolveVariables,
      decompress,
    } = parametersSchema.parse(params);

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
    let mcpResponse = await generateMCPResponse({
      fileKey,
      authHeaders,
      rootNodeId: nodeId,
      styleMap,
      resolveVariables,
    });

    // Post-pass: extract design tokens and replace repeated raw values with refs
    Logger.log("Extracting design tokens...");
    let tokenizedResponse = extractTokens(mcpResponse);

    // Optional decompression for LLMs that prefer expanded format
    if (decompress) {
      Logger.log("Decompressing repeated nodes...");
      tokenizedResponse.root = decompressTree(tokenizedResponse.root);
    }

    writeLogs("figma-mcp-response.json", tokenizedResponse);

    Logger.log(
      `Successfully extracted design tree${tokenizedResponse.componentSets ? `, ${Object.keys(tokenizedResponse.componentSets).length} component sets` : ""}${tokenizedResponse.tokens ? `, ${Object.values(tokenizedResponse.tokens).reduce((n, cat) => n + Object.keys(cat ?? {}).length, 0)} tokens` : ""}${decompress ? " (decompressed)" : " (v4 compressed)"}`,
    );

    Logger.log(`Generating ${outputFormat.toUpperCase()} result`);
    const formattedResult =
      outputFormat === "json" ? JSON.stringify(tokenizedResponse) : yaml.dump(tokenizedResponse);

    Logger.log("Sending result to client");

    return {
      content: [{ type: "text" as const, text: formattedResult }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    const stack = error instanceof Error ? error.stack : "";
    Logger.error(`Error fetching design:`, message);
    if (stack) Logger.error(`Stack:`, stack);
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
