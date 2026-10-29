import { z } from "zod";
import type { FigmaService } from "~/services/figmaConnector";
import { generateMCPResponse, extractTokens } from "~/figma";
import { externalizeComponentSets } from "~/figma/mcp/componentSetFiles";
import { externalizeRootFrames } from "~/figma/mcp/frameFiles";
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
      "Set true only when building components from a component library: also returns every other variant of each component this design uses (all sizes, colors, and states), with their props and any visuals that can be fetched. Every component set is written as a YAML or JSON file, matching the output format, in componentSetsFolder and listed in componentSets by name, with its propKeys and propValues; a large set becomes a folder there with an index file and one file per variant, named by node id. Every `file` value is relative to componentSetsFolder. Leave false when rebuilding this design; the response is smaller and faster.",
    ),
  svgOutputDir: z
    .string()
    .optional()
    .describe("Directory to save SVG assets to. Defaults to system temp directory."),
};

const parametersSchema = z.object(parameters);
export type GetFigmaDesignParams = z.infer<typeof parametersSchema>;

const ASSET_FIELDS = [
  "svgAssetsFolder",
  "renderedDesignNodeAssetsFolder",
  "renderedDesignNodePathInAssetFolder",
] as const;
type AssetField = (typeof ASSET_FIELDS)[number];

export type FigmaDesignRequestOptions = {
  outputFormat: "yaml" | "json";
  svgOutputDir?: string;
  preloadedVariableContext?: VariableResolutionContext | null;
  renderImage: boolean;
};

async function renderRootNodeImageUrl(
  figmaService: FigmaService,
  fileKey: string,
  nodeId: string,
): Promise<string | null> {
  const images = await figmaService.renderNodeImages(fileKey, [nodeId]);
  return images[nodeId] ?? null;
}

/** Moves asset locations to the end of the response, after the design tree, for readability. */
function moveAssetFieldsToEnd(response: Partial<Record<AssetField, string>>): void {
  for (const field of ASSET_FIELDS) {
    const value = response[field];
    if (value === undefined) continue;
    delete response[field];
    response[field] = value;
  }
}

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
  options: FigmaDesignRequestOptions,
) {
  try {
    const {
      fileKey,
      nodeId: rawNodeId,
      resolveVariables,
      includeComponentVariants,
    } = parametersSchema.parse(params);

    // Use provided svgOutputDir or default to temp directory
    const outputDir = options.svgOutputDir || join(tmpdir(), "figma-mcp-files");

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
      preloadedVariableContext: options.preloadedVariableContext,
      fetchRenderedImageUrl: options.renderImage
        ? () => renderRootNodeImageUrl(figmaService, fileKey, nodeId)
        : undefined,
    });

    // Post-pass: extract design tokens and replace repeated raw values with refs
    Logger.log("Extracting design tokens...");
    const tokenizedResponse = extractTokens(mcpResponse);

    writeLogs("figma-mcp-response.json", tokenizedResponse);

    Logger.log(
      `Successfully extracted design tree${tokenizedResponse.componentSets ? `, ${Object.keys(tokenizedResponse.componentSets).length} component sets` : ""}${tokenizedResponse.tokens ? `, ${Object.values(tokenizedResponse.tokens).reduce((n, cat) => n + Object.keys(cat ?? {}).length, 0)} tokens` : ""}`,
    );

    Logger.log(`Generating ${options.outputFormat.toUpperCase()} result`);

    // Component sets and frames need their tokens resolved, so they are written after tokenizing
    const componentSetsResponse = await externalizeComponentSets(
      tokenizedResponse,
      outputDir,
      options.outputFormat,
    );
    const response = await externalizeRootFrames(
      componentSetsResponse,
      outputDir,
      options.outputFormat,
    );

    moveAssetFieldsToEnd(response);

    const formattedResult =
      options.outputFormat === "json" ? JSON.stringify(response) : yaml.dump(response);

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
    "svgViewport x/y (an omitted x or y means 0) using svgViewport width/height; do not stretch the expanded asset to the node's original size. " +
    "Compare against the PNG render of the requested node at renderedDesignNodeAssetsFolder + renderedDesignNodePathInAssetFolder when present. " +
    "A large COMPONENT_SET root keeps its container here, and its variants are in root.file (an index file plus one file per variant). " +
    "A large SECTION root keeps each frame as a stub in root.children, and each frame's full design is in its file in framesFolder.",
  parametersSchema,
  handler: getFigmaDesign,
} as const;
