import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolveVectorUri } from "~/figma/svg-writer";
import { Logger } from "~/utils/logger";

const VECTOR_SVG_RESOURCE_NAME = "figma-vector-svg";
const VECTOR_SVG_URI_TEMPLATE = "figma://vector/{key}";

/**
 * Registers the figma://vector/{key} resource template on the MCP server.
 *
 * When an LLM requests a URI matching this template, the handler resolves the
 * key to SVG content from the in-memory cache (populated by svg-writer during
 * graph reduction) and returns the SVG content as an image/svg+xml resource.
 *
 * If the URI is not found in the cache, the handler returns an error resource
 * rather than throwing.
 */
export function registerVectorSvgResource(server: McpServer): void {
  const template = new ResourceTemplate(VECTOR_SVG_URI_TEMPLATE, { list: undefined });

  server.registerResource(
    VECTOR_SVG_RESOURCE_NAME,
    template,
    {
      description:
        "SVG geometry for a Figma VECTOR node. Requested via figma://vector/{fileKey}_{nodeId}.",
      mimeType: "image/svg+xml",
    },
    async (uri) => {
      const uriString = uri.toString();
      const svgContent = await resolveVectorUri(uriString);

      if (!svgContent) {
        Logger.warn(`[vector-svg-resource] Could not resolve URI: ${uriString}`);
        return {
          contents: [
            {
              uri: uriString,
              mimeType: "text/plain",
              text: `Could not resolve vector URI: ${uriString}`,
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: uriString,
            mimeType: "image/svg+xml",
            text: svgContent,
          },
        ],
      };
    },
  );
}
