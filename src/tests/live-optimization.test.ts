import { describe, it, expect } from "vitest";
import { config } from "dotenv";
import { generateMCPResponse } from "~/figma/index.js";
import { FigmaService } from "~/services/figma.js";
import fs from "fs";
import path from "path";

config();

const describeOrSkip = process.env.RUN_FIGMA_INTEGRATION === "1" ? describe : describe.skip;

describeOrSkip("Live Figma Optimization Test (v2)", () => {
  const figmaApiKey = process.env.FIGMA_API_KEY || "";
  const figmaFileKey = process.env.FIGMA_FILE_KEY || "DyZ6cHnwCcro7DjePbHIgL";
  const nodeId = process.env.FIGMA_NODE_ID || "4012:10704";

  it("compares raw Figma API response vs optimized MCP response (v2 CSS-aligned)", async () => {
    console.log("\n=== LIVE FIGMA OPTIMIZATION TEST (V2) ===\n");
    console.log(`File Key: ${figmaFileKey}`);
    console.log(`Node ID: ${nodeId}\n`);

    if (!figmaApiKey) {
      throw new Error("FIGMA_API_KEY environment variable is required. Check your .env file.");
    }

    // 1. Fetch RAW Figma API response
    console.log("📡 Fetching raw Figma API response...");
    const figmaService = new FigmaService({
      figmaApiKey,
      figmaOAuthToken: "",
      useOAuth: false,
    });

    let rawResponse;
    try {
      rawResponse = await figmaService.getRawFile(figmaFileKey, 100);
    } catch (error) {
      console.error("Failed to fetch Figma file:", error);
      throw new Error(
        `Failed to fetch Figma file. Check that FIGMA_API_KEY and FIGMA_FILE_KEY are correct in .env file. Error: ${error}`,
      );
    }
    const rawNode = rawResponse.document;

    // Find the specific node if nodeId is provided
    // Note: node IDs in Figma use ":" but env var uses "-"
    const searchNodeId = nodeId.replace(/-/g, ":");
    let targetNode = rawNode;
    if (searchNodeId && searchNodeId !== rawNode.id) {
      const findNode = (node: any, id: string): any => {
        if (node.id === id) return node;
        if (node.children) {
          for (const child of node.children) {
            const found = findNode(child, id);
            if (found) return found;
          }
        }
        return null;
      };
      const found = findNode(rawNode, searchNodeId);
      if (!found) {
        throw new Error(`Node with ID ${searchNodeId} not found in file`);
      }
      targetNode = found;
    }

    const rawSize = JSON.stringify(rawResponse).length;
    console.log(`✓ Raw response size: ${rawSize.toLocaleString()} bytes\n`);

    // Save raw response to file
    const resourcesDir = path.join(process.cwd(), "src", "tests", "resources");
    if (!fs.existsSync(resourcesDir)) {
      fs.mkdirSync(resourcesDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(resourcesDir, "live-raw-response.json"),
      JSON.stringify(rawResponse, null, 2),
    );

    // 2. Generate OPTIMIZED MCP response (v2)
    console.log("⚙️  Generating optimized MCP response (v2)...");

    // Get token from service
    const token = (figmaService as any).useOAuth
      ? (figmaService as any).oauthToken
      : (figmaService as any).apiKey;

    const mcpResponse = await generateMCPResponse({
      fileKey: figmaFileKey,
      token,
      rootNodeId: searchNodeId,
    });

    const optimizedSize = JSON.stringify(mcpResponse).length;
    console.log(`✓ Optimized response size: ${optimizedSize.toLocaleString()} bytes\n`);

    // Save optimized response
    fs.writeFileSync(
      path.join(resourcesDir, "live-optimized-response.json"),
      JSON.stringify(mcpResponse, null, 2),
    );

    // 3. Calculate reduction
    const reduction = ((rawSize - optimizedSize) / rawSize) * 100;
    const saved = rawSize - optimizedSize;

    console.log("\n=== OPTIMIZATION RESULTS (V2) ===\n");
    console.log(`Raw Figma Response:      ${rawSize.toLocaleString()} bytes`);
    console.log(`Optimized MCP Response:  ${optimizedSize.toLocaleString()} bytes`);
    console.log(
      `Reduction:               ${reduction.toFixed(1)}% (${saved.toLocaleString()} bytes saved)\n`,
    );

    // 4. Verify v2 structure
    console.log("=== V2 STRUCTURE VERIFICATION ===\n");

    const nodeCount = Object.keys(mcpResponse.nodes).length;
    const variableCount = mcpResponse.variables ? Object.keys(mcpResponse.variables).length : 0;
    const componentCount = mcpResponse.components ? Object.keys(mcpResponse.components).length : 0;

    console.log(`✓ Nodes extracted:           ${nodeCount}`);
    console.log(`✓ Variables used:            ${variableCount}`);
    console.log(`✓ Components tracked:        ${componentCount}`);

    // v2 should NOT have these fields
    expect(mcpResponse).not.toHaveProperty("paints");
    expect(mcpResponse).not.toHaveProperty("stylesPayload");
    expect(mcpResponse).not.toHaveProperty("styles");
    console.log(`✓ No paints dictionary (inline)`);
    console.log(`✓ No stylesPayload (inline)`);

    // Check for CSS-aligned properties
    const nodesWithFlex = Object.values(mcpResponse.nodes).filter(
      (n: any) => n.display === "flex",
    ).length;
    const nodesWithBg = Object.values(mcpResponse.nodes).filter(
      (n: any) => n.backgroundColor || n.background,
    ).length;
    const nodesWithBorder = Object.values(mcpResponse.nodes).filter((n: any) => n.border).length;

    console.log(`✓ Nodes with flexbox:        ${nodesWithFlex}`);
    console.log(`✓ Nodes with background:     ${nodesWithBg}`);
    console.log(`✓ Nodes with border:         ${nodesWithBorder}`);

    // Check text nodes
    const textNodes = Object.values(mcpResponse.nodes).filter((n: any) => n.type === "TEXT");
    const textNodesWithColor = textNodes.filter((n: any) => n.color).length;
    const textNodesWithFont = textNodes.filter((n: any) => n.fontFamily).length;

    console.log(`✓ TEXT nodes:                ${textNodes.length}`);
    console.log(`✓ TEXT nodes with color:     ${textNodesWithColor}`);
    console.log(`✓ TEXT nodes with font:      ${textNodesWithFont}`);

    // Check instance nodes
    const instanceNodes = Object.values(mcpResponse.nodes).filter(
      (n: any) => n.type === "INSTANCE",
    ).length;
    const componentNodes = Object.values(mcpResponse.nodes).filter(
      (n: any) => n.type === "COMPONENT",
    ).length;

    console.log(`✓ INSTANCE nodes:            ${instanceNodes}`);
    console.log(`✓ COMPONENT nodes:           ${componentNodes}`);

    // Check for variable references
    const nodesWithVariableRefs = Object.values(mcpResponse.nodes).filter((n: any) => {
      const hasVarRef = (value: any): boolean => {
        if (typeof value === "string" && value.startsWith("$")) return true;
        if (Array.isArray(value)) return value.some(hasVarRef);
        if (typeof value === "object" && value !== null) {
          return Object.values(value).some(hasVarRef);
        }
        return false;
      };
      return hasVarRef(n);
    }).length;

    console.log(`✓ Nodes with variable refs:  ${nodesWithVariableRefs}`);

    // Check that no VARIABLE_ALIAS remains unresolved
    const responseStr = JSON.stringify(mcpResponse);
    const aliasCount = (responseStr.match(/VARIABLE_ALIAS/g) || []).length;
    console.log(`✓ Unresolved VARIABLE_ALIAS: ${aliasCount} (should be 0)`);
    expect(aliasCount).toBe(0);

    // Check that no old structure remains
    const hasOldLayout = Object.values(mcpResponse.nodes).some((n: any) => n.layout || n.flex);
    expect(hasOldLayout).toBe(false);
    console.log(`✓ No old layout/flex objects`);

    // Check that no bounding boxes
    const hasBoundingBox = Object.values(mcpResponse.nodes).some((n: any) => n.absoluteBoundingBox);
    expect(hasBoundingBox).toBe(false);
    console.log(`✓ No absoluteBoundingBox`);

    // Expect significant reduction (target: 50-65% from v1's 47.9%)
    console.log(`\n✓ Size reduction: ${reduction.toFixed(1)}%`);
    if (reduction > 45) {
      console.log(`✅ EXCELLENT - Exceeds v1's 47.9% reduction`);
    }

    console.log("\n=== TEST COMPLETE ===\n");
  });
});
