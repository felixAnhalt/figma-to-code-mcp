import { getVectorMerge } from "~/figma/reducer/group";
import { extractLayoutFromNode } from "~/figma/reducer/layout";
import { isTransparentWrapper, resolveChildren } from "~/figma/reducer/node";
import type { FigmaRawNode } from "~/figma/reducer/types";

function node(overrides: Partial<FigmaRawNode> = {}): FigmaRawNode {
  return { id: "test:node", type: "FRAME", ...overrides };
}

function translation(x: number, y: number): number[][] {
  return [
    [1, 0, x],
    [0, 1, y],
  ];
}

function vector(overrides: Partial<FigmaRawNode> = {}): FigmaRawNode {
  return node({
    type: "VECTOR",
    fillGeometry: [{ path: "M0 0L10 0L10 10Z", windingRule: "NONZERO" }],
    ...overrides,
  });
}

describe("parent-local positioning", () => {
  it("keeps a grid-laid-out frame as a column with its padding and children in flow", () => {
    const grid = node({
      layoutMode: "GRID",
      paddingTop: 20,
      paddingLeft: 20,
      paddingRight: 20,
      paddingBottom: 20,
    });
    const variant = node({ layoutMode: "VERTICAL", relativeTransform: translation(21, 21) });
    expect(extractLayoutFromNode(grid)).toMatchObject({
      direction: "column",
      padding: 20,
    });
    expect(extractLayoutFromNode(variant, undefined, grid)).not.toHaveProperty("position");
  });

  it("keeps an overlay out of auto-layout without positioning its flow sibling", () => {
    const overlay = node({
      layoutMode: "HORIZONTAL",
      layoutPositioning: "ABSOLUTE",
      relativeTransform: translation(295, 426),
      size: { x: 327, y: 66 },
      layoutSizingVertical: "HUG",
    });
    const flow = node({
      relativeTransform: translation(24, 24),
      layoutSizingHorizontal: "FILL",
      layoutSizingVertical: "HUG",
      layoutGrow: 1,
    });
    const parent = node({
      layoutMode: "VERTICAL",
      size: { x: 660, y: 520 },
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
      children: [flow, overlay],
    });

    expect(extractLayoutFromNode(overlay, null, parent)).toMatchObject({
      direction: "row",
      position: "absolute",
      left: 295,
      top: 426,
      width: "327px",
      height: "66px",
    });
    expect(extractLayoutFromNode(flow, null, parent)).toEqual({
      width: "100%",
      height: "fit-content",
      grow: true,
    });
    expect(extractLayoutFromNode(parent)).toMatchObject({ position: "relative" });
  });

  it.each([
    [0, 0],
    [-12.5, 0],
    [0, -24],
  ])("preserves zero and negative translations (%s, %s)", (left, top) => {
    const child = node({ relativeTransform: translation(left, top) });
    expect(extractLayoutFromNode(child, null, node())).toEqual({
      position: "absolute",
      left,
      top,
    });
  });

  it("prefers the local translation and size over transformed canvas bounds", () => {
    const child = node({
      relativeTransform: [
        [0, -1, 0],
        [1, 0, -8],
      ],
      size: { x: 80, y: 20 },
      absoluteBoundingBox: { x: 400, y: 500, width: 20, height: 80 },
    });
    const parent = node({
      relativeTransform: [
        [0, -1, 300],
        [1, 0, 200],
      ],
    });
    expect(extractLayoutFromNode(child, null, parent)).toEqual({
      position: "absolute",
      left: 0,
      top: -8,
      width: "80px",
      height: "20px",
    });
  });

  it("falls back to bounding-box differences only for untransformed axes", () => {
    const parent = node({ absoluteBoundingBox: { x: -100, y: 200 } });
    const child = node({ absoluteBoundingBox: { x: -112, y: 200, width: 20, height: 0 } });
    expect(extractLayoutFromNode(child, null, parent)).toEqual({
      position: "absolute",
      left: -12,
      top: 0,
      width: "20px",
      height: "0px",
    });
  });

  it.each([
    { rotation: Math.PI / 2 },
    {
      relativeTransform: [
        [0, -1, 0],
        [1, 0, 0],
      ],
    },
    {
      relativeTransform: [
        [2, 0, 0],
        [0, 2, 0],
      ],
    },
  ])("does not invent local offsets from a transformed parent's bounds (%#)", (transform) => {
    const parent = node({ ...transform, absoluteBoundingBox: { x: 100, y: 100 } });
    const child = node({ absoluteBoundingBox: { x: 120, y: 130, width: 20, height: 30 } });
    const layout = extractLayoutFromNode(child, null, parent);
    expect(layout?.position).toBeUndefined();
    expect(layout?.left).toBeUndefined();
    expect(layout?.top).toBeUndefined();
  });

  it("does not use a rotated child's canvas bounds as local translation or size", () => {
    const child = node({
      rotation: Math.PI / 2,
      absoluteBoundingBox: { x: 120, y: 130, width: 20, height: 80 },
    });
    expect(
      extractLayoutFromNode(child, null, node({ absoluteBoundingBox: { x: 100, y: 100 } })),
    ).toBeUndefined();
  });

  it("never emits non-finite coordinates or dimensions", () => {
    const child = node({
      relativeTransform: translation(Number.NaN, Number.POSITIVE_INFINITY),
      size: { x: Number.NaN, y: Number.POSITIVE_INFINITY },
    });
    expect(extractLayoutFromNode(child, null, node())).toBeUndefined();
  });

  it("marks a coordinate-containing parent relative without replacing absolute placement", () => {
    const child = node({ relativeTransform: translation(0, 0) });
    const parent = node({
      layoutPositioning: "ABSOLUTE",
      relativeTransform: translation(20, 40),
      children: [child],
    });
    expect(extractLayoutFromNode(parent, null, node())).toMatchObject({
      position: "absolute",
      left: 20,
      top: 40,
    });
  });

  it("does not turn layoutMode NONE into column layout", () => {
    const child = node({ relativeTransform: translation(10, 20), size: { x: 30, y: 40 } });
    const canvas = node({ layoutMode: "NONE", size: { x: 320, y: 180 }, children: [child] });
    expect(extractLayoutFromNode(canvas)).toEqual({
      position: "relative",
      width: "320px",
      height: "180px",
    });
    expect(extractLayoutFromNode(child, null, canvas)).toEqual({
      position: "absolute",
      left: 10,
      top: 20,
      width: "30px",
      height: "40px",
    });
  });

  it("retains genuine auto-layout direction, sizing, gap, alignment and padding", () => {
    const flow = node({
      relativeTransform: translation(20, 20),
      size: { x: 100, y: 40 },
      layoutSizingHorizontal: "FILL",
      layoutSizingVertical: "HUG",
      layoutAlign: "STRETCH",
    });
    const parent = node({
      layoutMode: "HORIZONTAL",
      itemSpacing: 12,
      counterAxisAlignItems: "CENTER",
      primaryAxisAlignItems: "SPACE_BETWEEN",
      paddingLeft: 20,
      paddingRight: 20,
      paddingTop: 20,
      paddingBottom: 20,
      children: [flow],
    });
    expect(extractLayoutFromNode(parent)).toEqual({
      direction: "row",
      align: "center",
      justify: "space-between",
      gap: 12,
      padding: 20,
    });
    expect(extractLayoutFromNode(flow, null, parent)).toEqual({
      width: "100%",
      height: "fit-content",
      grow: true,
    });
  });

  it("respects explicit FILL/HUG sizing when no parent context proves absolute placement", () => {
    const standalone = node({
      size: { x: 200, y: 100 },
      layoutSizingHorizontal: "FILL",
      layoutSizingVertical: "HUG",
    });
    expect(extractLayoutFromNode(standalone)).toEqual({
      width: "100%",
      height: "fit-content",
    });
  });

  it("retains the chart canvas and absolute guide, curve, dot and weekday coordinates", () => {
    const children = [
      ...[0, 40, 80, 120].map((y) =>
        node({
          type: "RECTANGLE",
          layoutPositioning: "ABSOLUTE",
          relativeTransform: translation(0, y),
          size: { x: 500, y: 1 },
        }),
      ),
      ...[0, 1].map(() =>
        vector({
          layoutPositioning: "ABSOLUTE",
          relativeTransform: translation(0, 0),
          size: { x: 500, y: 122 },
        }),
      ),
      node({
        type: "ELLIPSE",
        layoutPositioning: "ABSOLUTE",
        relativeTransform: translation(495, 0),
        size: { x: 10, y: 10 },
      }),
      node({
        layoutMode: "HORIZONTAL",
        layoutPositioning: "ABSOLUTE",
        relativeTransform: translation(0, 138),
        size: { x: 500, y: 19 },
      }),
    ];
    const chart = node({
      layoutMode: "VERTICAL",
      size: { x: 500, y: 157 },
      layoutSizingHorizontal: "FILL",
      layoutSizingVertical: "FIXED",
      children,
    });
    expect(extractLayoutFromNode(chart, null, node({ layoutMode: "VERTICAL" }))).toMatchObject({
      direction: "column",
      position: "relative",
      width: "100%",
      height: "157px",
    });
    expect(children.map((child) => extractLayoutFromNode(child, null, chart))).toMatchObject([
      { position: "absolute", left: 0, top: 0, width: "500px", height: "1px" },
      { position: "absolute", left: 0, top: 40 },
      { position: "absolute", left: 0, top: 80 },
      { position: "absolute", left: 0, top: 120 },
      { position: "absolute", left: 0, top: 0, width: "500px", height: "122px" },
      { position: "absolute", left: 0, top: 0, width: "500px", height: "122px" },
      { position: "absolute", left: 495, top: 0 },
      { position: "absolute", left: 0, top: 138 },
    ]);
    expect(getVectorMerge(chart, children)).toBeUndefined();
  });
});

