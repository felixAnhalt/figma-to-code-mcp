import { buildNormalizedGraph } from "~/figma/reducer";
import { processPaint } from "~/figma/reducer/paint";
import { extractStyleFromNode } from "~/figma/reducer/style";
import type { FigmaRawNode, FigmaRawPaint } from "~/figma/reducer/types";
import { extractTokens } from "~/figma/tokenizer";
import type { VariableResolutionContext } from "~/figma/variableResolver";

type GradientHandles = [
  { x: number; y: number },
  { x: number; y: number },
  { x: number; y: number },
];

const BLACK = { r: 0, g: 0, b: 0, a: 1 };
const WHITE = { r: 1, g: 1, b: 1, a: 1 };
const BOTTOM_BORDER = { top: 0, right: 0, bottom: 1, left: 0 };
const STAGE_HANDLES: GradientHandles = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
  { x: 1, y: 0 },
];
const NONDEFAULT_HANDLES: GradientHandles = [
  { x: -0.123456789, y: 0.456789123 },
  { x: 1.234567891, y: 0.876543219 },
  { x: 0.333333333, y: 1.789123456 },
];
const GRADIENT_STOPS = [
  { position: 0, color: BLACK },
  { position: 0.550000011920929, color: WHITE },
  { position: 1, color: BLACK },
];
const EXPECTED_STOPS = [
  { position: 0, color: "#000000" },
  { position: 0.55, color: "#FFFFFF" },
  { position: 1, color: "#000000" },
];
const WIDTH_VARIABLE_ID = "VariableID:border-width";
const COLOR_VARIABLE_ID = "VariableID:border-color";
const VARIABLE_CONTEXT: VariableResolutionContext = {
  activeModes: new Map(),
  variableNames: new Map([
    [WIDTH_VARIABLE_ID, "border.width"],
    [COLOR_VARIABLE_ID, "border.color"],
  ]),
  variableValues: new Map<string, number | typeof BLACK>([
    [WIDTH_VARIABLE_ID, 1],
    [COLOR_VARIABLE_ID, BLACK],
  ]),
};

function strokedNode(overrides: Record<string, unknown> = {}): FigmaRawNode {
  return {
    id: "1:1",
    name: "Navigation",
    type: "FRAME",
    strokes: [{ type: "SOLID", color: BLACK }],
    strokeWeight: 1,
    ...overrides,
  };
}

function gradientPaint(handles: unknown, type = "GRADIENT_LINEAR"): FigmaRawPaint {
  return {
    type,
    gradientStops: GRADIENT_STOPS,
    gradientHandlePositions: handles,
  } as FigmaRawPaint;
}

function boundStrokeNode(overrides: Record<string, unknown> = {}): FigmaRawNode {
  return strokedNode({
    strokes: [
      {
        type: "SOLID",
        color: BLACK,
        boundVariables: { color: { type: "VARIABLE_ALIAS", id: COLOR_VARIABLE_ID } },
      },
    ],
    boundVariables: { strokeWeight: { type: "VARIABLE_ALIAS", id: WIDTH_VARIABLE_ID } },
    ...overrides,
  });
}

describe("edge-border fidelity", () => {
  it("preserves the navigation's bottom-only border with explicit zero edges", () => {
    const style = extractStyleFromNode(
      strokedNode({ individualStrokeWeights: BOTTOM_BORDER }),
      undefined,
    );

    expect(style).toEqual({ border: "#000000", borderWidths: BOTTOM_BORDER });
    expect(style).not.toHaveProperty("borderWidth");
  });

  it("keeps the shared color variable but does not bind asymmetric widths to strokeWeight", () => {
    const style = extractStyleFromNode(
      boundStrokeNode({ individualStrokeWeights: BOTTOM_BORDER }),
      VARIABLE_CONTEXT,
    );

    expect(style).toEqual({
      border: "#000000",
      borderWidths: BOTTOM_BORDER,
      _varRefs: { border: "border.color" },
    });
  });

  it("retains the existing uniform borderWidth and its variable reference", () => {
    const style = extractStyleFromNode(boundStrokeNode(), VARIABLE_CONTEXT);

    expect(style).toEqual({
      border: "#000000",
      borderWidth: 1,
      _varRefs: { border: "border.color", borderWidth: "border.width" },
    });
  });

  it("uses an explicitly uniform individual weight instead of the general strokeWeight", () => {
    const style = extractStyleFromNode(
      strokedNode({ individualStrokeWeights: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 } }),
      undefined,
    );

    expect(style).toEqual({ border: "#000000", borderWidth: 2.5 });
  });

  it("uses valid individual weights even when the general strokeWeight is invalid", () => {
    const style = extractStyleFromNode(
      strokedNode({ strokeWeight: Number.NaN, individualStrokeWeights: BOTTOM_BORDER }),
      undefined,
    );

    expect(style).toEqual({ border: "#000000", borderWidths: BOTTOM_BORDER });
  });

  it.each([
    { strokeWeight: 0 },
    { strokeWeight: 1, individualStrokeWeights: { top: 0, right: 0, bottom: 0, left: 0 } },
  ])("does not resurrect an explicitly zero-width border: %j", (overrides) => {
    const style = extractStyleFromNode(boundStrokeNode(overrides), VARIABLE_CONTEXT);

    expect(style).toEqual({ border: "#000000", _varRefs: { border: "border.color" } });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, "1", null])(
    "omits an invalid uniform width: %s",
    (strokeWeight) => {
      const style = extractStyleFromNode(boundStrokeNode({ strokeWeight }), VARIABLE_CONTEXT);

      expect(style).toEqual({ border: "#000000", _varRefs: { border: "border.color" } });
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1, "1", null])(
    "does not turn an invalid edge set into a uniform border: %s",
    (bottom) => {
      const style = extractStyleFromNode(
        boundStrokeNode({ individualStrokeWeights: { ...BOTTOM_BORDER, bottom } }),
        VARIABLE_CONTEXT,
      );

      expect(style).toEqual({ border: "#000000", _varRefs: { border: "border.color" } });
    },
  );

  it("does not invent missing individual edges", () => {
    const style = extractStyleFromNode(
      strokedNode({ individualStrokeWeights: { bottom: 1 } }),
      undefined,
    );

    expect(style).toEqual({ border: "#000000" });
  });

  it("does not emit widths without a visible stroke", () => {
    const style = extractStyleFromNode(
      strokedNode({
        individualStrokeWeights: BOTTOM_BORDER,
        strokes: [{ type: "SOLID", color: BLACK, visible: false }],
      }),
      undefined,
    );

    expect(style).toBeUndefined();
  });
});

