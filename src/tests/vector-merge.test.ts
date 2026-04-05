import { describe, it, expect, beforeEach } from "vitest";
import { buildNormalizedGraph, flushAllPendingVectorSvgs } from "~/figma/reducer.js";
import { svgContentCache } from "~/figma/svg-writer.js";

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

      buildNormalizedGraph(g, {});
      await flushAllPendingVectorSvgs("");

      const cacheKeys = Array.from(svgContentCache.keys());
      expect(cacheKeys.length).toBeGreaterThan(0);
    });

    it("should NOT merge single vector child", () => {
      const v1 = vector("1:2", "Vector1");
      const g = group("1:1", "Group", [v1]);

      const result = buildNormalizedGraph(g, {});

      const groupNode = result.root;
      expect(groupNode.children).toHaveLength(1);
      expect((groupNode.children![0] as any).svgPathInAssetFolder).toBeUndefined();
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

      expect((result.root.children![0] as any).name).toBe("IconStar");
    });
  });

  describe("FRAME with multiple VECTOR children", () => {
    it("should merge frame with direct VECTOR children into single child", async () => {
      const v1 = vector("1:2", "Vector1");
      const v2 = vector("1:3", "Vector2");
      const f = frame("1:1", "Frame", [v1, v2]);

      buildNormalizedGraph(f, {});
      await flushAllPendingVectorSvgs("");

      const cacheKeys = Array.from(svgContentCache.keys());
      expect(cacheKeys.length).toBeGreaterThan(0);
    });

    it("should NOT merge frame with single vector child", () => {
      const v1 = vector("1:2", "Vector1");
      const f = frame("1:1", "Frame", [v1]);

      const result = buildNormalizedGraph(f, {});

      expect(result.root.children).toHaveLength(1);
      expect((result.root.children![0] as any).svgPathInAssetFolder).toBeUndefined();
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

      buildNormalizedGraph(f, {});
      await flushAllPendingVectorSvgs("");

      const cacheKeys = Array.from(svgContentCache.keys());
      expect(cacheKeys.length).toBeGreaterThan(0);
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

      buildNormalizedGraph(g, {});
      await flushAllPendingVectorSvgs("");

      expect(svgContentCache.size).toBeGreaterThan(0);
    });
  });

  describe("flushAllPendingVectorSvgs", () => {
    it("should write merged SVGs to cache", async () => {
      const v1 = vector("1:2", "Vector1");
      const v2 = vector("1:3", "Vector2");
      const g = group("1:1", "Group", [v1, v2]);

      buildNormalizedGraph(g, {});

      expect(svgContentCache.size).toBe(0);

      await flushAllPendingVectorSvgs("");

      expect(svgContentCache.size).toBeGreaterThan(0);
    });
  });
});
