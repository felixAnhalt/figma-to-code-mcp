import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { vi } from "vitest";
import { fetchNodesBatch } from "~/figma/batchFetch";
import { buildNormalizedGraph } from "~/figma/reducer";
import type { MCPResponse } from "~/figma/types";
import type { VariableResolutionContext } from "~/figma/variableResolver";
import { getFigmaDesignTool } from "~/mcp/tools/getFigmaDesignTool";
import { FigmaService } from "~/services/figmaConnector";

vi.mock("~/figma/batchFetch", () => ({ fetchNodesBatch: vi.fn() }));
vi.mock("~/figma/fetch", () => ({
  fetchComments: async () => [],
  fetchVariables: async () => null,
}));

const RED = { type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } };
const BLUE = { type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } };
const HANDLES = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
  { x: 1, y: 0 },
];
const PATH = "M0 0L10 0L10 10ZM20 20L30 20L30 30Z";
let directory: string;

function textNode() {
  return {
    id: "1:2",
    type: "TEXT",
    name: "Heading",
    characters: "A blue word",
    fills: [RED],
    style: { fontFamily: "Inter", fontSize: 20, fontWeight: 400 },
    characterStyleOverrides: [0, 0, 1, 1, 1, 1, 0, 0, 0, 0, 0],
    styleOverrideTable: { "1": { fills: [BLUE] } },
  };
}

function vectorNode() {
  return {
    id: "1:5",
    type: "VECTOR",
    name: "Series",
    layoutPositioning: "ABSOLUTE",
    relativeTransform: [
      [1, 0, 0],
      [0, 1, 0],
    ],
    size: { x: 100, y: 60 },
    fills: [BLUE],
    fillGeometry: [{ path: PATH }],
  };
}

function fixture() {
  return {
    document: {
      id: "1:1",
      type: "FRAME",
      name: "Fidelity fixture",
      layoutMode: "VERTICAL",
      children: [
        textNode(),
        {
          id: "1:3",
          type: "FRAME",
          name: "Stage",
          layoutMode: "VERTICAL",
          size: { x: 200, y: 120 },
          layoutSizingHorizontal: "FIXED",
          layoutSizingVertical: "FIXED",
          fills: [
            {
              type: "GRADIENT_LINEAR",
              gradientHandlePositions: HANDLES,
              gradientStops: [
                { position: 0, color: RED.color },
                { position: 1, color: BLUE.color },
              ],
            },
          ],
          strokes: [RED],
          strokeWeight: 1,
          individualStrokeWeights: { top: 0, right: 0, bottom: 1, left: 0 },
          children: [
            {
              id: "1:4",
              type: "FRAME",
              name: "Chart",
              layoutMode: "VERTICAL",
              size: { x: 100, y: 60 },
              layoutSizingHorizontal: "FIXED",
              layoutSizingVertical: "FIXED",
              children: [vectorNode()],
            },
            {
              id: "1:6",
              type: "TEXT",
              name: "Overlay",
              characters: "Done",
              layoutPositioning: "ABSOLUTE",
              relativeTransform: [
                [1, 0, 140],
                [0, 1, 80],
              ],
              size: { x: 40, y: 20 },
              fills: [BLUE],
              style: { fontFamily: "Inter", fontSize: 12, fontWeight: 400 },
            },
          ],
        },
      ],
    },
    components: {},
    componentSets: {},
    styles: {},
  };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "figma-fidelity-pipeline-"));
  vi.mocked(fetchNodesBatch).mockResolvedValue({ "1:1": fixture() } as unknown as Awaited<
    ReturnType<typeof fetchNodesBatch>
  >);
});

afterEach(async () => {
  vi.clearAllMocks();
  await rm(directory, { recursive: true, force: true });
});

async function requestDesign(
  fileKey = `Fidelity${randomUUID().replaceAll("-", "")}`,
  outputDirectory = directory,
): Promise<MCPResponse> {
  const service = new FigmaService({
    figmaApiKey: "offline-fidelity",
    figmaOAuthToken: "",
    useOAuth: false,
  });
  const result = await getFigmaDesignTool.handler(
    { fileKey, nodeId: "1:1", resolveVariables: false },
    service,
    { outputFormat: "json", svgOutputDir: outputDirectory, renderImage: false },
  );
  expect(result).not.toHaveProperty("isError", true);
  return JSON.parse(result.content[0].text) as MCPResponse;
}

