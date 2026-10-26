import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { vi } from "vitest";
import { fetchNodesBatch } from "~/figma/batchFetch";
import { generateMCPResponse } from "~/figma/mcp";
import { prepareVectorAssets, type PendingVectorWriteInput } from "~/figma/reducer/flush";
import * as vector from "~/figma/reducer/vector";
import type { FigmaRawNode } from "~/figma/reducer/types";
import { computePathBounds, type SvgBounds } from "~/figma/svg";
import type { V3Node } from "~/figma/types";
import type { VariableResolutionContext } from "~/figma/variableResolver";
import { Logger } from "~/utils/logger";

vi.mock("~/figma/batchFetch", () => ({ fetchNodesBatch: vi.fn() }));
vi.mock("~/figma/fetch", () => ({
  fetchComments: async () => [],
  fetchVariables: async () => null,
}));

const BLUE = { type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } };
const RED = { type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } };
const SMALL_CANVAS = { x: 0, y: 0, width: 6.5, height: 3.25 };
const OUTLINE = "M-0.8 -0.8H7.300005V4.38137H-0.8Z";
const FRAME = { x: -2, y: -2, width: 12, height: 8 };
const SCALE = 20;
type ExportTarget = V3Node & { svgViewport?: SvgBounds };
type ColoredWrite = PendingVectorWriteInput & { fillColor?: string };

afterEach(() => vi.restoreAllMocks());

function prepareSingle(paths = [{ d: OUTLINE }], bounds: SvgBounds | undefined = SMALL_CANVAS) {
  const target: ExportTarget = {
    type: "VECTOR",
    layout: { width: "6.5px", height: "3.25px" },
    style: { opacity: 0.5 },
  };
  const writes: ColoredWrite[] = [
    { fileKey: "external", nodeId: "outline", paths, target, bounds, fillColor: "#0000FF" },
  ];
  return { target, asset: prepareVectorAssets(writes)[0] };
}

function externalImage(content: string, viewport: SvgBounds): string {
  const href = `data:image/svg+xml;base64,${Buffer.from(content).toString("base64")}`;
  return `<image href="${href}" x="${viewport.x}" y="${viewport.y}" width="${viewport.width}" height="${viewport.height}"/>`;
}

async function raster(markup: string, frame: SvgBounds = FRAME, scale = SCALE) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width * scale}" height="${frame.height * scale}" viewBox="${frame.x} ${frame.y} ${frame.width} ${frame.height}">${markup}</svg>`;
  const { data, info } = await sharp(Buffer.from(svg))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return {
    data,
    pixel: (x: number, y: number) => {
      const index =
        (Math.floor((y - frame.y) * scale) * info.width + Math.floor((x - frame.x) * scale)) *
        info.channels;
      return [...data.subarray(index, index + info.channels)];
    },
  };
}

function expectViewportMatchesFile(content: string, viewport: SvgBounds | undefined) {
  expect(viewport).toBeDefined();
  const viewBox = content
    .match(/viewBox="([^"]+)"/)?.[1]
    .split(/\s+/)
    .map(Number);
  expect(viewBox).toEqual([viewport!.x, viewport!.y, viewport!.width, viewport!.height]);
  expect(content).toContain(`width="${viewport!.width}"`);
  expect(content).toContain(`height="${viewport!.height}"`);
}

