import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FigmaService, type FigmaAuthOptions } from "~/services/figma";
import { Logger } from "~/utils/logger";
import {
  getFigmaDesignTool,
  getImageFillsTool,
  renderNodeImagesTool,
  readVectorSvgTool,
  saveVectorSvgsTool,
  type GetFigmaDesignParams,
  type GetImageFillsParams,
  type RenderNodeImagesParams,
  type ReadVectorSvgParams,
} from "~/mcp/tools";
import { registerVectorSvgResource } from "~/mcp/resources/vector-svg-resource";

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
  registerVectorSvgResource(server);

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

  server.registerTool(
    readVectorSvgTool.name,
    {
      title: "Read Vector SVG",
      description: readVectorSvgTool.description,
      inputSchema: readVectorSvgTool.parametersSchema,
      annotations: { readOnlyHint: true },
    },
    (params: ReadVectorSvgParams) => readVectorSvgTool.handler(params),
  );

  server.registerTool(
    saveVectorSvgsTool.name,
    {
      title: "Save Vector SVGs to Files",
      description: saveVectorSvgsTool.description,
      inputSchema: saveVectorSvgsTool.parametersSchema,
      annotations: { readOnlyHint: false },
    },
    (params: { uris: string[] }) => saveVectorSvgsTool.handler(params),
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
