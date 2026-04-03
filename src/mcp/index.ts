import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FigmaService, type FigmaAuthOptions } from "../services/figma.js";
import { Logger } from "../utils/logger.js";
import {
  getFigmaDesignTool,
  getImageFillsTool,
  renderNodeImagesTool,
  type GetFigmaDesignParams,
  type GetImageFillsParams,
  type RenderNodeImagesParams,
} from "./tools/index.js";

const serverInfo = {
  name: "Figma MCP Server",
  version: process.env.NPM_PACKAGE_VERSION ?? "unknown",
  description:
    "Gives AI coding agents access to Figma design data, providing layout, styling, and content information for implementing designs.",
};

type CreateServerOptions = {
  isHTTP?: boolean;
  outputFormat?: "yaml" | "json";
  skipImageDownloads?: boolean;
};

function createServer(
  authOptions: FigmaAuthOptions,
  { isHTTP = false, outputFormat = "yaml", skipImageDownloads = false }: CreateServerOptions = {},
) {
  const server = new McpServer(serverInfo);
  const figmaService = new FigmaService(authOptions);
  registerTools(server, figmaService, { outputFormat, skipImageDownloads });

  Logger.isHTTP = isHTTP;

  return server;
}

function registerTools(
  server: McpServer,
  figmaService: FigmaService,
  options: {
    outputFormat: "yaml" | "json";
    skipImageDownloads: boolean;
  },
): void {
  server.registerTool(
    getFigmaDesignTool.name,
    {
      title: "Get Figma Design",
      description: getFigmaDesignTool.description,
      inputSchema: getFigmaDesignTool.parametersSchema,
      annotations: { readOnlyHint: true },
    },
    (params: GetFigmaDesignParams) =>
      getFigmaDesignTool.handler(params, figmaService, options.outputFormat),
  );

  if (!options.skipImageDownloads) {
    server.registerTool(
      getImageFillsTool.name,
      {
        title: "Get Image Fills",
        description: getImageFillsTool.description,
        inputSchema: getImageFillsTool.parametersSchema,
        annotations: { readOnlyHint: true },
      },
      (params: GetImageFillsParams) => getImageFillsTool.handler(params, figmaService),
    );

    server.registerTool(
      renderNodeImagesTool.name,
      {
        title: "Render Node Images",
        description: renderNodeImagesTool.description,
        inputSchema: renderNodeImagesTool.parametersSchema,
        annotations: { readOnlyHint: true },
      },
      (params: RenderNodeImagesParams) => renderNodeImagesTool.handler(params, figmaService),
    );
  }
}

export { createServer };
