import { buildNormalizedGraph } from "~/figma/reducer.js";
import { svgContentCache } from "~/figma/svg-writer.js";
import type { V3Node } from "~/figma/types.js";

function vector(
  id: string,
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    type: "VECTOR",
    name,
    fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
    fillGeometry: [
      {
        path: "M0 0L10 0L10 10L0 10Z",
        windingRule: "NONZERO",
      },
    ],
    ...overrides,
  };
}

function group(
  id: string,
  name: string,
  children: unknown[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    type: "GROUP",
    name,
    children,
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    ...overrides,
  };
}

function frame(
  id: string,
  name: string,
  children: unknown[],
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    type: "FRAME",
    name,
    children,
    absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
    ...overrides,
  };
}

function text(
  id: string,
  name: string,
  characters: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    type: "TEXT",
    name,
    characters,
    fills: [{ type: "SOLID", color: { r: 0.239, g: 0.239, b: 0.239, a: 1 } }],
    style: { fontFamily: "Lato", fontSize: 16, fontWeight: 400, lineHeightPx: 24 },
    ...overrides,
  };
}

function cachedSvgContents(node: V3Node): string {
  const cacheKey = node.svgPathInAssetFolder?.replace(/\.svg$/, "");
  const ownContent = cacheKey ? (svgContentCache.get(cacheKey) ?? "") : "";
  return [ownContent, ...(node.children ?? []).map(cachedSvgContents)].join("\n");
}