describe("external SVG image viewports", () => {
  it("rasterizes negative-edge ink through an actual external image instead of clipping it", async () => {
    const { target, asset } = prepareSingle();
    const rendered = await raster(externalImage(asset.content, target.svgViewport ?? SMALL_CANVAS));
    expect(rendered.pixel(-0.4, 0)[3], "negative stroke edge must survive the image viewport").toBe(
      255,
    );
    expect(rendered.pixel(7, 4)[3], "right/bottom overflow must survive too").toBeGreaterThan(0);
    expectViewportMatchesFile(asset.content, target.svgViewport);
    expect(target.svgViewport).toEqual({ x: -0.8, y: -0.8, width: 8.1, height: 5.1814 });
    expect(target.layout).toEqual({ width: "6.5px", height: "3.25px" });
    expect(target.style?.opacity).toBe(0.5);
  });

  it("matches inline paint, opacity and landmarks without translating paths twice", async () => {
    const { target, asset } = prepareSingle();
    const external = await raster(
      `<g opacity="0.5">${externalImage(asset.content, target.svgViewport ?? SMALL_CANVAS)}</g>`,
    );
    const inline = await raster(
      '<g opacity="0.5"><path d="M-0.8 -0.8H7.3V4.3814H-0.8Z" fill="#0000FF"/></g>',
    );
    expect(external.pixel(2, 1)).toEqual([0, 0, 255, 128]);
    for (const [x, y] of [
      [-0.4, 0],
      [2, 1],
      [5, 1],
      [8, 4],
    ]) {
      expect(external.pixel(x, y)).toEqual(inline.pixel(x, y));
    }
    expect(asset.content).not.toMatch(/opacity="0\.5"|transform=/);
  });

  it("keeps different chart ink extents aligned when images consume viewport metadata", async () => {
    const canvas = { x: 0, y: 0, width: 500, height: 122 };
    const paths = ["M-2 10H502V14H-2Z", "M100 -3H104V125H100Z"];
    const targets: ExportTarget[] = paths.map(() => ({
      type: "VECTOR",
      layout: { width: "500px", height: "122px" },
    }));
    const writes: ColoredWrite[] = paths.map((d, i) => ({
      fileKey: "series",
      nodeId: String(i),
      target: targets[i],
      paths: [{ d }],
      bounds: canvas,
      fillColor: i ? "#FF0000" : "#0000FF",
    }));
    const assets = prepareVectorAssets(writes);
    const frame = { x: -10, y: -10, width: 520, height: 142 };
    const external = await raster(
      assets
        .map((asset, i) => externalImage(asset.content, targets[i].svgViewport ?? canvas))
        .join(""),
      frame,
      1,
    );
    const inline = await raster(
      paths.map((d, i) => `<path d="${d}" fill="${i ? "#FF0000" : "#0000FF"}"/>`).join(""),
      frame,
      1,
    );
    for (const [x, y] of [
      [-1, 12],
      [499, 12],
      [102, -2],
      [102, 124],
      [110, 100],
    ]) {
      expect(external.pixel(x, y), `chart landmark ${x},${y}`).toEqual(inline.pixel(x, y));
    }
    expect(targets.map((target) => target.svgViewport)).toEqual([
      { x: -2, y: 0, width: 504, height: 122 },
      { x: 0, y: -3, width: 500, height: 128 },
    ]);
    expect(
      targets.every(
        (target) => target.layout?.width === "500px" && target.layout.height === "122px",
      ),
    ).toBe(true);
  });

  it("still respects ancestor clipping when consuming an expanded viewport", async () => {
    const { target, asset } = prepareSingle();
    const rendered = await raster(
      `<defs><clipPath id="canvas"><rect width="6.5" height="3.25"/></clipPath></defs><g clip-path="url(#canvas)">${externalImage(asset.content, target.svgViewport ?? SMALL_CANVAS)}</g>`,
    );
    expect(rendered.pixel(-0.4, 0)[3]).toBe(0);
    expect(rendered.pixel(2, 1)[3]).toBe(255);
    expect(rendered.pixel(7, 4)[3]).toBe(0);
  });

  it("measures the rounded serialized paths without strokeWeight or percentage padding", () => {
    const { target, asset } = prepareSingle();
    expect(asset.content).not.toContain("7.300005");
    expect(asset.content).not.toContain("4.38137");
    const serialized = asset.content.match(/<path[^>]* d="([^"]+)"/)?.[1];
    expect(target.svgViewport).toEqual(computePathBounds(serialized!));
    expectViewportMatchesFile(asset.content, target.svgViewport);
  });

  it("keeps compact decimal separators valid when export rounding produces zero", () => {
    const target: ExportTarget = { type: "VECTOR" };
    const [asset] = prepareVectorAssets([
      { fileKey: "rounding", nodeId: "1", target, paths: [{ d: "M.0000001.0000001L1 0L1 1Z" }] },
    ]);
    const serialized = asset.content.match(/<path[^>]* d="([^"]+)"/)?.[1];
    expect(computePathBounds(serialized!)).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expectViewportMatchesFile(asset.content, target.svgViewport);
  });

  it("emits matching viewport metadata for merged assets after rounding and transforming", () => {
    const target: ExportTarget = { type: "VECTOR" };
    const [asset] = prepareVectorAssets([
      {
        fileKey: "merged",
        nodeId: "1",
        target,
        paths: [],
        bounds: { x: 0, y: 0, width: 10, height: 10 },
        entries: [
          {
            paths: [{ d: "M0 0H5.000006V5H0Z", fillColor: "#FF0000" }],
            transform: [1, 0, 0, 1, -2, -3],
          },
        ],
      },
    ]);
    expect(target.svgViewport).toEqual({ x: -2, y: -3, width: 12, height: 13 });
    expectViewportMatchesFile(asset.content, target.svgViewport);
  });

  it.each([undefined, { x: NaN, y: 0, width: 10, height: 10 }])(
    "emits viewport metadata for computed fallback bounds %j",
    (bounds) => {
      const target: ExportTarget = { type: "VECTOR" };
      const [asset] = prepareVectorAssets([
        { fileKey: "fallback", nodeId: "1", target, paths: [{ d: "M-2 -1H3V4H-2Z" }], bounds },
      ]);
      expect(target.svgViewport).toEqual({ x: -2, y: -1, width: 5, height: 5 });
      expectViewportMatchesFile(asset.content, target.svgViewport);
    },
  );

  it("preserves a zero-width canvas in the union before requiring a positive final viewport", () => {
    const { target, asset } = prepareSingle([{ d: "M10 2H20V4H10Z" }], {
      x: 0,
      y: 0,
      width: 0,
      height: 10,
    });
    expect(target.svgViewport).toEqual({ x: 0, y: 0, width: 20, height: 10 });
    expectViewportMatchesFile(asset.content, target.svgViewport);
    expect(
      vector.getVectorCanvasBounds({ id: "zero", type: "VECTOR", size: { x: 0, y: 10 } }),
    ).toEqual({ x: 0, y: 0, width: 0, height: 10 });
  });

  it("emits a finite positive unit viewport even for empty or malformed geometry", () => {
    const { target, asset } = prepareSingle([{ d: "broken" }], { x: 0, y: 0, width: 0, height: 0 });
    expect(target.svgViewport?.width).toBeGreaterThan(0);
    expect(target.svgViewport?.height).toBeGreaterThan(0);
    expectViewportMatchesFile(asset.content, target.svgViewport);
  });
});

