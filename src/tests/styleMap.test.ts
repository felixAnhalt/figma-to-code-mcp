import { randomUUID } from "node:crypto";
import { fetchStyles } from "~/figma";
import { buildNormalizedGraph } from "~/figma/reducer";
import type { DesignTokens, MCPResponse } from "~/figma/types";
import { getFigmaDesignTool } from "~/mcp/tools/getFigmaDesignTool";
import { FigmaService } from "~/services/figmaConnector";

const ROOT_NODE_ID = "30:1";
const NODE_STYLE_IDS = {
  fill: "S:101:1",
  stroke: "S:101:2",
  effect: "S:101:3",
  text: "S:101:4",
};
const PUBLISHED_STYLES = [
  { key: "publishedFill", node_id: "101:1", style_type: "FILL", name: "Shared red fill" },
  { key: "publishedStroke", node_id: "101:2", style_type: "FILL", name: "Shared thin stroke" },
  { key: "publishedEffect", node_id: "101:3", style_type: "EFFECT", name: "Shared deep shadow" },
  { key: "publishedText", node_id: "101:4", style_type: "TEXT", name: "Shared body text" },
] as const;
const PUBLISHED_STYLE_MAP = Object.fromEntries(PUBLISHED_STYLES.map((style) => [style.key, style]));
const NODE_RESPONSE_STYLE_MAP = Object.fromEntries(
  PUBLISHED_STYLES.map((style, index) => [
    Object.values(NODE_STYLE_IDS)[index],
    { key: style.key, name: style.name, styleType: style.style_type, remote: true },
  ]),
);
const EXPECTED_RECTANGLE_STYLE = {
  background: "#00FF00",
  border: "#0000FF",
  borderWidth: 3,
  shadow: "2px 3px 5px 1px #00000080",
};
const EXPECTED_TEXT_STYLE = {
  color: "#333333",
  font: "Override Sans",
  fontSize: 19,
  fontWeight: 600,
  lineHeight: 27,
  letterSpacing: 0.5,
  textAlign: "right",
};
const TOKEN_REF_SEPARATOR = ".";

/** Replaces a `category.name` token reference with the token's value; other values pass through. */
function resolveTokenRef(value: unknown, tokens: DesignTokens): unknown {
  if (typeof value !== "string" || !value.includes(TOKEN_REF_SEPARATOR)) return value;
  const [category, name] = value.split(TOKEN_REF_SEPARATOR);
  const tokensByCategory: Record<string, Record<string, unknown> | undefined> = tokens;
  return tokensByCategory[category]?.[name] ?? value;
}

/** Expands a TEXT node's typography token back into the font fields it replaces. */
function resolveStyleTokens(
  style: Record<string, unknown>,
  tokens: DesignTokens,
): Record<string, unknown> {
  const { typography, ...fields } = style;
  const resolved = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, resolveTokenRef(value, tokens)]),
  );
  const [, typographyName] =
    typeof typography === "string" ? typography.split(TOKEN_REF_SEPARATOR) : [];
  const token = typographyName ? tokens.typography?.[typographyName] : undefined;
  if (!token) return resolved;
  return {
    ...resolved,
    font: token.font,
    fontSize: token.size,
    fontWeight: token.weight,
    lineHeight: token.lineHeight,
  };
}

function styledRectangle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ROOT_NODE_ID,
    name: "Overridden card",
    type: "RECTANGLE",
    styles: NODE_STYLE_IDS,
    fills: [{ type: "SOLID", color: { r: 0, g: 1, b: 0, a: 1 } }],
    strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } }],
    strokeWeight: 3,
    effects: [
      {
        type: "DROP_SHADOW",
        visible: true,
        color: { r: 0, g: 0, b: 0, a: 0.5 },
        offset: { x: 2, y: 3 },
        radius: 5,
        spread: 1,
      },
    ],
    ...overrides,
  };
}

function styledText(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "30:2",
    type: "TEXT",
    name: "Overridden label",
    characters: "Effective text",
    styles: { fill: NODE_STYLE_IDS.fill, text: NODE_STYLE_IDS.text },
    fills: [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.2, a: 1 } }],
    style: {
      fontFamily: "Override Sans",
      fontSize: 19,
      fontWeight: 600,
      lineHeightPx: 27,
      letterSpacing: 0.5,
      textAlignHorizontal: "RIGHT",
    },
    ...overrides,
  };
}

