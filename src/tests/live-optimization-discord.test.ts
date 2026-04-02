import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { getFigmaDesignTool } from "~/mcp/tools/get-figma-design-tool.js";
import { FigmaService } from "~/services/figma.js";
import fs from "fs";
import path from "path";
import yaml from "js-yaml";

config();

describe.skipIf(process.env.RUN_FIGMA_INTEGRATION !== "1")(
  "Live Figma Optimization Test — Discord Library (Phase 2 Enrichment)",
  () => {
    const figmaApiKey = process.env.FIGMA_API_KEY || "";
    // Discord library: Ultimate Discord Library (Community)
    const discordFileKey = "ImtkPKGXgnbcb9KiB0Ggfa";
    // General canvas with 357 components
    const discordNodeId = "1:10";

    it("tests Phase 2 enrichment with accessible component library", async () => {
      console.log("\n=== LIVE FIGMA OPTIMIZATION TEST — DISCORD LIBRARY (PHASE 2) ===\n");
      console.log(`File Key: ${discordFileKey} (Ultimate Discord Library)`);
      console.log(`Node ID: ${discordNodeId} (General canvas)\n`);

      if (!figmaApiKey) {
        throw new Error("FIGMA_API_KEY environment variable is required. Check your .env file.");
      }

      const figmaService = new FigmaService({
        figmaApiKey,
        figmaOAuthToken: "",
        useOAuth: false,
      });

      const resourcesDir = path.join(process.cwd(), "src", "tests", "resources");
      if (!fs.existsSync(resourcesDir)) {
        fs.mkdirSync(resourcesDir, { recursive: true });
      }

      // 1. Call the actual MCP tool handler — same code path as the LLM
      console.log("Calling getFigmaDesign tool handler (same path as the LLM)...");
      const toolResult = await getFigmaDesignTool.handler(
        { fileKey: discordFileKey, nodeId: discordNodeId },
        figmaService,
        "json",
      );

      expect(toolResult.isError).toBeFalsy();
      const resultText = (toolResult.content[0] as { type: "text"; text: string }).text;
      const mcpResponse = JSON.parse(resultText);

      const optimizedSize = resultText.length;
      console.log(`✓ Optimized response size: ${optimizedSize.toLocaleString()} bytes\n`);
      // save
      fs.writeFileSync(
        path.join(resourcesDir, "live-optimized-response-discord.yaml"),
        yaml.dump(mcpResponse),
      );

      // 2. Verify v3 structure
      console.log("=== V3 STRUCTURE VERIFICATION (DISCORD LIBRARY) ===\n");

      expect(mcpResponse.schema).toBe("v3");
      expect(mcpResponse.root).toBeDefined();
      expect(typeof mcpResponse.root).toBe("object");

      expect(mcpResponse).not.toHaveProperty("nodes");
      expect(mcpResponse).not.toHaveProperty("variables");
      expect(mcpResponse).not.toHaveProperty("components");
      expect(mcpResponse).not.toHaveProperty("paints");
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
      const defCount = mcpResponse.definitions ? Object.keys(mcpResponse.definitions).length : 0;

      console.log(`✓ Total nodes in tree:       ${nodeCount}`);
      console.log(`✓ INSTANCE nodes:            ${instanceNodes.length}`);
      console.log(`✓ TEXT nodes:                ${textNodes.length}`);
      console.log(`✓ Component definitions:     ${defCount}`);

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

      // 5. PHASE 2 SPECIFIC CHECKS — verify enrichment worked
      console.log("\n=== PHASE 2 ENRICHMENT VERIFICATION ===\n");

      const definitions = mcpResponse.definitions ?? {};
      const definitionsList = Object.entries(definitions);

      console.log(`Total definitions: ${definitionsList.length}`);

      // Count definitions with different enrichment levels
      const defsWithChildren = definitionsList.filter(([_, d]: any) => d.children?.length > 0);
      const defsWithLayout = definitionsList.filter(([_, d]: any) => d.layout);
      const defsWithStyle = definitionsList.filter(([_, d]: any) => d.style);
      const defsWithVariants = definitionsList.filter(([_, d]: any) => d.variants);

      console.log(
        `✓ Definitions with children:       ${defsWithChildren.length} / ${definitionsList.length}`,
      );
      console.log(
        `✓ Definitions with layout:         ${defsWithLayout.length} / ${definitionsList.length}`,
      );
      console.log(
        `✓ Definitions with style:          ${defsWithStyle.length} / ${definitionsList.length}`,
      );
      console.log(
        `✓ Definitions with variants:       ${defsWithVariants.length} / ${definitionsList.length}`,
      );

      // Phase 2 should have populated at least some definitions with children
      // (since this is the library file itself, and it's accessible)
      if (defsWithChildren.length > 0) {
        console.log(
          `\n✓ Phase 2 enrichment succeeded — found ${defsWithChildren.length} definitions with children from library source`,
        );
      } else {
        console.log(
          `\n⚠ Phase 2 enrichment: no definitions have children (Phase 0/1 data only, or library access blocked)`,
        );
      }

      // 6. Verify new fields (sizing mode, grow, interactions)
      console.log("\n=== NEW FIELD VERIFICATION ===\n");

      let nodeWithSizingH = 0;
      let nodeWithSizingV = 0;
      let nodeWithGrow = 0;
      let nodeWithInteractions = 0;

      function walkNodes(node: any) {
        if (node.layout?.sizingH) nodeWithSizingH++;
        if (node.layout?.sizingV) nodeWithSizingV++;
        if (node.layout?.grow) nodeWithGrow++;
        if (node.interactions?.length > 0) nodeWithInteractions++;
        if (node.children) {
          node.children.forEach(walkNodes);
        }
      }

      walkNodes(mcpResponse.root);

      console.log(`✓ Nodes with sizingH:        ${nodeWithSizingH}`);
      console.log(`✓ Nodes with sizingV:        ${nodeWithSizingV}`);
      console.log(`✓ Nodes with grow:           ${nodeWithGrow}`);
      console.log(`✓ Nodes with interactions:   ${nodeWithInteractions}`);

      // Expect at least some sizing information
      expect(nodeWithSizingH + nodeWithSizingV).toBeGreaterThan(0);

      console.log(`\n✓ Optimized response size: ${optimizedSize.toLocaleString()} bytes`);

      console.log("\n=== TEST COMPLETE ===\n");
    });
  },
);