describe("standalone vector paint selection", () => {
  function paint(node: FigmaRawNode, context?: VariableResolutionContext) {
    return vector.getVectorPaintColor(node, context);
  }

  it("uses stroke paint for stroke outlines, not the unrelated fill", () => {
    expect(
      paint({
        id: "stroke",
        type: "VECTOR",
        strokeGeometry: [{ path: OUTLINE }],
        fills: [RED],
        strokes: [BLUE],
      }),
    ).toBe("#0000FF");
  });

  it("uses the fill paint when fill geometry wins over stroke geometry", () => {
    expect(
      paint({
        id: "fill",
        type: "VECTOR",
        fillGeometry: [{ path: OUTLINE }],
        strokeGeometry: [{ path: OUTLINE }],
        fills: [RED],
        strokes: [BLUE],
      }),
    ).toBe("#FF0000");
  });

  it("falls back to stroke geometry paint when fill paths are empty", () => {
    expect(
      paint({
        id: "empty-fill",
        type: "VECTOR",
        fillGeometry: [{ path: "" }],
        strokeGeometry: [{ path: OUTLINE }],
        fills: [RED],
        strokes: [{ ...RED, visible: false }, BLUE],
      }),
    ).toBe("#0000FF");
  });

  it("uses resolved fill paint for vector networks and leaves node opacity on its wrapper", () => {
    const context: VariableResolutionContext = {
      variableValues: new Map([["blue", BLUE.color]]),
      variableNames: new Map(),
      activeModes: new Map(),
    };
    expect(
      paint(
        {
          id: "network",
          type: "VECTOR",
          vectorNetwork: {},
          opacity: 0.3,
          fills: [{ ...RED, boundVariables: { color: { type: "VARIABLE_ALIAS", id: "blue" } } }],
        },
        context,
      ),
    ).toBe("#0000FF");
  });

  it("bakes paint-level alpha but does not bake node-level opacity", () => {
    expect(
      paint({
        id: "alpha",
        type: "VECTOR",
        fillGeometry: [{ path: OUTLINE }],
        opacity: 0.2,
        fills: [{ ...BLUE, opacity: 0.5 }],
      }),
    ).toBe("#0000FF80");
  });

  it("warns about unsupported non-solid or stacked vector paints instead of silently choosing one", () => {
    const warning = vi.spyOn(Logger, "warn").mockImplementation(() => undefined);
    expect(
      paint({
        id: "gradient",
        type: "VECTOR",
        fillGeometry: [{ path: OUTLINE }],
        fills: [{ type: "GRADIENT_LINEAR" }],
      }),
    ).toBeUndefined();
    expect(
      paint({
        id: "stacked",
        type: "VECTOR",
        fillGeometry: [{ path: OUTLINE }],
        fills: [RED, BLUE],
      }),
    ).toBeUndefined();
    expect(warning).toHaveBeenCalledTimes(2);
    expect(warning.mock.calls.flat().join(" ")).toContain("unsupported");
  });
});

