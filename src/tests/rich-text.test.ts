import { dump, load } from "js-yaml";
import { buildNormalizedGraph } from "~/figma/reducer";
import type { FigmaRawNode, FigmaRawPaint } from "~/figma/reducer/types";
import { extractTokens } from "~/figma/tokenizer";
import type { MCPResponse, Style, V3Node } from "~/figma/types";
import type { VariableResolutionContext } from "~/figma/variableResolver";

// Keep the expected additive contract local so the pre-feature suite fails on
// flattening, rather than on an import of a production type that does not exist yet.
type RunStyle = Pick<
  Style,
  | "color"
  | "font"
  | "fontSize"
  | "fontWeight"
  | "fontStyle"
  | "lineHeight"
  | "letterSpacing"
  | "textDecoration"
  | "textTransform"
  | "_varRefs"
>;
type TextRun = { text: string; style?: RunStyle };
type RichTextNode = V3Node & { textRuns?: TextRun[] };
type RunLocation = "root" | "component-set base" | "component-set variant";
type OverrideTable = Record<string, Record<string, unknown>>;

const BASE_TEXT_STYLE = {
  fontFamily: "Inter",
  fontSize: 16,
  fontWeight: 400,
  lineHeightPx: 24,
};
const NORMALIZED_BASE_STYLE = {
  color: "#000000",
  font: "Inter",
  fontSize: 16,
  fontWeight: 400,
  lineHeight: 24,
};
const RUN_LOCATIONS: RunLocation[] = ["root", "component-set base", "component-set variant"];
const ACCENT_VARIABLE_ID = "VariableID:synthetic-accent";
const ACCENT_VARIABLE_NAME = "brand.richTextAccent";

function solidPaint(r: number, g: number, b: number): FigmaRawPaint {
  return { type: "SOLID", color: { r, g, b, a: 1 } };
}

function makeTextNode(characters: string, overrides: Partial<FigmaRawNode> = {}): FigmaRawNode {
  return {
    id: "synthetic:text",
    type: "TEXT",
    name: "Synthetic rich text",
    characters,
    style: { ...BASE_TEXT_STYLE },
    fills: [solidPaint(0, 0, 0)],
    ...overrides,
  };
}

function makeSegmentedText(
  segments: Array<{ text: string; override: number }>,
  styleOverrideTable: OverrideTable,
  overrides: Partial<FigmaRawNode> = {},
): FigmaRawNode {
  return makeTextNode(segments.map((segment) => segment.text).join(""), {
    characterStyleOverrides: segments.flatMap((segment) =>
      Array.from({ length: segment.text.length }, () => segment.override),
    ),
    styleOverrideTable,
    ...overrides,
  });
}

function normalizeText(node: FigmaRawNode, context?: VariableResolutionContext): V3Node {
  return buildNormalizedGraph(node, {}, context).root;
}

function textRunsOf(node: V3Node | undefined): TextRun[] | undefined {
  return (node as RichTextNode | undefined)?.textRuns;
}

function tokenizeText(node: FigmaRawNode, context?: VariableResolutionContext): MCPResponse {
  return extractTokens({ schema: "v3", root: normalizeText(node, context) });
}

function makeVariableContext(): VariableResolutionContext {
  return {
    activeModes: new Map(),
    variableNames: new Map([[ACCENT_VARIABLE_ID, ACCENT_VARIABLE_NAME]]),
    variableValues: new Map([
      [ACCENT_VARIABLE_ID, { r: 18 / 255, g: 52 / 255, b: 86 / 255, a: 1 }],
    ]),
  };
}

function variablePaint(): FigmaRawPaint {
  return {
    ...solidPaint(1, 0, 0),
    boundVariables: { color: { type: "VARIABLE_ALIAS", id: ACCENT_VARIABLE_ID } },
  };
}

function variableOverrideText(): FigmaRawNode {
  return makeTextNode("ab", {
    characterStyleOverrides: [0, 1],
    styleOverrideTable: { "1": { fills: [variablePaint()] } },
  });
}

function responseAtLocation(node: RichTextNode, location: RunLocation): MCPResponse {
  if (location === "root") return { schema: "v3", root: node };
  const children = [node];
  return {
    schema: "v3",
    root: { type: "FRAME" },
    componentSets: {
      Label: {
        name: "Label",
        propKeys: ["state"],
        ...(location === "component-set base" ? { base: { children } } : {}),
        variants: { synthetic: location === "component-set variant" ? { children } : {} },
      },
    },
  };
}