describe("coordinate wrapper retention", () => {
  it.each([
    { relativeTransform: translation(20, -10) },
    {
      relativeTransform: [
        [0, -1, 0],
        [1, 0, 0],
      ],
    },
    { layoutPositioning: "ABSOLUTE" },
    { rotation: Math.PI / 2 },
    { size: { x: 80, y: 40 } },
  ])("retains a wrapper with meaningful coordinate semantics (%#)", (overrides) => {
    const wrapper = node({ ...overrides, children: [node({ type: "TEXT" })] });
    expect(isTransparentWrapper(wrapper)).toBe(false);
    expect(resolveChildren([wrapper])).toEqual([wrapper]);
  });

  it("retains the containing block of a single absolute child", () => {
    const wrapper = node({
      children: [node({ layoutPositioning: "ABSOLUTE", relativeTransform: translation(0, 0) })],
    });
    expect(resolveChildren([wrapper])).toEqual([wrapper]);
  });

  it("retains a freeform wrapper when its child has local coordinate evidence", () => {
    const wrapper = node({ children: [node({ relativeTransform: translation(0, -5) })] });
    expect(resolveChildren([wrapper])).toEqual([wrapper]);
  });

  it("retains a zero-offset containing block for a locally sized child", () => {
    const wrapper = node({
      children: [node({ relativeTransform: translation(0, 0), size: { x: 80, y: 40 } })],
    });
    expect(resolveChildren([wrapper])).toEqual([wrapper]);
  });

  it("still collapses identity-only toy wrappers", () => {
    const leaf = node({ type: "TEXT" });
    const inner = node({ relativeTransform: translation(0, 0), children: [leaf] });
    const outer = node({ children: [inner] });
    expect(resolveChildren([outer])).toEqual([leaf]);
  });
});