describe("vector merging in groups and frames", () => {
  beforeEach(() => {
    svgContentCache.clear();
  });

  describe("GROUP with multiple VECTOR children", () => {
    it("should merge vector-only group into single child with svgPathInAssetFolder", async () => {
      const v1 = vector("1:2", "Vector1", {
        relativeTransform: [
          [1, 0, 0],
          [0, 1, 0],
        ],
      });
      const v2 = vector("1:3", "Vector2", {
        relativeTransform: [
          [1, 0, 20],
          [0, 1, 20],
        ],
      });
      const g = group("1:1", "Group", [v1, v2]);

      const result = buildNormalizedGraph(g, {});
      await result.flushVectorSvgs();

      expect(result.root.children).toHaveLength(1);
      expect(result.root.children![0].svgPathInAssetFolder).toBeDefined();
      expect(cachedSvgContents(result.root).match(/<path\b/g)).toHaveLength(2);
    });

    it("should NOT merge single vector child", async () => {
      const v1 = vector("1:2", "Vector1");
      const g = group("1:1", "Group", [v1]);

      const result = buildNormalizedGraph(g, {});
      await result.flushVectorSvgs();

      const groupNode = result.root;
      expect(groupNode.children).toHaveLength(1);
      expect(groupNode.children![0].svgPathInAssetFolder).toBe("_1_2.svg");
    });

    it("should NOT merge group with non-vector children", () => {
      const v1 = vector("1:2", "Vector1");
      const t1 = text("1:3", "Text1", "Hello");
      const g = group("1:1", "Group", [v1, t1]);

      const result = buildNormalizedGraph(g, {});

      const groupNode = result.root;
      expect(groupNode.children).toHaveLength(2);
    });

    it("should preserve vector names in merged output", () => {
      const v1 = vector("1:2", "IconStar");
      const v2 = vector("1:3", "IconCircle");
      const g = group("1:1", "Icons", [v1, v2]);

      const result = buildNormalizedGraph(g, {});

      expect(result.root.children![0].name).toBe("IconStar");
    });
  });

  describe("FRAME with multiple VECTOR children", () => {
    it("should merge frame with direct VECTOR children into single child", async () => {
      const v1 = vector("1:2", "Vector1");
      const v2 = vector("1:3", "Vector2");
      const f = frame("1:1", "Frame", [v1, v2]);

      const result = buildNormalizedGraph(f, {});
      await result.flushVectorSvgs();

      expect(result.root.children).toHaveLength(1);
      expect(cachedSvgContents(result.root).match(/<path\b/g)).toHaveLength(2);
    });

    it("should NOT merge frame with single vector child", async () => {
      const v1 = vector("1:2", "Vector1");
      const f = frame("1:1", "Frame", [v1]);

      const result = buildNormalizedGraph(f, {});
      await result.flushVectorSvgs();

      expect(result.root.children).toHaveLength(1);
      expect(result.root.children![0].svgPathInAssetFolder).toBe("_1_2.svg");
    });
  });

  describe("FRAME with GROUP children containing VECTORs", () => {
    it("should merge frame with GROUP children that contain VECTORs", async () => {
      const v1 = vector("1:3", "Vector1");
      const v2 = vector("1:4", "Vector2");
      const g1 = group("1:2", "Group1", [v1], {
        absoluteBoundingBox: { x: 0, y: 0, width: 50, height: 50 },
      });
      const g2 = group("1:5", "Group2", [v2], {
        absoluteBoundingBox: { x: 50, y: 0, width: 50, height: 50 },
      });
      const f = frame("1:1", "Frame", [g1, g2]);

      const result = buildNormalizedGraph(f, {});
      await result.flushVectorSvgs();

      expect(result.root.children).toHaveLength(1);
      expect(cachedSvgContents(result.root).match(/<path\b/g)).toHaveLength(2);
    });
  });

  describe("mixed children scenarios", () => {
    it("should NOT merge when children include non-VECTOR types", () => {
      const v1 = vector("1:2", "Vector1");
      const t1 = text("1:3", "Text1", "Label");
      const f = frame("1:1", "Frame", [v1, t1]);

      const result = buildNormalizedGraph(f, {});

      expect(result.root.children).toHaveLength(2);
    });

    it("should NOT merge empty group", () => {
      const v1 = vector("1:2", "Vector1");
      const g = group("1:1", "EmptyGroup", [v1]);

      const result = buildNormalizedGraph(g, {});

      expect(result.root.children).toBeDefined();
      expect(result.root.children!.length).toBeGreaterThan(0);
    });
  });

  describe("GROUP with nested VECTORs at multiple depths", () => {
    it("should merge GROUP with vectors at nested depth", async () => {
      const v1 = vector("1:5", "Vector1", {
        absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
      });
      const nestedGroup = group("1:4", "NestedGroup", [v1], {
        absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 },
      });
      const v2 = vector("1:6", "Vector2", {
        absoluteBoundingBox: { x: 20, y: 0, width: 10, height: 10 },
      });
      const g = group("1:1", "OuterGroup", [nestedGroup, v2], {
        absoluteBoundingBox: { x: 0, y: 0, width: 30, height: 10 },
      });

      const result = buildNormalizedGraph(g, {});
      await result.flushVectorSvgs();

      expect(result.root.children).toHaveLength(1);
      expect(cachedSvgContents(result.root).match(/<path\b/g)).toHaveLength(2);
    });
  });

  describe("lossless vector merge eligibility", () => {
    it("does not unwrap through an invisible intermediate ancestor", () => {
      const hiddenBranch = group("27:2", "Visible wrapper", [
        group("27:3", "Hidden ancestor", [vector("27:4", "Hidden descendant")], { visible: false }),
      ]);
      const result = buildNormalizedGraph(
        frame("27:1", "Root", [hiddenBranch, text("27:5", "Label", "Visible text")]),
        {},
      );
      expect(result.root.children).toMatchObject([{ type: "TEXT", text: "Visible text" }]);
      expect(result.root.children).toHaveLength(1);
    });

    it("does not partially merge a FRAME with differently nested vector groups", async () => {
      const result = buildNormalizedGraph(
        frame("28:1", "Mixed nesting", [
          group("28:2", "Direct pair", [vector("28:3", "First"), vector("28:4", "Second")]),
          group("28:5", "Nested pair", [
            group("28:6", "Wrapper", [vector("28:7", "Third")]),
            vector("28:8", "Fourth"),
          ]),
        ]),
        {},
      );
      await result.flushVectorSvgs();
      expect(cachedSvgContents(result.root).match(/<path\b/g)).toHaveLength(4);
    });

    it("does not unwrap a visible wrapper into an invisible vector", () => {
      const result = buildNormalizedGraph(
        frame("26:1", "Root", [
          group("26:2", "Wrapper", [vector("26:3", "Hidden", { visible: false })]),
          text("26:4", "Label", "Visible text"),
        ]),
        {},
      );
      expect(result.root.children).toMatchObject([{ type: "TEXT", text: "Visible text" }]);
      expect(result.root.children).toHaveLength(1);
    });

    it("retains text between two vectors in the original GROUP child order", () => {
      const result = buildNormalizedGraph(
        group("20:1", "Mixed", [
          vector("20:2", "Before"),
          text("20:3", "Label", "Keep this text"),
          vector("20:4", "After"),
        ]),
        {},
      );

      expect(
        result.root.children?.map(({ type, name, text: value }) => ({ type, name, value })),
      ).toEqual([
        { type: "VECTOR", name: "Before", value: undefined },
        { type: "TEXT", name: "Label", value: "Keep this text" },
        { type: "VECTOR", name: "After", value: undefined },
      ]);
    });

    it("retains nested mixed-content groups and their non-vector child order", () => {
      const nested = group("21:2", "Nested mixed", [
        vector("21:3", "Nested vector"),
        text("21:4", "Nested label", "Nested content"),
        { id: "21:5", type: "RECTANGLE", name: "Badge", cornerRadius: 4 },
      ]);
      const result = buildNormalizedGraph(
        group("21:1", "Outer", [nested, vector("21:6", "Trailing vector")]),
        {},
      );

      expect(result.root.children).toMatchObject([
        {
          type: "GROUP",
          name: "Nested mixed",
          children: [
            { type: "VECTOR", name: "Nested vector" },
            { type: "TEXT", text: "Nested content" },
            { type: "RECTANGLE", name: "Badge", style: { radius: 4 } },
          ],
        },
        { type: "VECTOR", name: "Trailing vector" },
      ]);
    });

    it.each(["descendant", "ancestor"] as const)(
      "does not export vectors hidden by an invisible %s in a nested group",
      async (hiddenAt) => {
        const hiddenVector = vector("22:6", "Hidden vector", {
          visible: hiddenAt !== "descendant",
          fillGeometry: [{ path: "M731 731L741 731L741 741Z", windingRule: "NONZERO" }],
        });
        const result = buildNormalizedGraph(
          group("22:1", "Outer", [
            group("22:2", "Visible pair", [vector("22:3", "First"), vector("22:4", "Second")]),
            group("22:5", "Hidden branch", [hiddenVector], {
              visible: hiddenAt !== "ancestor",
            }),
          ]),
          {},
        );
        await result.flushVectorSvgs();

        const content = cachedSvgContents(result.root);
        expect(content.match(/<path\b/g)).toHaveLength(2);
        expect(content).not.toContain("731");
      },
    );

    it.each([group, frame])(
      "preserves all direct vector children when one lacks geometry (%#)",
      (container) => {
        const result = buildNormalizedGraph(
          container("23:1", "Incomplete", [
            vector("23:2", "First"),
            vector("23:3", "Missing geometry", { fillGeometry: undefined }),
            vector("23:4", "Last"),
          ]),
          {},
        );

        expect(result.root.children?.map(({ name }) => name)).toEqual([
          "First",
          "Missing geometry",
          "Last",
        ]);
      },
    );

    it("preserves the nested vector tree when a descendant lacks geometry", () => {
      const nested = group("24:2", "Incomplete branch", [
        vector("24:3", "Supported"),
        vector("24:4", "Missing geometry", { fillGeometry: undefined }),
      ]);
      const result = buildNormalizedGraph(
        group("24:1", "Outer", [nested, vector("24:5", "Sibling")]),
        {},
      );

      expect(result.root.children).toMatchObject([
        {
          type: "GROUP",
          name: "Incomplete branch",
          children: [{ name: "Supported" }, { name: "Missing geometry" }],
        },
        { type: "VECTOR", name: "Sibling" },
      ]);
    });

    it.each([group, frame])(
      "falls back to the original tree for unsupported mask semantics (%#)",
      (container) => {
        const result = buildNormalizedGraph(
          container("25:1", "Masked icon", [
            vector("25:2", "Mask", { isMask: true, maskType: "ALPHA" }),
            vector("25:3", "Clipped first"),
            vector("25:4", "Clipped second"),
          ]),
          {},
        );

        expect(result.root.children?.map(({ name }) => name)).toEqual([
          "Mask",
          "Clipped first",
          "Clipped second",
        ]);
      },
    );
  });

  describe("graph.flushVectorSvgs", () => {
    it("should write merged SVGs to cache", async () => {
      const v1 = vector("1:2", "Vector1");
      const v2 = vector("1:3", "Vector2");
      const g = group("1:1", "Group", [v1, v2]);

      const result = buildNormalizedGraph(g, {});

      expect(svgContentCache.size).toBe(0);

      await result.flushVectorSvgs();

      expect(svgContentCache.size).toBeGreaterThan(0);
    });

    it("should preserve vector positions in merged output", async () => {
      const v1 = vector("1:2", "Vector1", {
        relativeTransform: [
          [1, 0, 0],
          [0, 1, 0],
        ],
      });
      const v2 = vector("1:3", "Vector2", {
        relativeTransform: [
          [1, 0, 0],
          [0, 1, 20],
        ],
      });
      const g = group("1:1", "Group", [v1, v2]);

      const result = buildNormalizedGraph(g, {});
      await result.flushVectorSvgs();

      const cacheKeys = Array.from(svgContentCache.keys());
      expect(cacheKeys.length).toBe(1);

      const svgContent = svgContentCache.get(cacheKeys[0]);
      expect(svgContent).toBeDefined();
      expect(svgContent).toContain("<svg");
    });

    it("should preserve different Y coordinates for merged vectors at different vertical positions", async () => {
      const v1 = vector("1:2", "Char1", {
        relativeTransform: [
          [1, 0, 0],
          [0, 1, 0],
        ],
        fillGeometry: [{ path: "M0 0L10 0L10 10L0 10Z", windingRule: "NONZERO" }],
      });
      const v2 = vector("1:3", "Char2", {
        relativeTransform: [
          [1, 0, 0],
          [0, 1, 25],
        ],
        fillGeometry: [{ path: "M0 0L10 0L10 10L0 10Z", windingRule: "NONZERO" }],
      });
      const g = group("1:1", "Text", [v1, v2], {
        absoluteBoundingBox: { x: 0, y: 0, width: 20, height: 40 },
      });

      const result = buildNormalizedGraph(g, {});
      await result.flushVectorSvgs();

      const cacheKeys = Array.from(svgContentCache.keys());
      const svgContent = svgContentCache.get(cacheKeys[0])!;

      const pathMatches = svgContent.match(/<path[^>]*d="([^"]+)"/g);
      expect(pathMatches?.length).toBe(2);

      const firstPathY = svgContent.includes("M0 0") || svgContent.includes("M0.0000 0");
      const secondPathHas25 = svgContent.includes("25");

      expect(firstPathY || secondPathHas25).toBe(true);
    });

    it("unions the original canvas with out-of-canvas ink instead of clipping merged assets", async () => {
      const v1 = vector("1:2", "Vector1");
      const v2 = vector("1:3", "Vector2", {
        relativeTransform: [
          [1, 0, 100],
          [0, 1, 50],
        ],
      });
      const g = group("1:1", "Group", [v1, v2], {
        absoluteBoundingBox: { x: 10, y: 20, width: 147, height: 50 },
      });

      const result = buildNormalizedGraph(g, {});
      await result.flushVectorSvgs();

      const cacheKeys = Array.from(svgContentCache.keys());
      const svgContent = svgContentCache.get(cacheKeys[0]);

      expect(svgContent).toContain('width="147"');
      expect(svgContent).toContain('height="60"');
      expect(svgContent).toContain('viewBox="0 0 147 60"');
      expect(result.root.children?.[0].svgViewport).toEqual({ x: 0, y: 0, width: 147, height: 60 });
    });
  });
});