function nodeAtLocation(response: MCPResponse, location: RunLocation): V3Node | undefined {
  if (location === "root") return response.root;
  const set = response.componentSets?.Label;
  return location === "component-set base"
    ? set?.base?.children?.[0]
    : set?.variants.synthetic.children?.[0];
}

function expandBaseTypography(node: V3Node, response: MCPResponse): Style {
  const { typography, ...style } = node.style ?? {};
  if (!typography) return style;
  const token = response.tokens?.typography?.[typography.slice("typography.".length)];
  if (!token) throw new Error(`Missing typography token: ${typography}`);
  return {
    font: token.font,
    fontSize: token.size,
    fontWeight: token.weight,
    lineHeight: token.lineHeight,
    ...style,
  };
}

function tokenizedTypographyResponse(): MCPResponse {
  const children = ["first", "second"].map((id) =>
    makeTextNode("ab", {
      id,
      characterStyleOverrides: [0, 1],
      styleOverrideTable: { "1": { fontFamily: "Geist", fontSize: 14, fontWeight: 600 } },
    }),
  );
  const { root } = buildNormalizedGraph({ id: "synthetic:frame", type: "FRAME", children }, {});
  return extractTokens({ schema: "v3", root });
}

describe("rich text — additive normalized text runs", () => {
  const segments = [
    { text: "Hello ", override: 0 },
    { text: "bold", override: 1 },
    { text: "\n世界 😀", override: 0 },
  ];

  it("preserves the existing full text alongside the runs", () => {
    const root = normalizeText(makeSegmentedText(segments, { "1": { fontWeight: 700 } }));
    expect(root.text).toBe("Hello bold\n世界 😀");
  });

  it("does not replace or change the node-level base style", () => {
    const root = normalizeText(makeSegmentedText(segments, { "1": { fontWeight: 700 } }));
    expect(root.style).toEqual(NORMALIZED_BASE_STYLE);
  });

  it("covers the entire string with plain inherited runs and minimal style deltas", () => {
    const root = normalizeText(makeSegmentedText(segments, { "1": { fontWeight: 700 } }));
    expect(textRunsOf(root)).toEqual([
      { text: "Hello " },
      { text: "bold", style: { fontWeight: 700 } },
      { text: "\n世界 😀" },
    ]);
  });

  it("supports one styled run spanning the whole string", () => {
    const root = normalizeText(
      makeTextNode("bold", {
        characterStyleOverrides: [1, 1, 1, 1],
        styleOverrideTable: { "1": { fontWeight: 700 } },
      }),
    );
    expect(textRunsOf(root)).toEqual([{ text: "bold", style: { fontWeight: 700 } }]);
  });

  const styleCases: Array<{ name: string; override: Record<string, unknown>; delta: RunStyle }> = [
    { name: "font family", override: { fontFamily: "Serif" }, delta: { font: "Serif" } },
    { name: "font size", override: { fontSize: 20 }, delta: { fontSize: 20 } },
    { name: "font weight", override: { fontWeight: 700 }, delta: { fontWeight: 700 } },
    { name: "REST italic boolean", override: { italic: true }, delta: { fontStyle: "italic" } },
    { name: "line height", override: { lineHeightPx: 30 }, delta: { lineHeight: 30 } },
    { name: "letter spacing", override: { letterSpacing: 2 }, delta: { letterSpacing: 2 } },
    {
      name: "text decoration",
      override: { textDecoration: "UNDERLINE" },
      delta: { textDecoration: "underline" },
    },
    {
      name: "CSS strike-through decoration",
      override: { textDecoration: "STRIKETHROUGH" },
      delta: { textDecoration: "line-through" },
    },
    {
      name: "text transform",
      override: { textCase: "UPPER" },
      delta: { textTransform: "uppercase" },
    },
    { name: "fill color", override: { fills: [solidPaint(1, 0, 0)] }, delta: { color: "#FF0000" } },
  ];

  it.each(styleCases)(
    "extracts a $name delta without repeating inherited fields",
    ({ override, delta }) => {
      const root = normalizeText(
        makeTextNode("ab", {
          characterStyleOverrides: [0, 1],
          styleOverrideTable: { "1": override },
        }),
      );
      expect(textRunsOf(root)).toEqual([{ text: "a" }, { text: "b", style: delta }]);
    },
  );
});