async function withFigmaResponses<T>(
  responses: Record<string, unknown>,
  run: (requests: string[]) => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (input: string | URL | Request) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url.pathname);
    if (url.origin !== "https://api.figma.com" || !Object.hasOwn(responses, url.pathname)) {
      return Response.json({ error: `Unexpected offline request: ${url}` }, { status: 500 });
    }
    return Response.json(responses[url.pathname]);
  };
  try {
    return await run(requests);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function requestStyledDesign() {
  const fileKey = `styleMap${randomUUID().replaceAll("-", "")}`;
  const filePath = `/v1/files/${fileKey}`;
  const document = styledRectangle({ type: "FRAME", children: [styledText()] });
  const service = new FigmaService({
    figmaApiKey: "offline-style-map-token",
    figmaOAuthToken: "",
    useOAuth: false,
  });
  return withFigmaResponses(
    {
      [`${filePath}/styles`]: { meta: { styles: PUBLISHED_STYLES } },
      [`${filePath}/nodes`]: {
        nodes: {
          [ROOT_NODE_ID]: {
            document,
            styles: NODE_RESPONSE_STYLE_MAP,
            components: {},
            componentSets: {},
          },
        },
      },
      [`${filePath}/comments`]: { comments: [] },
    },
    async (requests) => {
      const result = await getFigmaDesignTool.handler(
        { fileKey, nodeId: ROOT_NODE_ID, resolveVariables: false },
        service,
        { outputFormat: "json", renderImage: false },
      );
      return { result, requests };
    },
  );
}

describe("styleMap compatibility and effective node styles", () => {
  it("keeps the node's effective fill when published shared-style metadata is supplied", () => {
    const result = buildNormalizedGraph(styledRectangle(), PUBLISHED_STYLE_MAP);

    expect(result.root.style?.background).toBe(EXPECTED_RECTANGLE_STYLE.background);
  });

  it("keeps the node's effective stroke and width when a shared style is referenced", () => {
    const result = buildNormalizedGraph(styledRectangle(), PUBLISHED_STYLE_MAP);

    expect(result.root.style).toMatchObject({ border: "#0000FF", borderWidth: 3 });
  });

  it("keeps the node's effective shadow when a shared effect style is referenced", () => {
    const result = buildNormalizedGraph(styledRectangle(), PUBLISHED_STYLE_MAP);

    expect(result.root.style?.shadow).toBe(EXPECTED_RECTANGLE_STYLE.shadow);
  });

  it("keeps effective text typography and color instead of shared-style metadata", () => {
    const result = buildNormalizedGraph(styledText(), PUBLISHED_STYLE_MAP);

    expect(result.root.style).toEqual(EXPECTED_TEXT_STYLE);
  });

  it("preserves effective paint and effect values without shared-style references", () => {
    const result = buildNormalizedGraph(styledRectangle({ styles: undefined }), {});

    expect(result.root.style).toEqual(EXPECTED_RECTANGLE_STYLE);
  });

  it("preserves typography and color without shared-style references", () => {
    const result = buildNormalizedGraph(styledText({ styles: undefined }), {});

    expect(result.root.style).toEqual(EXPECTED_TEXT_STYLE);
  });

  it("accepts node-response metadata keyed by style ID without confusing published keys", () => {
    const result = buildNormalizedGraph(
      { document: styledRectangle(), styles: NODE_RESPONSE_STYLE_MAP },
      PUBLISHED_STYLE_MAP,
    );

    expect(result.root.style).toEqual(EXPECTED_RECTANGLE_STYLE);
  });

  it("keeps the public fetchStyles helper keyed by published keys, not node style IDs", async () => {
    const result = await withFigmaResponses(
      { "/v1/files/StyleCompatibility/styles": { meta: { styles: PUBLISHED_STYLES } } },
      async () => fetchStyles("StyleCompatibility", { "X-Figma-Token": "offline-token" }),
    );

    expect(result).toEqual(PUBLISHED_STYLE_MAP);
    expect(result[NODE_STYLE_IDS.fill]).toBeUndefined();
  });

  it("preserves a TEXT node's typography even when no fills are present", () => {
    const result = buildNormalizedGraph(styledText({ fills: undefined }), PUBLISHED_STYLE_MAP);
    const { color, ...expectedTypography } = EXPECTED_TEXT_STYLE;
    void color;

    expect(result.root.style).toEqual(expectedTypography);
  });
});

describe("getFigmaDesignTool style request policy", () => {
  it("does not call the unused published styles endpoint", async () => {
    const { requests } = await requestStyledDesign();

    expect(requests.filter((path) => path.endsWith("/styles"))).toEqual([]);
  });

  it("returns accurate inline overridden paint, effect, and text styles", async () => {
    const { result } = await requestStyledDesign();
    expect(result).not.toHaveProperty("isError", true);
    const response = JSON.parse(result.content[0].text) as MCPResponse;
    const tokens = response.tokens ?? {};
    const textNode = response.root.children?.[0];

    expect(resolveStyleTokens(response.root.style ?? {}, tokens)).toMatchObject(
      EXPECTED_RECTANGLE_STYLE,
    );
    expect(textNode).toMatchObject({ type: "TEXT", text: "Effective text" });
    expect(resolveStyleTokens(textNode?.style ?? {}, tokens)).toMatchObject(EXPECTED_TEXT_STYLE);
  });
});