describe("gradient-handle fidelity", () => {
  it("retains the product stage's raw linear handles alongside type and stops", () => {
    expect(processPaint(gradientPaint(STAGE_HANDLES), undefined)).toEqual({
      type: "GRADIENT_LINEAR",
      gradientStops: EXPECTED_STOPS,
      gradientHandlePositions: STAGE_HANDLES,
    });
  });

  it.each(["GRADIENT_LINEAR", "GRADIENT_RADIAL"])(
    "preserves exact nondefault %s geometry without clamping or rounding",
    (type) => {
      expect(processPaint(gradientPaint(NONDEFAULT_HANDLES, type), undefined)).toEqual({
        type,
        gradientStops: EXPECTED_STOPS,
        gradientHandlePositions: NONDEFAULT_HANDLES,
      });
    },
  );

  it("keeps gradients with the same stops and different geometry distinguishable", () => {
    const diagonal = processPaint(gradientPaint(STAGE_HANDLES), undefined);
    const nondefault = processPaint(gradientPaint(NONDEFAULT_HANDLES), undefined);

    expect(diagonal).not.toEqual(nondefault);
  });

  it.each(
    [
      undefined,
      null,
      [],
      STAGE_HANDLES.slice(0, 2),
      [...STAGE_HANDLES, { x: 0, y: 1 }],
      [null, ...STAGE_HANDLES.slice(1)],
      [{ x: 0 }, ...STAGE_HANDLES.slice(1)],
      [{ x: Number.NaN, y: 0 }, ...STAGE_HANDLES.slice(1)],
      [{ x: 0, y: Number.POSITIVE_INFINITY }, ...STAGE_HANDLES.slice(1)],
      [{ x: Number.NEGATIVE_INFINITY, y: 0 }, ...STAGE_HANDLES.slice(1)],
      [{ x: "0", y: 0 }, ...STAGE_HANDLES.slice(1)],
    ].map((handles) => ({ handles })),
  )("omits malformed handles without losing the gradient's stops: %j", ({ handles }) => {
    expect(processPaint(gradientPaint(handles), undefined)).toEqual({
      type: "GRADIENT_LINEAR",
      gradientStops: EXPECTED_STOPS,
    });
  });
});

describe("paint fidelity through normalization and token extraction", () => {
  it("retains edge zeros and gradient geometry while tokenizing the shared stroke color", () => {
    const stage = (id: string, handles: GradientHandles): FigmaRawNode =>
      boundStrokeNode({
        id,
        name: "Product stage",
        individualStrokeWeights: BOTTOM_BORDER,
        fills: [gradientPaint(handles)],
      });
    const normalized = buildNormalizedGraph(
      {
        id: "root",
        type: "FRAME",
        layoutMode: "VERTICAL",
        children: [stage("2:1", STAGE_HANDLES), stage("2:2", NONDEFAULT_HANDLES)],
      },
      {},
      VARIABLE_CONTEXT,
    );
    const result = extractTokens(normalized);
    const styles = result.root.children?.map((child) => child.style);

    expect(styles).toEqual(
      [STAGE_HANDLES, NONDEFAULT_HANDLES].map((gradientHandlePositions) => ({
        border: "colors.border.color",
        borderWidths: BOTTOM_BORDER,
        background: [
          { type: "GRADIENT_LINEAR", gradientStops: EXPECTED_STOPS, gradientHandlePositions },
        ],
      })),
    );
    expect(result.tokens).toEqual({ colors: { "border.color": "#000000" } });
    expect(JSON.stringify(result)).not.toContain("_varRefs");
  });
});