describe("rich text — line-height unit transitions", () => {
  const lineHeightCases = [
    { override: { lineHeightPercent: 200 }, expected: "200%" },
    { override: { lineHeightPercentFontSize: 180 }, expected: "180%" },
    { override: { lineHeightPx: 32 }, expected: 32 },
    { override: { lineHeightUnit: "INTRINSIC_%", lineHeightPercent: 100 }, expected: "normal" },
    { override: { lineHeightUnit: "INTRINSIC_%" }, expected: "normal" },
    {
      override: { lineHeightUnit: "FONT_SIZE_%", lineHeightPercentFontSize: 175, lineHeightPx: 28 },
      expected: "175%",
    },
    {
      override: { lineHeightUnit: "PIXELS", lineHeightPx: 31, lineHeightPercentFontSize: 160 },
      expected: 31,
    },
  ];

  it.each(lineHeightCases)(
    "normalizes $override without retaining stale base metrics",
    ({ override, expected }) => {
      const root = normalizeText(
        makeTextNode("ab", {
          style: { ...BASE_TEXT_STYLE, lineHeightPercentFontSize: 150, lineHeightPercent: 100 },
          characterStyleOverrides: [0, 1],
          styleOverrideTable: { "1": override },
        }),
      );
      expect(textRunsOf(root)).toEqual([
        { text: "a" },
        { text: "b", style: { lineHeight: expected } },
      ]);
    },
  );

  it("uses the active font-size percentage for node-level text styles", () => {
    const root = normalizeText(
      makeTextNode("text", {
        style: {
          ...BASE_TEXT_STYLE,
          lineHeightUnit: "FONT_SIZE_%",
          lineHeightPercentFontSize: 150,
        },
      }),
    );
    expect(root.style?.lineHeight).toBe("150%");
  });
});

describe("rich text — omit runs unless an effective style actually differs", () => {
  const unchangedCases: Array<{ name: string; overrides: Partial<FigmaRawNode> }> = [
    { name: "no override metadata", overrides: {} },
    {
      name: "an unused table entry",
      overrides: { styleOverrideTable: { "1": { fontWeight: 700 } } },
    },
    {
      name: "only zero override IDs",
      overrides: {
        characterStyleOverrides: [0, 0, 0],
        styleOverrideTable: { "0": { fontWeight: 900 } },
      },
    },
    {
      name: "only unknown override IDs",
      overrides: { characterStyleOverrides: [99, 99, 99], styleOverrideTable: {} },
    },
    {
      name: "an override equal to the inherited base",
      overrides: {
        characterStyleOverrides: [1, 1, 1],
        styleOverrideTable: { "1": { ...BASE_TEXT_STYLE, fills: [solidPaint(0, 0, 0)] } },
      },
    },
    {
      name: "an empty override style",
      overrides: { characterStyleOverrides: [1, 1, 1], styleOverrideTable: { "1": {} } },
    },
  ];

  it.each(unchangedCases)("omits textRuns for $name", ({ overrides }) => {
    expect(textRunsOf(normalizeText(makeTextNode("abc", overrides)))).toBeUndefined();
  });

  it("does not emit an empty run for empty text", () => {
    const root = normalizeText(
      makeTextNode("", {
        characterStyleOverrides: [1],
        styleOverrideTable: { "1": { fontWeight: 700 } },
      }),
    );
    expect(textRunsOf(root)).toBeUndefined();
  });
});

