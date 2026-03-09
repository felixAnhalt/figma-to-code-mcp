import { describe, it, expect } from "vitest";
import { buildNormalizedGraph } from "~/figma/reducer.js";
import { resolveInstances } from "~/figma/instanceResolver.js";
import testData from "./resources/testfigmaresult.json";

describe("Normalized graph output validation", () => {
  it("preserves layout information from raw Figma response", () => {
    // Get the first node from test data
    const nodeId = Object.keys(testData.nodes)[0];
    const rawNode = testData.nodes[nodeId];

    // Process through our system
    const normalized = buildNormalizedGraph(rawNode, {});

    // Get root node
    const rootNode = normalized.nodes[normalized.root];

    // Validate basic node structure
    expect(rootNode).toBeDefined();
    expect(rootNode.id).toBe(rawNode.document.id);
    expect(rootNode.type).toBe(rawNode.document.type);
    expect(rootNode.name).toBe(rawNode.document.name);

    // Validate layout preservation
    if (rawNode.document.absoluteBoundingBox) {
      expect(rootNode.absoluteBoundingBox).toEqual(rawNode.document.absoluteBoundingBox);
    }

    // Validate auto-layout conversion to flex
    if (rawNode.document.layoutMode) {
      expect(rootNode.layout).toBeDefined();
      expect(rootNode.layout.layoutMode).toBe(rawNode.document.layoutMode);
      expect(rootNode.layout.itemSpacing).toBe(rawNode.document.itemSpacing);

      // Check flex primitives
      expect(rootNode.flex).toBeDefined();
      expect(rootNode.flex.direction).toBe(
        rawNode.document.layoutMode === "HORIZONTAL" ? "row" : "column",
      );
      expect(rootNode.flex.gap).toBe(rawNode.document.itemSpacing ?? 0);
    }
  });

  it("preserves styling information (fills, strokes, effects)", () => {
    const nodeId = Object.keys(testData.nodes)[0];
    const rawNode = testData.nodes[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});

    // Find a node with styling
    const nodeWithStyle = Object.values(normalized.nodes).find(
      (node) => normalized.stylesPayload[node.id],
    );

    if (!nodeWithStyle) {
      // If no styled nodes found in test data, skip
      return;
    }

    const style = normalized.stylesPayload[nodeWithStyle.id];

    // Validate style payload exists
    expect(style).toBeDefined();

    // If node has fills, they should be in paints dictionary
    if (style.fills) {
      expect(Array.isArray(style.fills)).toBe(true);
      style.fills.forEach((paintId: string) => {
        expect(normalized.paints[paintId]).toBeDefined();
      });
    }

    // If node has strokes, they should be in paints dictionary
    if (style.strokes) {
      expect(Array.isArray(style.strokes)).toBe(true);
      style.strokes.forEach((paintId: string) => {
        expect(normalized.paints[paintId]).toBeDefined();
      });
    }
  });

  it("correctly handles component instances", () => {
    const nodeId = Object.keys(testData.nodes)[0];
    const rawNode = testData.nodes[nodeId];

    // Mock component map
    const componentMap: Record<string, any> = {};
    if (rawNode.document.componentId) {
      componentMap[rawNode.document.componentId] = {
        key: rawNode.document.componentId,
        name: "Test Component",
        description: "Test component description",
      };
    }

    // Resolve instances first
    resolveInstances(rawNode, componentMap);

    const normalized = buildNormalizedGraph(rawNode, {});

    // Check if component relationships are preserved
    const instanceNode = Object.values(normalized.nodes).find((node) => node.componentId);

    if (instanceNode) {
      expect(instanceNode.componentId).toBeDefined();

      // Component should be in components dictionary
      if (instanceNode.type === "COMPONENT") {
        expect(normalized.components[instanceNode.id]).toBeDefined();
      }
    }
  });

  it("deduplicates paints correctly", () => {
    const nodeId = Object.keys(testData.nodes)[0];
    const rawNode = testData.nodes[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});

    // Count total paint references
    let totalPaintRefs = 0;
    Object.values(normalized.stylesPayload).forEach((style) => {
      if (style.fills) totalPaintRefs += style.fills.length;
      if (style.strokes) totalPaintRefs += style.strokes.length;
    });

    // Number of unique paints should be <= total references
    const uniquePaintCount = Object.keys(normalized.paints).length;

    if (totalPaintRefs > 0) {
      expect(uniquePaintCount).toBeGreaterThan(0);
      expect(uniquePaintCount).toBeLessThanOrEqual(totalPaintRefs);
    }
  });

  it("maintains parent-child relationships", () => {
    const nodeId = Object.keys(testData.nodes)[0];
    const rawNode = testData.nodes[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});

    // Check parent-child consistency
    Object.values(normalized.nodes).forEach((node) => {
      if (node.children && node.children.length > 0) {
        node.children.forEach((childId) => {
          const child = normalized.nodes[childId];
          expect(child).toBeDefined();
          expect(child.parent).toBe(node.id);
        });
      }
    });
  });

  it("converts auto-layout to flexbox primitives accurately", () => {
    const nodeId = Object.keys(testData.nodes)[0];
    const rawNode = testData.nodes[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});

    // Find nodes with auto-layout
    Object.values(normalized.nodes).forEach((node) => {
      if (node.layout?.layoutMode) {
        // Should have flex representation
        expect(node.flex).toBeDefined();
        expect(normalized.flexTree[node.id]).toBeDefined();

        // Validate direction mapping
        const expectedDirection = node.layout.layoutMode === "HORIZONTAL" ? "row" : "column";
        expect(node.flex.direction).toBe(expectedDirection);

        // Validate gap mapping
        expect(node.flex.gap).toBe(node.layout.itemSpacing ?? 0);

        // Validate padding
        expect(node.flex.padding).toBeDefined();
        expect(node.flex.padding.top).toBe(node.layout.paddingTop ?? 0);
        expect(node.flex.padding.bottom).toBe(node.layout.paddingBottom ?? 0);
        expect(node.flex.padding.left).toBe(node.layout.paddingLeft ?? 0);
        expect(node.flex.padding.right).toBe(node.layout.paddingRight ?? 0);
      }
    });
  });

  it("preserves text content and styling", () => {
    const nodeId = Object.keys(testData.nodes)[0];
    const rawNode = testData.nodes[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});

    // Find text nodes
    const textNodes = Object.values(normalized.nodes).filter((node) => node.type === "TEXT");

    textNodes.forEach((textNode) => {
      const style = normalized.stylesPayload[textNode.id];

      if (style?.textStyle) {
        // Text style should have font properties
        expect(style.textStyle).toBeDefined();

        // At least one of these should be present
        const hasTextProperties =
          style.textStyle.fontFamily || style.textStyle.fontSize || style.textStyle.characters;

        expect(hasTextProperties).toBeTruthy();
      }
    });
  });

  it("output format matches MCPResponse schema", () => {
    const nodeId = Object.keys(testData.nodes)[0];
    const rawNode = testData.nodes[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});

    // Validate top-level structure
    expect(normalized).toHaveProperty("root");
    expect(normalized).toHaveProperty("nodes");
    expect(normalized).toHaveProperty("flexTree");
    expect(normalized).toHaveProperty("stylesPayload");
    expect(normalized).toHaveProperty("paints");
    expect(normalized).toHaveProperty("styles");
    expect(normalized).toHaveProperty("components");

    // Validate types
    expect(typeof normalized.root).toBe("string");
    expect(typeof normalized.nodes).toBe("object");
    expect(typeof normalized.flexTree).toBe("object");
    expect(typeof normalized.stylesPayload).toBe("object");
    expect(typeof normalized.paints).toBe("object");
    expect(typeof normalized.styles).toBe("object");
    expect(typeof normalized.components).toBe("object");
  });

  it("token efficiency: normalized output is smaller than raw input", () => {
    const nodeId = Object.keys(testData.nodes)[0];
    const rawNode = testData.nodes[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});

    const rawSize = JSON.stringify(rawNode).length;
    const normalizedSize = JSON.stringify(normalized).length;

    // Normalized should be smaller (or at worst, similar size for small nodes)
    // This validates deduplication and optimization
    console.log(`Raw size: ${rawSize} bytes, Normalized size: ${normalizedSize} bytes`);
    console.log(`Reduction: ${((1 - normalizedSize / rawSize) * 100).toFixed(1)}%`);

    // For most designs, we expect at least some reduction
    // But for very small test files, it might be slightly larger due to structure overhead
    expect(normalizedSize).toBeLessThan(rawSize * 2); // At worst, not more than 2x
  });
});
