import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { getFigmaDesignTool } from "~/mcp/tools/get-figma-design-tool";
import { FigmaService } from "~/services/figma";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

config();

describe.skipIf(process.env.RUN_FIGMA_INTEGRATION !== "1")(
  "Live Figma Optimization Test (v3)",
  () => {
    const figmaApiKey = process.env.FIGMA_API_KEY || "";
    const figmaFileKey = process.env.FIGMA_FILE_KEY || "";
    const nodeId = process.env.FIGMA_NODE_ID || "";

    it("compares raw Figma API response vs optimized v3 MCP response", async () => {
      console.log("\n=== LIVE FIGMA OPTIMIZATION TEST (V3) ===\n");
      console.log(`File Key: ${figmaFileKey}`);
      console.log(`Node ID: ${nodeId}\n`);

      if (!figmaApiKey) {
        throw new Error("FIGMA_API_KEY environment variable is required. Check your .env file.");
      }

      const figmaService = new FigmaService({
        figmaApiKey,
        figmaOAuthToken: "",
        useOAuth: false,
      });

      // 1. Fetch and save RAW Figma API response for size comparison
      console.log("Fetching raw Figma API response...");
      let rawResponse;
      try {
        rawResponse = await figmaService.getRawFile(figmaFileKey, 2);
      } catch (error) {
        throw new Error(
          `Failed to fetch Figma file. Check that FIGMA_API_KEY and FIGMA_FILE_KEY are correct in .env file. Error: ${error}`,
        );
      }

      const rawSize = JSON.stringify(rawResponse).length;
      console.log(`✓ Raw response size: ${rawSize.toLocaleString()} bytes\n`);

      const resourcesDir = path.join(process.cwd(), "src", "tests", "resources");
      if (!fs.existsSync(resourcesDir)) {
        fs.mkdirSync(resourcesDir, { recursive: true });
      }
      fs.writeFileSync(
        path.join(resourcesDir, "live-raw-response.json"),
        JSON.stringify(rawResponse, null, 2),
      );

      // 2. Call the actual MCP tool handler — identical code path the LLM hits
      console.log("Calling getFigmaDesign tool handler (same path as the LLM)...");
      const toolResult = await getFigmaDesignTool.handler(
        { fileKey: figmaFileKey, nodeId, resolveVariables: true, decompress: true },
        figmaService,
        "json",
      );

      expect(toolResult.isError).toBeFalsy();
      const resultText = (toolResult.content[0] as { type: "text"; text: string }).text;
      const mcpResponse = JSON.parse(resultText);

      const optimizedSize = resultText.length;
      console.log(`✓ Optimized response size: ${optimizedSize.toLocaleString()} bytes\n`);

      // Save fixtures — JSON for inspection, YAML matching what the LLM actually receives
      fs.writeFileSync(
        path.join(resourcesDir, "live-optimized-response.json"),
        JSON.stringify(mcpResponse, null, 2),
      );
      fs.writeFileSync(
        path.join(resourcesDir, "live-optimized-response.yaml"),
        yaml.dump(mcpResponse),
      );

      // 3. Report reduction
      const reduction = ((rawSize - optimizedSize) / rawSize) * 100;
      const saved = rawSize - optimizedSize;

      console.log("\n=== OPTIMIZATION RESULTS (V3) ===\n");
      console.log(`Raw Figma Response:      ${rawSize.toLocaleString()} bytes`);
      console.log(`Optimized MCP Response:  ${optimizedSize.toLocaleString()} bytes`);
      console.log(
        `Reduction:               ${reduction.toFixed(1)}% (${saved.toLocaleString()} bytes saved)\n`,
      );

      // 4. Verify v3 structure
      console.log("=== V3 STRUCTURE VERIFICATION ===\n");

      expect(mcpResponse.schema).toBe("v3");
      expect(mcpResponse.root).toBeDefined();
      expect(typeof mcpResponse.root).toBe("object");

      expect(mcpResponse).not.toHaveProperty("nodes");
      expect(mcpResponse).not.toHaveProperty("variables");
      expect(mcpResponse).not.toHaveProperty("components");
      expect(mcpResponse).not.toHaveProperty("paints");
      expect(mcpResponse).not.toHaveProperty("stylesPayload");
      console.log("✓ No flat nodes/variables/components/paints dicts");

      function countNodes(node: any): number {
        return 1 + (node.children ?? []).reduce((s: number, c: any) => s + countNodes(c), 0);
      }
      function findInstances(node: any): any[] {
        const result: any[] = node.type === "INSTANCE" ? [node] : [];
        return result.concat(...(node.children ?? []).map(findInstances));
      }
      function findTextNodes(node: any): any[] {
        const result: any[] = node.type === "TEXT" ? [node] : [];
        return result.concat(...(node.children ?? []).map(findTextNodes));
      }

      const nodeCount = countNodes(mcpResponse.root);
      const instanceNodes = findInstances(mcpResponse.root);
      const textNodes = findTextNodes(mcpResponse.root);
      const componentSetCount = mcpResponse.componentSets
        ? Object.keys(mcpResponse.componentSets).length
        : 0;

      console.log(`✓ Total nodes in tree:       ${nodeCount}`);
      console.log(`✓ INSTANCE nodes:            ${instanceNodes.length}`);
      console.log(`✓ TEXT nodes:                ${textNodes.length}`);
      console.log(`✓ Component sets:            ${componentSetCount}`);

      // Verify componentSets shape — definitions must be absent (converted + deleted)
      expect(mcpResponse).not.toHaveProperty("definitions");
      if (componentSetCount > 0) {
        const firstSet = Object.values(mcpResponse.componentSets)[0];
        expect(firstSet).toHaveProperty("name");
        expect(firstSet).toHaveProperty("variants");
        expect(firstSet).toHaveProperty("propKeys");
        console.log(`✓ componentSets shape is correct`);
      }

      // Verify tokens shape
      if (mcpResponse.tokens) {
        const tokenCategories = Object.keys(mcpResponse.tokens);
        const totalTokens = Object.values(mcpResponse.tokens).reduce(
          (n: number, cat: unknown) => n + Object.keys(cat as Record<string, unknown>).length,
          0,
        );
        console.log(`✓ Token categories:          ${tokenCategories.join(", ")}`);
        console.log(`✓ Total tokens:              ${totalTokens}`);
        expect(totalTokens).toBeGreaterThan(0);
      } else {
        console.log(`  (no tokens extracted — design may not repeat values)`);
      }

      for (const textNode of textNodes) {
        expect(textNode.style?.background).toBeUndefined();
      }
      console.log("✓ TEXT nodes have no background");

      const responseStr = JSON.stringify(mcpResponse);
      const aliasCount = (responseStr.match(/VARIABLE_ALIAS/g) || []).length;
      console.log(`✓ Unresolved VARIABLE_ALIAS: ${aliasCount} (should be 0)`);
      expect(aliasCount).toBe(0);

      expect(responseStr).not.toContain('"display":"flex"');
      expect(responseStr).not.toContain('"flexDirection"');
      console.log("✓ No legacy display/flexDirection at top level");

      expect(optimizedSize).toBeLessThan(rawSize);
      console.log(`\n✓ Size reduction: ${reduction.toFixed(1)}%`);

      console.log("\n=== TEST COMPLETE ===\n");
    });
  },
  90000,
);