describe("rich text — range boundaries and inheritance", () => {
  it("coalesces adjacent equivalent effective styles even when override IDs differ", () => {
    const root = normalizeText(
      makeTextNode("abcde", {
        characterStyleOverrides: [0, 1, 2, 3, 0],
        styleOverrideTable: {
          "1": { fontWeight: 700 },
          "2": { fontWeight: 700, fontFamily: "Inter" },
          "3": { fontFamily: "Inter", fontWeight: 700, fills: [solidPaint(0, 0, 0)] },
        },
      }),
    );
    expect(textRunsOf(root)).toEqual([
      { text: "a" },
      { text: "bcd", style: { fontWeight: 700 } },
      { text: "e" },
    ]);
  });

  it("resets unknown IDs to base instead of carrying the preceding override forward", () => {
    const root = normalizeText(
      makeTextNode("abcde", {
        characterStyleOverrides: [1, 99, 0, 1, 0],
        styleOverrideTable: { "0": { fontWeight: 900 }, "1": { fontWeight: 700 } },
      }),
    );
    expect(textRunsOf(root)).toEqual([
      { text: "a", style: { fontWeight: 700 } },
      { text: "bc" },
      { text: "d", style: { fontWeight: 700 } },
      { text: "e" },
    ]);
  });

  it("uses the base style for the missing tail of a truncated override array", () => {
    const root = normalizeText(
      makeTextNode("ab\n😀tail", {
        characterStyleOverrides: [0, 1],
        styleOverrideTable: { "1": { fontWeight: 700 } },
      }),
    );
    expect(textRunsOf(root)).toEqual([
      { text: "a" },
      { text: "b", style: { fontWeight: 700 } },
      { text: "\n😀tail" },
    ]);
  });

  it("ignores override entries beyond the end of the text", () => {
    const root = normalizeText(
      makeTextNode("ab", {
        characterStyleOverrides: [0, 1, 1, 1],
        styleOverrideTable: { "1": { fontWeight: 700 } },
      }),
    );
    expect(textRunsOf(root)).toEqual([{ text: "a" }, { text: "b", style: { fontWeight: 700 } }]);
  });

  it("keeps Unicode, combining marks and newlines exactly when concatenating runs", () => {
    const characters = "A😀\ne\u0301世界\nZ";
    const root = normalizeText(
      makeSegmentedText(
        [
          { text: "A", override: 0 },
          { text: "😀\ne\u0301世界", override: 1 },
          { text: "\nZ", override: 0 },
        ],
        { "1": { fontWeight: 700 } },
      ),
    );
    expect(
      textRunsOf(root)
        ?.map((run) => run.text)
        .join(""),
    ).toBe(characters);
  });

  it("does not split a surrogate pair at a code-unit override boundary", () => {
    const root = normalizeText(
      makeTextNode("😀!", {
        characterStyleOverrides: [1, 0, 0],
        styleOverrideTable: { "1": { fontWeight: 700 } },
      }),
    );
    const runs = textRunsOf(root);
    const codePoints = runs?.flatMap((run) => Array.from(run.text, (char) => char.codePointAt(0)!));
    expect({
      text: runs?.map((run) => run.text).join(""),
      wellFormed: codePoints?.every((point) => point < 0xd800 || point > 0xdfff),
    }).toEqual({ text: "😀!", wellFormed: true });
  });

  it("preserves REST italic on the node base style", () => {
    const root = normalizeText(
      makeTextNode("base", { style: { ...BASE_TEXT_STYLE, italic: true } }),
    );
    expect(root.style?.fontStyle).toBe("italic");
  });

  it("preserves explicit normal/none/zero resets instead of re-inheriting styled base values", () => {
    const root = normalizeText(
      makeTextNode("ab", {
        style: {
          ...BASE_TEXT_STYLE,
          italic: true,
          textDecoration: "UNDERLINE",
          letterSpacing: 2,
          textCase: "UPPER",
        },
        characterStyleOverrides: [0, 1],
        styleOverrideTable: {
          "1": { italic: false, textDecoration: "NONE", letterSpacing: 0, textCase: "ORIGINAL" },
        },
      }),
    );
    expect(textRunsOf(root)).toEqual([
      { text: "a" },
      {
        text: "b",
        style: {
          fontStyle: "normal",
          textDecoration: "none",
          letterSpacing: 0,
          textTransform: "none",
        },
      },
    ]);
  });
});

describe("rich text — per-range paints use the existing variable context", () => {
  it("resolves the override paint and records the run-local variable name", () => {
    const root = normalizeText(variableOverrideText(), makeVariableContext());
    expect(textRunsOf(root)).toEqual([
      { text: "a" },
      { text: "b", style: { color: "#123456", _varRefs: { color: ACCENT_VARIABLE_NAME } } },
    ]);
  });

  it("falls back to the override paint color when variable resolution is unavailable", () => {
    expect(textRunsOf(normalizeText(variableOverrideText()))).toEqual([
      { text: "a" },
      { text: "b", style: { color: "#FF0000" } },
    ]);
  });

  it("skips hidden paints when extracting the run color", () => {
    const root = normalizeText(
      makeTextNode("ab", {
        characterStyleOverrides: [0, 1],
        styleOverrideTable: {
          "1": { fills: [{ ...solidPaint(1, 0, 0), visible: false }, solidPaint(0, 0, 1)] },
        },
      }),
    );
    expect(textRunsOf(root)).toEqual([{ text: "a" }, { text: "b", style: { color: "#0000FF" } }]);
  });

  it("tokenizes a variable-bound paint through the complete reducer/tokenizer pipeline", () => {
    const result = tokenizeText(variableOverrideText(), makeVariableContext());
    expect({
      runs: textRunsOf(result.root),
      color: result.tokens?.colors?.[ACCENT_VARIABLE_NAME],
    }).toEqual({
      runs: [{ text: "a" }, { text: "b", style: { color: `colors.${ACCENT_VARIABLE_NAME}` } }],
      color: "#123456",
    });
  });
});

