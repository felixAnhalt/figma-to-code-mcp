import { z } from "zod";
import type { FigmaService } from "~/services/figmaConnector";
import { generateMCPResponse, extractTokens } from "~/figma";
import { externalizeComponentSets } from "~/figma/mcp/componentSetFiles";
import yaml from "js-yaml";
import { Logger, writeLogs } from "~/utils/logger";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VariableResolutionContext } from "~/figma/variableResolver";

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
  includeComponentVariants: z
    .boolean()
    .default(false)
    .describe(
      "Set true only when building components from a component library: also returns every other variant of each component this design uses (all sizes, colors, and states), with their props and any visuals that can be fetched. Each component set is written as a JSON file in componentSetsFolder and listed in componentSets by name, with its propKeys and propValues. A large set becomes a folder there with index.json and one JSON file per variant, named by node id. Leave false when rebuilding this design; the response is smaller and faster.",
    ),
  svgOutputDir: z
    .string()
    .optional()
    .describe("Directory to save SVG assets to. Defaults to system temp directory."),
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
  svgOutputDir?: string,
  preloadedVariableContext?: VariableResolutionContext | null,
) {
  try {
    const {
      fileKey,
      nodeId: rawNodeId,
      resolveVariables,
      includeComponentVariants,
    } = parametersSchema.parse(params);

    // Use provided svgOutputDir or default to temp directory
    const outputDir = svgOutputDir || join(tmpdir(), "figma-mcp-files");

    // Replace - with : in nodeId for Figma API
    const nodeId = rawNodeId.replace(/-/g, ":");

    Logger.log(`Fetching design data for node ${nodeId} from file ${fileKey}`);

    const authHeaders = figmaService.getAuthHeaders();

    // Generate normalized MCP response — component map resolution happens internally
    Logger.log("Building normalized graph...");
    const mcpResponse = await generateMCPResponse({
      fileKey,
      authHeaders,
      rootNodeId: nodeId,
      resolveVariables,
      includeComponentVariants,
      svgOutputDir: outputDir,
      preloadedVariableContext,
    });

    // Post-pass: extract design tokens and replace repeated raw values with refs
    Logger.log("Extracting design tokens...");
    const tokenizedResponse = extractTokens(mcpResponse);

    writeLogs("figma-mcp-response.json", tokenizedResponse);

    Logger.log(
      `Successfully extracted design tree${tokenizedResponse.componentSets ? `, ${Object.keys(tokenizedResponse.componentSets).length} component sets` : ""}${tokenizedResponse.tokens ? `, ${Object.values(tokenizedResponse.tokens).reduce((n, cat) => n + Object.keys(cat ?? {}).length, 0)} tokens` : ""}`,
    );

    Logger.log(`Generating ${outputFormat.toUpperCase()} result`);

    // Component sets need their tokens resolved, so they are written after tokenizing
    const response = includeComponentVariants
      ? await externalizeComponentSets(tokenizedResponse, outputDir)
      : tokenizedResponse;

    // Move svgAssetsFolder to the end of the response for better readability
    const svgAssetsFolder = response.svgAssetsFolder;
    delete response.svgAssetsFolder;
    if (svgAssetsFolder) {
      response.svgAssetsFolder = svgAssetsFolder;
    }

    const formattedResult =
      outputFormat === "json" ? JSON.stringify(response) : yaml.dump(response);

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
    "Get Figma layout, styling, text, components, and exported SVG assets. " +
    "Render textRuns instead of duplicating text; expand base typography tokens before applying run overrides. " +
    "Preserve layout.position/left/top, per-edge borderWidths, and gradientHandlePositions. " +
    "SVG files are in svgAssetsFolder. Keep each node's layout footprint and place its asset at " +
    "svgViewport x/y using svgViewport width/height; do not stretch the expanded asset to the node's original size.",
  parametersSchema,
  handler: getFigmaDesign,
} as const;