describe("coordinate-safe vector merging", () => {
  it("does not combine actual auto-layout flow children into one SVG child", () => {
    const children = [vector(), vector({ relativeTransform: translation(20, 0) })];
    expect(getVectorMerge(node({ layoutMode: "HORIZONTAL", children }), children)).toBeUndefined();
  });

  it("places a safely merged freeform canvas at zero with its local dimensions", () => {
    const children = [
      vector({ relativeTransform: translation(0, 0) }),
      vector({ relativeTransform: translation(40, -5) }),
    ];
    const canvas = node({
      size: { x: 120, y: 80 },
      absoluteBoundingBox: { x: 300, y: 400, width: 80, height: 120 },
      children,
    });
    const merged = getVectorMerge(canvas, children);
    expect(merged).toMatchObject({
      bounds: { x: 0, y: 0, width: 120, height: 80 },
      layout: { position: "absolute", left: 0, top: 0, width: "120px", height: "80px" },
    });
    expect(merged?.entries[1].transform).toEqual([1, 0, 0, 1, 40, -5]);
  });

  it("uses parent-local bounding-box differences when merging untransformed vectors", () => {
    const children = [
      vector({ absoluteBoundingBox: { x: 110, y: 200, width: 10, height: 10 } }),
      vector({ absoluteBoundingBox: { x: 100, y: 180, width: 10, height: 10 } }),
    ];
    const canvas = node({
      absoluteBoundingBox: { x: 100, y: 200, width: 120, height: 80 },
      children,
    });
    expect(getVectorMerge(canvas, children)?.entries.map(({ transform }) => transform)).toEqual([
      [1, 0, 0, 1, 10, 0],
      [1, 0, 0, 1, 0, -20],
    ]);
  });

  it("does not flatten nested scaled coordinate containers", () => {
    const nested = node({
      type: "GROUP",
      relativeTransform: [
        [2, 0, 20],
        [0, 2, 10],
      ],
      children: [vector(), vector()],
    });
    const children = [nested, vector()];
    expect(getVectorMerge(node({ type: "GROUP", children }), children)).toBeUndefined();
  });

  it("accumulates simple nested translations instead of dropping the wrapper offset", () => {
    const nested = node({
      type: "GROUP",
      relativeTransform: translation(30, -10),
      children: [vector({ relativeTransform: translation(5, 2) })],
    });
    const children = [nested, vector({ relativeTransform: translation(0, 0) })];
    const canvas = node({ type: "GROUP", size: { x: 100, y: 60 }, children });
    expect(getVectorMerge(canvas, children)?.entries[0].transform).toEqual([1, 0, 0, 1, 35, -8]);
  });

  it("does not merge vectors whose only positional evidence uses transformed parent axes", () => {
    const children = [
      vector({ absoluteBoundingBox: { x: 110, y: 200 } }),
      vector({ absoluteBoundingBox: { x: 120, y: 200 } }),
    ];
    const canvas = node({
      relativeTransform: [
        [0, -1, 100],
        [1, 0, 200],
      ],
      size: { x: 100, y: 80 },
      absoluteBoundingBox: { x: 100, y: 200, width: 80, height: 100 },
      children,
    });
    expect(getVectorMerge(canvas, children)).toBeUndefined();
  });
});