it("retains export viewport metadata and matching XML when a design artifact is served from cache", async () => {
  const directory = await mkdtemp(join(tmpdir(), "svg-viewport-cache-"));
  try {
    vi.mocked(fetchNodesBatch).mockResolvedValue({
      "1:1": {
        document: {
          id: "1:1",
          type: "VECTOR",
          size: { x: 6.5, y: 3.25 },
          strokeGeometry: [{ path: OUTLINE }],
          strokes: [BLUE],
        },
      },
    } as unknown as Awaited<ReturnType<typeof fetchNodesBatch>>);
    const options = {
      fileKey: `Viewport${randomUUID()}`,
      rootNodeId: "1:1",
      authHeaders: {},
      resolveVariables: false,
      componentMap: {},
    };
    const first = await generateMCPResponse({ ...options, svgOutputDir: join(directory, "first") });
    const firstContent = await readFile(
      join(first.svgAssetsFolder!, first.root.svgPathInAssetFolder!),
      "utf8",
    );
    const viewport = (first.root as ExportTarget).svgViewport;
    expectViewportMatchesFile(firstContent, viewport);
    if (viewport) viewport.x = 999;
    const second = await generateMCPResponse({
      ...options,
      svgOutputDir: join(directory, "second"),
    });
    const secondContent = await readFile(
      join(second.svgAssetsFolder!, second.root.svgPathInAssetFolder!),
      "utf8",
    );
    expect(fetchNodesBatch).toHaveBeenCalledTimes(1);
    expectViewportMatchesFile(secondContent, (second.root as ExportTarget).svgViewport);
    expect(secondContent).toBe(firstContent);
    expect((second.root as ExportTarget).svgViewport?.x).toBe(-0.8);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
