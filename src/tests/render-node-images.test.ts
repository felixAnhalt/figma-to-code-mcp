import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "~/mcp/index";
import { config } from "dotenv";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory";
import { Client } from "@modelcontextprotocol/sdk/client/index";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";

config();

describe.skipIf(process.env.RUN_FIGMA_INTEGRATION !== "1")(
  "Render Node Images Tool",
  () => {
    let server: McpServer;
    let client: Client;
    const figmaApiKey = process.env.FIGMA_API_KEY || "";
    const figmaFileKey = process.env.FIGMA_FILE_KEY || "";
    const nodeId = process.env.FIGMA_NODE_ID || "";

    beforeAll(async () => {
      server = createServer({
        figmaApiKey,
        figmaOAuthToken: "",
        useOAuth: false,
      });

      client = new Client({
        name: "figma-render-test-client",
        version: "1.0.0",
      });

      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    });

    afterAll(async () => {
      await client.close();
    });

    it("should render a node and return a map of node IDs to image URLs", async () => {
      console.log("\n=== RENDER NODE IMAGES TEST ===\n");
      console.log(`File Key: ${figmaFileKey}`);
      console.log(`Node ID: ${nodeId}\n`);

      if (!nodeId) {
        throw new Error("FIGMA_NODE_ID environment variable is required. Check your .env file.");
      }

      const args = {
        fileKey: figmaFileKey,
        nodeIds: [nodeId],
      };

      console.log(`Calling render_node_images with nodeIds: ${JSON.stringify(args.nodeIds)}\n`);

      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "render_node_images",
            arguments: args,
          },
        },
        CallToolResultSchema,
      );

      expect(result.isError).toBeFalsy();

      const firstContent = result.content[0];
      const content = firstContent.type === "text" ? firstContent.text : "";
      const parsed = JSON.parse(content);

      console.log("Response structure:");
      console.log(`  - summary: ${parsed.summary}`);
      console.log(`  - images: ${Object.keys(parsed.images).length} node(s)\n`);

      // Verify response structure
      expect(parsed).toBeDefined();
      expect(parsed.summary).toBeDefined();
      expect(typeof parsed.summary).toBe("string");
      expect(parsed.images).toBeDefined();
      expect(typeof parsed.images).toBe("object");

      // Check that at least one node ID is in the response
      // Note: Figma API normalizes node IDs (e.g., "273-30945" becomes "273:30945")
      const responseNodeIds = Object.keys(parsed.images);
      expect(responseNodeIds.length).toBeGreaterThan(0);

      const renderedNodeId = responseNodeIds[0];
      const imageUrl = parsed.images[renderedNodeId];

      console.log(`Image URL for node ${renderedNodeId}:`);
      if (imageUrl === null) {
        console.log(
          "  - null (render failed - node may be invisible, have 0% opacity, or not exist)\n",
        );
        console.log("✓ Null value correctly returned for failed render\n");
      } else {
        console.log(`  - ${imageUrl}\n`);
        expect(typeof imageUrl).toBe("string");
        expect(imageUrl).toMatch(/^https?:\/\//);
        console.log("✓ Valid image URL returned\n");
      }

      console.log("=== TEST COMPLETE ===\n");
    }, 60000);

    it("should handle multiple node IDs", async () => {
      console.log("\n=== RENDER MULTIPLE NODES TEST ===\n");

      if (!nodeId) {
        throw new Error("FIGMA_NODE_ID environment variable is required. Check your .env file.");
      }

      // Use the same node twice to test multiple IDs
      const args = {
        fileKey: figmaFileKey,
        nodeIds: [nodeId, nodeId],
      };

      console.log(`Calling render_node_images with nodeIds: ${JSON.stringify(args.nodeIds)}\n`);

      const result = await client.request(
        {
          method: "tools/call",
          params: {
            name: "render_node_images",
            arguments: args,
          },
        },
        CallToolResultSchema,
      );

      expect(result.isError).toBeFalsy();

      const firstContent = result.content[0];
      const content = firstContent.type === "text" ? firstContent.text : "";
      const parsed = JSON.parse(content);

      expect(parsed.images).toBeDefined();

      // Check that at least one node ID is in the response
      // Note: Figma API normalizes node IDs (e.g., "273-30945" becomes "273:30945")
      const responseNodeIds = Object.keys(parsed.images);
      expect(responseNodeIds.length).toBeGreaterThan(0);

      console.log(`✓ Received rendered images for ${responseNodeIds.length} node(s)\n`);
      console.log("=== TEST COMPLETE ===\n");
    }, 60000);
  },
  300000,
);