it("preserves rich text, overlay coordinates, edge borders and gradient geometry through the actual tool", async () => {
  const response = await requestDesign();
  const [heading, stage] = response.root.children!;
  expect(heading.textRuns?.map((run) => run.text).join("")).toBe(heading.text);
  expect(heading.textRuns?.some((run) => run.text === "blue" && run.style?.color)).toBe(true);
  expect(stage.layout?.position).toBe("relative");
  expect(stage.style?.borderWidths).toEqual({ top: 0, right: 0, bottom: 1, left: 0 });
  expect(stage.style?.borderWidth).toBeUndefined();
  expect(stage.style?.background).toMatchObject([{ gradientHandlePositions: HANDLES }]);
  expect(stage.children![1].layout).toMatchObject({ position: "absolute", left: 140, top: 80 });
  expect(stage.children![0].layout?.position).toBe("relative");
  expect(stage.children![0].children![0].layout).toMatchObject({
    position: "absolute",
    left: 0,
    top: 0,
  });
  expect(JSON.stringify(response)).not.toContain("_varRefs");
});

it("exports finite SVG assets without recentering a vector's original canvas", async () => {
  const response = await requestDesign();
  const vector = response.root.children![1].children![0].children![0];
  const filename = vector.svgPathInAssetFolder!;
  const content = await readFile(join(directory, filename), "utf8");
  expect(content).not.toMatch(/NaN|Infinity/);
  const values = content
    .match(/viewBox="([^"]+)"/)?.[1]
    .split(/\s+/)
    .map(Number);
  expect(values).toEqual([0, 0, 100, 60]);
  const rasterized = await sharp(Buffer.from(content)).resize(100, 60).png().toBuffer();
  expect((await sharp(rasterized).metadata()).width).toBe(100);
});

it("retains viewport metadata and solid asset paint on design-cache hits in a second output directory", async () => {
  const fileKey = `Viewport${randomUUID().replaceAll("-", "")}`;
  const first = await requestDesign(fileKey);
  const secondDirectory = join(directory, "cached-assets");
  const second = await requestDesign(fileKey, secondDirectory);
  expect(fetchNodesBatch).toHaveBeenCalledTimes(1);
  const firstVector = first.root.children![1].children![0].children![0];
  const secondVector = second.root.children![1].children![0].children![0];
  expect(firstVector.svgViewport).toEqual({ width: 100, height: 60 });
  expect(secondVector.svgViewport).toEqual(firstVector.svgViewport);
  const content = await readFile(join(secondDirectory, secondVector.svgPathInAssetFolder!), "utf8");
  expect(content).toContain('fill="#0000FF"');
});

it("resolves each merged vector's own solid paint and paint opacity", async () => {
  const variableId = "VariableID:merged-paint";
  const context: VariableResolutionContext = {
    activeModes: new Map(),
    variableNames: new Map([[variableId, "brand.red"]]),
    variableValues: new Map([[variableId, RED.color]]),
  };
  const red = {
    ...vectorNode(),
    id: "3:2",
    fills: [
      {
        ...BLUE,
        opacity: 0.5,
        boundVariables: { color: { type: "VARIABLE_ALIAS", id: variableId } },
      },
    ],
  };
  const blue = { ...vectorNode(), id: "3:3" };
  const graph = buildNormalizedGraph(
    {
      id: "3:1",
      type: "GROUP",
      name: "Two-color icon",
      size: { x: 100, y: 60 },
      children: [red, blue],
    },
    {},
    context,
    {},
    "MergedPaint",
  );
  await graph.flushVectorSvgs(directory);
  expect(graph.root.children).toHaveLength(1);
  const vector = graph.root.children![0];
  const content = await readFile(join(directory, vector.svgPathInAssetFolder!), "utf8");
  expect(content).toContain('fill="#FF000080"');
  expect(content).toContain('fill="#0000FF"');
});

it.each(["absolute", "flow"])(
  "retains same-fill rectangles that carry %s layout information",
  (mode) => {
    const white = [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }];
    const rectangle = {
      id: "2:2",
      type: "RECTANGLE",
      name: "Positioned or sized rectangle",
      fills: white,
      size: { x: 50, y: 20 },
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
      ...(mode === "absolute"
        ? {
            layoutPositioning: "ABSOLUTE",
            relativeTransform: [
              [1, 0, 10],
              [0, 1, 20],
            ],
          }
        : {}),
    };
    const result = buildNormalizedGraph(
      {
        id: "2:1",
        type: "FRAME",
        layoutMode: "VERTICAL",
        fills: white,
        children: [rectangle],
      },
      {},
    );
    expect(result.root.children?.[0]).toMatchObject({
      type: "RECTANGLE",
      layout: { width: "50px", height: "20px" },
    });
    if (mode === "absolute")
      expect(result.root.children?.[0].layout).toMatchObject({
        position: "absolute",
        left: 10,
        top: 20,
      });
  },
);