describe.each(RUN_LOCATIONS)("rich text — tokenizer traversal at %s", (location) => {
  it("counts and replaces colors used only in text runs", () => {
    const node: RichTextNode = {
      type: "TEXT",
      text: "a b",
      textRuns: [
        { text: "a", style: { color: "#9747FF" } },
        { text: " " },
        { text: "b", style: { color: "#9747FF" } },
      ],
    };
    const result = extractTokens(responseAtLocation(node, location));
    expect({
      runs: textRunsOf(nodeAtLocation(result, location)),
      color: result.tokens?.colors?.primary,
    }).toEqual({
      runs: [
        { text: "a", style: { color: "colors.primary" } },
        { text: " " },
        { text: "b", style: { color: "colors.primary" } },
      ],
      color: "#9747FF",
    });
  });

  it("registers and replaces a singleton run-local Figma color reference", () => {
    const node: RichTextNode = {
      type: "TEXT",
      text: "ab",
      textRuns: [
        { text: "a" },
        { text: "b", style: { color: "#123456", _varRefs: { color: ACCENT_VARIABLE_NAME } } },
      ],
    };
    const result = extractTokens(responseAtLocation(node, location));
    expect({
      runs: textRunsOf(nodeAtLocation(result, location)),
      color: result.tokens?.colors?.[ACCENT_VARIABLE_NAME],
    }).toEqual({
      runs: [{ text: "a" }, { text: "b", style: { color: `colors.${ACCENT_VARIABLE_NAME}` } }],
      color: "#123456",
    });
  });

  it("strips internal run-local _varRefs from the final response", () => {
    const node: RichTextNode = {
      type: "TEXT",
      text: "ab",
      textRuns: [
        { text: "a" },
        { text: "b", style: { color: "#123456", _varRefs: { color: ACCENT_VARIABLE_NAME } } },
      ],
    };
    expect(JSON.stringify(extractTokens(responseAtLocation(node, location)))).not.toContain(
      "_varRefs",
    );
  });
});

describe("rich text — typography tokens must not swallow partial run deltas", () => {
  it("still tokenizes repeated node-base typography", () => {
    const result = tokenizedTypographyResponse();
    expect(result.root.children?.map((child) => child.style?.typography)).toEqual([
      expect.stringMatching(/^typography\./),
      expect.stringMatching(/^typography\./),
    ]);
  });

  it("keeps repeated run font/size/weight overrides raw and partial", () => {
    const result = tokenizedTypographyResponse();
    expect(result.root.children?.map(textRunsOf)).toEqual([
      [{ text: "a" }, { text: "b", style: { font: "Geist", fontSize: 14, fontWeight: 600 } }],
      [{ text: "a" }, { text: "b", style: { font: "Geist", fontSize: 14, fontWeight: 600 } }],
    ]);
  });

  it("inherits base lineHeight after expanding base.typography and applying the run delta", () => {
    const result = tokenizedTypographyResponse();
    const node = result.root.children![0];
    const effectiveRunStyle = {
      ...expandBaseTypography(node, result),
      ...textRunsOf(node)?.[1].style,
    };
    expect(effectiveRunStyle).toMatchObject({
      font: "Geist",
      fontSize: 14,
      fontWeight: 600,
      lineHeight: 24,
    });
  });
});

describe("rich text — serialization", () => {
  const segments = [
    { text: "Heading:\n", override: 0 },
    { text: "😀 café", override: 1 },
    { text: "\t終\n", override: 0 },
  ];
  const expected = {
    text: "Heading:\n😀 café\t終\n",
    textRuns: [
      { text: "Heading:\n" },
      { text: "😀 café", style: { fontWeight: 700 } },
      { text: "\t終\n" },
    ],
  };

  it("preserves full text and rich-text deltas through JSON serialization", () => {
    const result = tokenizeText(makeSegmentedText(segments, { "1": { fontWeight: 700 } }));
    const decoded: unknown = JSON.parse(JSON.stringify(result));
    expect(decoded).toMatchObject({ root: expected });
  });

  it("preserves full text and rich-text deltas through YAML serialization", () => {
    const result = tokenizeText(makeSegmentedText(segments, { "1": { fontWeight: 700 } }));
    const decoded: unknown = load(dump(result));
    expect(decoded).toMatchObject({ root: expected });
  });
});
