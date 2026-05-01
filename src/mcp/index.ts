import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FigmaService, type FigmaAuthOptions } from "~/services/figmaConnector";
import { Logger } from "~/utils/logger";
import {
  getFigmaDesignTool,
  getImageFillsTool,
  renderNodeImagesTool,
  type GetFigmaDesignParams,
  type GetImageFillsParams,
  type RenderNodeImagesParams,
} from "~/mcp/tools";
import { fetchVariables } from "~/figma/fetch";
import { buildResolutionContext, mergeResolutionContext } from "~/figma/variableResolver";
import type { VariableResolutionContext } from "~/figma/variableResolver";
import {
  readLibraryCache,
  writeLibraryCache,
  type LibraryCacheOptions,
} from "~/figma/libraryCache";

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
  svgOutputDir?: string;
  libraryFileKeys?: string[];
  libraryCacheOptions?: LibraryCacheOptions;
};

async function prefetchLibraryVariables(
  fileKeys: string[],
  authHeaders: Record<string, string>,
  cacheOptions?: LibraryCacheOptions,
): Promise<VariableResolutionContext | null> {
  if (fileKeys.length === 0) return null;

  // Try disk cache first
  if (cacheOptions) {
    const cached = readLibraryCache(fileKeys, cacheOptions);
    if (cached) return cached;
  }

  Logger.log(`[Library Prefetch] Prefetching variables from ${fileKeys.length} library file(s)...`);

  const results = await Promise.allSettled(fileKeys.map((key) => fetchVariables(key, authHeaders)));

  const merged: VariableResolutionContext = {
    variableValues: new Map(),
    variableNames: new Map(),
    activeModes: new Map(),
  };

  let successCount = 0;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const key = fileKeys[i];
    if (result.status === "rejected") {
      Logger.warn(
        `[Library Prefetch] Failed to fetch variables for library ${key}:`,
        result.reason,
      );
      continue;
    }
    const response = result.value;
    if (
      !response ||
      !response.meta.variables ||
      Object.keys(response.meta.variables).length === 0
    ) {
      Logger.warn(`[Library Prefetch] No variables found in library ${key}`);
      continue;
    }
    const ctx = buildResolutionContext(response);
    mergeResolutionContext(merged, ctx);
    successCount++;
    Logger.log(
      `[Library Prefetch] Loaded ${ctx.variableValues.size} variables from library ${key}`,
    );
  }

  if (successCount === 0) return null;

  Logger.log(
    `[Library Prefetch] Done — ${merged.variableValues.size} total variables across ${successCount} library file(s)`,
  );

  // Persist to disk for future restarts
  if (cacheOptions) {
    writeLibraryCache(merged, fileKeys, cacheOptions);
  }

  return merged;
}

async function createServer(
  authOptions: FigmaAuthOptions,
  {
    isHTTP = false,
    outputFormat = "yaml",
    skipImageDownloads = false,
    svgOutputDir,
    libraryFileKeys = [],
    libraryCacheOptions,
  }: CreateServerOptions = {},
) {
  const server = new McpServer(serverInfo);
  const figmaService = new FigmaService(authOptions);

  const authHeaders = figmaService.getAuthHeaders();
  const preloadedVariableContext = await prefetchLibraryVariables(
    libraryFileKeys,
    authHeaders,
    libraryCacheOptions,
  );

  registerTools(server, figmaService, {
    outputFormat,
    skipImageDownloads,
    svgOutputDir,
    preloadedVariableContext,
  });

  Logger.isHTTP = isHTTP;

  return server;
}

function registerTools(
  server: McpServer,
  figmaService: FigmaService,
  options: {
    outputFormat: "yaml" | "json";
    skipImageDownloads: boolean;
    svgOutputDir?: string;
    preloadedVariableContext?: VariableResolutionContext | null;
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
      getFigmaDesignTool.handler(
        params,
        figmaService,
        options.outputFormat,
        params.svgOutputDir || options.svgOutputDir,
        options.preloadedVariableContext,
      ),
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
