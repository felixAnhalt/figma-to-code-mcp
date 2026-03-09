import { describe, it, expect } from "vitest";
import { buildNormalizedGraph } from "~/figma/reducer.js";
import testData from "./resources/testfigmaresult.json" with { type: "json" };

describe("Normalized graph output validation (v2 - CSS-aligned)", () => {
  it("preserves basic node structure from raw Figma response", () => {
    const nodeId = Object.keys(testData.nodes as any)[0];
    const rawNode = (testData.nodes as any)[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});

    const rootNode = normalized.nodes[normalized.root];

    expect(rootNode).toBeDefined();
    expect(rootNode.id).toBe(rawNode.document.id);
    expect(rootNode.type).toBe(rawNode.document.type);
    expect(rootNode.name).toBe(rawNode.document.name);
    expect(rootNode.parent).toBeNull();
  });

  it("does not include absoluteBoundingBox (v2 removes it)", () => {
    const nodeId = Object.keys(testData.nodes as any)[0];
    const rawNode = (testData.nodes as any)[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});

    const rootNode = normalized.nodes[normalized.root];

    // v2 removes bounding boxes - layout is defined by flex properties
    expect(rootNode).not.toHaveProperty("absoluteBoundingBox");
  });

  it("converts auto-layout to CSS flexbox properties", () => {
    const nodeId = Object.keys(testData.nodes as any)[0];
    const rawNode = (testData.nodes as any)[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});

    const rootNode = normalized.nodes[normalized.root];

    if (rawNode.document.layoutMode) {
      // Should have CSS properties
      expect(rootNode.display).toBe("flex");
      expect(rootNode.flexDirection).toBe(
        rawNode.document.layoutMode === "HORIZONTAL" ? "row" : "column",
      );

      // Should NOT have old 'layout' or 'flex' objects
      expect(rootNode).not.toHaveProperty("layout");
      expect(rootNode).not.toHaveProperty("flex");
    }
  });

  it("includes styles inline in nodes (no separate stylesPayload)", () => {
    const nodeId = Object.keys(testData.nodes as any)[0];
    const rawNode = (testData.nodes as any)[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});

    // v2 does not have stylesPayload - styles are inline
    expect(normalized).not.toHaveProperty("stylesPayload");
    expect(normalized).not.toHaveProperty("paints");

    // Find a node with fills
    const nodeWithFills = Object.values(normalized.nodes).find(
      (node) => node.backgroundColor || node.background,
    );

    if (nodeWithFills) {
      // Solid colors should be inline RGBA strings
      if (nodeWithFills.backgroundColor) {
        expect(typeof nodeWithFills.backgroundColor).toBe("string");
        expect(nodeWithFills.backgroundColor).toMatch(/^(rgba\(|$)/);
      }

      // Gradients should be Paint objects
      if (nodeWithFills.background) {
        expect(Array.isArray(nodeWithFills.background)).toBe(true);
        expect(nodeWithFills.background[0]).toHaveProperty("type");
      }
    }
  });

  it("preserves component metadata", () => {
    const nodeId = Object.keys(testData.nodes as any)[0];
    const rawNode = (testData.nodes as any)[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});

    // v2 should still have components dictionary
    if (normalized.components && Object.keys(normalized.components).length > 0) {
      const firstComponent = Object.values(normalized.components)[0];
      expect(firstComponent).toHaveProperty("key");
      expect(firstComponent).toHaveProperty("name");
    }
  });

  it("includes variables dictionary when variables are used", () => {
    const nodeId = Object.keys(testData.nodes as any)[0];
    const rawNode = (testData.nodes as any)[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});

    // If variables exist, they should be in variables dictionary
    if (normalized.variables) {
      expect(typeof normalized.variables).toBe("object");

      // Variables should be used somewhere in the nodes
      const hasVariableRef = Object.values(normalized.nodes).some(
        (node) =>
          (typeof node.backgroundColor === "string" && node.backgroundColor.startsWith("$")) ||
          (typeof node.color === "string" && node.color.startsWith("$")),
      );

      if (Object.keys(normalized.variables).length > 0) {
        expect(hasVariableRef).toBe(true);
      }
    }
  });

  it("preserves parent-child relationships", () => {
    const nodeId = Object.keys(testData.nodes as any)[0];
    const rawNode = (testData.nodes as any)[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});

    const rootNode = normalized.nodes[normalized.root];

    if (rootNode.children && rootNode.children.length > 0) {
      const firstChildId = rootNode.children[0];
      const firstChild = normalized.nodes[firstChildId];

      expect(firstChild).toBeDefined();
      expect(firstChild.parent).toBe(rootNode.id);
    }
  });

  it("handles text nodes with inline text styles", () => {
    const nodeId = Object.keys(testData.nodes as any)[0];
    const rawNode = (testData.nodes as any)[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});

    const textNode = Object.values(normalized.nodes).find((node) => node.type === "TEXT");

    if (textNode) {
      // Text content should be inline
      expect(textNode.text).toBeDefined();

      // Text styles should be CSS properties
      if (textNode.fontFamily) expect(typeof textNode.fontFamily).toBe("string");
      if (textNode.fontSize) expect(typeof textNode.fontSize).toBe("number");
      if (textNode.fontWeight) expect(typeof textNode.fontWeight).toBe("number");
      if (textNode.color) {
        expect(typeof textNode.color).toBe("string");
        expect(textNode.color).toMatch(/^(rgba\(|$)/);
      }
    }
  });

  it("omits default values for token efficiency", () => {
    const nodeId = Object.keys(testData.nodes as any)[0];
    const rawNode = (testData.nodes as any)[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});

    // Find any node
    const anyNode = Object.values(normalized.nodes)[0];

    // Defaults should be omitted
    if (anyNode.visible !== false) {
      expect(anyNode).not.toHaveProperty("visible");
    }

    if (anyNode.opacity !== undefined) {
      // opacity should only exist if not 1
      expect(anyNode.opacity).not.toBe(1);
    }

    if (anyNode.blendMode) {
      // blendMode should only exist if not NORMAL/PASS_THROUGH
      expect(anyNode.blendMode).not.toBe("NORMAL");
      expect(anyNode.blendMode).not.toBe("PASS_THROUGH");
    }
  });

  it("generates valid response structure", () => {
    const nodeId = Object.keys(testData.nodes as any)[0];
    const rawNode = (testData.nodes as any)[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});

    // Response should have required fields
    expect(normalized).toHaveProperty("root");
    expect(normalized).toHaveProperty("nodes");
    expect(typeof normalized.root).toBe("string");
    expect(typeof normalized.nodes).toBe("object");

    // Optional fields
    if (normalized.variables) expect(typeof normalized.variables).toBe("object");
    if (normalized.components) expect(typeof normalized.components).toBe("object");
  });
});
