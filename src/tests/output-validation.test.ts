import { describe, it, expect, beforeAll } from "vitest";
import { buildNormalizedGraph } from "~/figma/reducer";

describe.skipIf(process.env.RUN_BENCHMARK_TESTS !== "1")(
  "Normalized graph output validation (v3)",
  () => {
    // This test requires testfigmaresult.json fixture
    // Run locally only: RUN_BENCHMARK_TESTS=1 pnpm test -- output-validation
    let testData: any;

    beforeAll(async () => {
      // Dynamically import fixture
      const imported = await import("./resources/testfigmaresult.json", {
        with: { type: "json" },
      });
      testData = imported.default;
    });

    function getRootNode() {
      const nodeId = Object.keys(testData.nodes as any)[0];
      return (testData.nodes as any)[nodeId];
    }

    it("produces v3 schema with a root node object", () => {
      const normalized = buildNormalizedGraph(getRootNode(), {});

      expect(normalized.schema).toBe("v3");
      expect(normalized.root).toBeDefined();
      expect(typeof normalized.root).toBe("object");
      // No flat nodes map
      expect(normalized).not.toHaveProperty("nodes");
    });

    it("root node has correct type and name from raw document", () => {
      const rawNode = getRootNode();
      const normalized = buildNormalizedGraph(rawNode, {});

      expect(normalized.root.type).toBe(rawNode.document.type);
      expect(normalized.root.name).toBe(rawNode.document.name);
      // No parent field — redundant with tree nesting
      expect(normalized.root).not.toHaveProperty("parent");
    });

    it("does not include absoluteBoundingBox — layout is flex-based", () => {
      const normalized = buildNormalizedGraph(getRootNode(), {});
      const str = JSON.stringify(normalized);
      expect(str).not.toContain("absoluteBoundingBox");
    });

    it("auto-layout nodes use layout.direction instead of top-level display/flexDirection", () => {
      const rawNode = getRootNode();
      const normalized = buildNormalizedGraph(rawNode, {});

      function checkNodes(node: any) {
        // v3 must not have legacy flat CSS properties at top level
        expect(node).not.toHaveProperty("display");
        expect(node).not.toHaveProperty("flexDirection");
        expect(node).not.toHaveProperty("parent");
        if (node.children) node.children.forEach(checkNodes);
      }
      checkNodes(normalized.root);
    });

    it("does not include stylesPayload or paints dict", () => {
      const normalized = buildNormalizedGraph(getRootNode(), {});
      expect(normalized).not.toHaveProperty("stylesPayload");
      expect(normalized).not.toHaveProperty("paints");
      expect(normalized).not.toHaveProperty("variables");
      expect(normalized).not.toHaveProperty("components");
    });

    it("solid fill on non-text nodes is style.background as rgba string", () => {
      const normalized = buildNormalizedGraph(getRootNode(), {});

      function findNodeWithBackground(node: any): any | undefined {
        if (node.style?.background && typeof node.style.background === "string") return node;
        for (const child of node.children ?? []) {
          const found = findNodeWithBackground(child);
          if (found) return found;
        }
        return undefined;
      }

      const nodeWithBg = findNodeWithBackground(normalized.root);
      if (nodeWithBg) {
        expect(typeof nodeWithBg.style.background).toBe("string");
        expect(nodeWithBg.style.background).toMatch(/^rgba\(/);
        // Should NOT be a flat backgroundColor
        expect(nodeWithBg).not.toHaveProperty("backgroundColor");
      }
    });

    it("TEXT nodes have style.color not style.background", () => {
      const normalized = buildNormalizedGraph(getRootNode(), {});

      function checkTextNodes(node: any) {
        if (node.type === "TEXT") {
          expect(node.style?.background).toBeUndefined();
          expect(node).not.toHaveProperty("backgroundColor");
        }
        if (node.children) node.children.forEach(checkTextNodes);
      }
      checkTextNodes(normalized.root);
    });

    it("TEXT nodes have text content at node.text", () => {
      const normalized = buildNormalizedGraph(getRootNode(), {});

      function findTextNode(node: any): any | undefined {
        if (node.type === "TEXT") return node;
        for (const child of node.children ?? []) {
          const found = findTextNode(child);
          if (found) return found;
        }
        return undefined;
      }

      const textNode = findTextNode(normalized.root);
      if (textNode) {
        expect(textNode.text).toBeDefined();
        expect(typeof textNode.text).toBe("string");
      }
    });

    it("opacity defaults are omitted (no opacity:1 in output)", () => {
      const normalized = buildNormalizedGraph(getRootNode(), {});

      function checkNodes(node: any) {
        if (node.style?.opacity !== undefined) {
          expect(node.style.opacity).not.toBe(1);
        }
        if (node.children) node.children.forEach(checkNodes);
      }
      checkNodes(normalized.root);
    });

    it("blendMode defaults are omitted", () => {
      const normalized = buildNormalizedGraph(getRootNode(), {});

      function checkNodes(node: any) {
        if (node.style?.blend !== undefined) {
          expect(node.style.blend).not.toBe("NORMAL");
          expect(node.style.blend).not.toBe("PASS_THROUGH");
        }
        if (node.children) node.children.forEach(checkNodes);
      }
      checkNodes(normalized.root);
    });

    it("INSTANCE nodes have id and component fields", () => {
      const normalized = buildNormalizedGraph(getRootNode(), {});

      function findInstance(node: any): any | undefined {
        if (node.type === "INSTANCE") return node;
        for (const child of node.children ?? []) {
          const found = findInstance(child);
          if (found) return found;
        }
        return undefined;
      }

      const inst = findInstance(normalized.root);
      if (inst) {
        expect(inst.id).toBeDefined();
        expect(inst.component).toBeDefined();
        expect(inst).not.toHaveProperty("componentId");
      }
    });

    it("no VARIABLE_ALIAS strings remain unresolved", () => {
      const normalized = buildNormalizedGraph(getRootNode(), {});
      const str = JSON.stringify(normalized);
      expect(str).not.toContain("VARIABLE_ALIAS");
    });
  },
);
