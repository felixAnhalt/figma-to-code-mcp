import sharp from "sharp";
import type { V3Node } from "~/figma/types";
import type { FigmaRawNode } from "~/figma/reducer/types";
import { buildNormalizedGraph } from "~/figma/reducer";
import { prepareVectorAssets, type PendingVectorWriteInput } from "~/figma/reducer/flush";
import { getVectorCanvasBounds } from "~/figma/reducer/vector";
import {
  buildSvgContent,
  buildSvgContentFromEntries,
  buildSvgContentWithFills,
  computeBoundsFromPaths,
  computePathBounds,
  resolveVectorUri,
  writeVectorSvg,
  type SvgBounds,
} from "~/figma/svg";

function expectBounds(actual: SvgBounds | undefined, expected: SvgBounds) {
  expect(actual).toBeDefined();
  for (const key of ["x", "y", "width", "height"] as const) {
    expect(actual?.[key]).toBeCloseTo(expected[key], 5);
  }
}

function readViewBox(content: string): number[] {
  const match = content.match(/viewBox="([^"]+)"/);
  expect(match).not.toBeNull();
  const values = match![1].split(/\s+/).map(Number);
  expect(values).toHaveLength(4);
  expect(values.every(Number.isFinite)).toBe(true);
  expect(values[2]).toBeGreaterThan(0);
  expect(values[3]).toBeGreaterThan(0);
  return values;
}

const MULTI_SUBPATH = "M0 0L10 0L10 10ZM20 20L30 20L30 30Z";
const SMALL_PATH = [{ d: "M40 20L60 20L60 40Z" }];
const CANVAS = { x: 0, y: 0, width: 500, height: 122 };

describe("SVG path bounds grammar and extrema", () => {
  it.each([
    ["multiple subpaths", MULTI_SUBPATH, { x: 0, y: 0, width: 30, height: 30 }],
    ["repeated moveto coordinates", "M0 0 10 20 30 10Z", { x: 0, y: 0, width: 30, height: 20 }],
    ["repeated lineto coordinates", "M0 0L10 20 30 10Z", { x: 0, y: 0, width: 30, height: 20 }],
    ["relative moveto and lineto", "m10 10 5 0 0 5l-20 0z", { x: -5, y: 10, width: 20, height: 5 }],
    [
      "relative horizontal/vertical",
      "M10 10h10 10v5 5h-40z",
      { x: -10, y: 10, width: 40, height: 10 },
    ],
    [
      "absolute horizontal/vertical",
      "M10 10H30 -10V40 -20Z",
      { x: -10, y: -20, width: 40, height: 60 },
    ],
    [
      "closepath resets current point",
      "M10 10l10 0 0 10zl-15 -5",
      { x: -5, y: 5, width: 25, height: 15 },
    ],
    ["relative subpath origin", "M10 10l10 0zm-5 -5l2 2", { x: 5, y: 5, width: 15, height: 5 }],
    [
      "scientific notation and signed numbers",
      "M-1e1,+2e1L+3e1,-4E+1",
      { x: -10, y: -40, width: 40, height: 60 },
    ],
    ["adjacent signed decimals", "M-.5-.5L.5.5", { x: -0.5, y: -0.5, width: 1, height: 1 }],
    [
      "cubic extrema, not control hull",
      "M0 0C0 100 100 100 100 0",
      { x: 0, y: 0, width: 100, height: 75 },
    ],
    [
      "relative cubic extrema",
      "m-50 -20c0 100 100 100 100 0",
      { x: -50, y: -20, width: 100, height: 75 },
    ],
    [
      "smooth cubic reflection",
      "M0 0C0 100 100 100 100 0S200 -100 200 0",
      { x: 0, y: -75, width: 200, height: 150 },
    ],
    [
      "relative smooth cubic reflection",
      "m0 0c0 100 100 100 100 0s100 -100 100 0",
      { x: 0, y: -75, width: 200, height: 150 },
    ],
    ["quadratic extrema", "M0 0Q50 100 100 0", { x: 0, y: 0, width: 100, height: 50 }],
    [
      "smooth quadratic reflection",
      "M0 0Q50 100 100 0T200 0",
      { x: 0, y: -50, width: 200, height: 100 },
    ],
    [
      "relative smooth quadratic",
      "m-100 0q50 100 100 0t100 0",
      { x: -100, y: -50, width: 200, height: 100 },
    ],
    [
      "arc extrema beyond endpoints",
      "M0 0A10 10 0 0 1 20 0",
      { x: 0, y: -10, width: 20, height: 10 },
    ],
    [
      "relative elliptical arc",
      "m-20 0a20 10 0 0 1 40 0",
      { x: -20, y: -10, width: 40, height: 10 },
    ],
    [
      "rotated elliptical arc",
      "M0 20A20 10 90 0 1 0 -20",
      { x: -10, y: -20, width: 10, height: 40 },
    ],
    ["arc compact flags", "M0 0A10 10 0 0120 0", { x: 0, y: -10, width: 20, height: 10 }],
  ])("computes %s", (_name, path, expected) => {
    expectBounds(computePathBounds(path), expected);
  });

  it.each([
    "",
    "not a path",
    "M",
    "M0",
    "L1 2",
    "M0 0L10",
    "M0 0X1 2",
    "M0 0LNaN 2",
    "M0 0L1e309 2",
    "M0 0C1e309 0 1e309 10 10 10",
    "M0 0A10 10 0 2 0 20 0",
  ])("rejects malformed or non-finite data %j without throwing", (path) => {
    expect(computePathBounds(path)).toBeUndefined();
  });

  it("combines multiple subpaths without NaN", () => {
    expectBounds(computeBoundsFromPaths([{ d: MULTI_SUBPATH }]), {
      x: -0.3,
      y: -0.3,
      width: 30.6,
      height: 30.6,
    });
  });

  it("preserves negative origins and padding around the whole shape", () => {
    expectBounds(computeBoundsFromPaths([{ d: "M-20 -10L-10 -10L-10 10Z" }]), {
      x: -20.1,
      y: -10.2,
      width: 10.2,
      height: 20.4,
    });
  });

  it("unions paths and skips malformed entries", () => {
    expectBounds(
      computeBoundsFromPaths([{ d: "M0 0L10 10" }, { d: "broken" }, { d: "M-20 -10L-5 -2" }]),
      {
        x: -20.3,
        y: -10.2,
        width: 30.6,
        height: 20.4,
      },
    );
  });

  it.each(["M5 5", "M0 0H10", "M0 0V10", "M0 0L0.000001 0.000001"])(
    "exports a positive finite viewBox for degenerate or tiny geometry %s",
    (d) => {
      const paths = [{ d }];
      const bounds = computeBoundsFromPaths(paths);
      expect(bounds?.width).toBeGreaterThan(0);
      expect(bounds?.height).toBeGreaterThan(0);
      readViewBox(buildSvgContent(paths, bounds));
    },
  );

  it("returns no computed bounds for entirely invalid geometry", () => {
    expect(computeBoundsFromPaths([{ d: "broken" }])).toBeUndefined();
    expect(computeBoundsFromPaths([])).toBeUndefined();
  });
});

describe("SVG export canvas fidelity", () => {
  it("honors explicit single-vector local canvas rather than recentering paths", () => {
    const target: V3Node = { id: "chart", type: "VECTOR", name: "Series" };
    const [asset] = prepareVectorAssets([
      { fileKey: "file", nodeId: "chart", target, paths: SMALL_PATH, bounds: CANVAS },
    ]);
    expect(readViewBox(asset.content)).toEqual([0, 0, 500, 122]);
    expect(asset.content).toContain('width="500"');
    expect(asset.content).toContain('height="122"');
    expect(asset.content).toContain('d="M40 20L60 20L60 40Z"');
  });

  it("honors explicit bounds for the legacy cached SVG writer", async () => {
    const uri = await writeVectorSvg("svg-bounds", "canvas", SMALL_PATH, CANVAS);
    expect(uri).toBeDefined();
    expect(readViewBox((await resolveVectorUri(uri!))!)).toEqual([0, 0, 500, 122]);
  });

  it("keeps two chart series on their shared 500 by 122 canvas", () => {
    const assets = prepareVectorAssets(
      ["M0 100C100 100 400 0 500 0", "M0 122C100 122 400 20 500 20"].map((d, i) => ({
        fileKey: "file",
        nodeId: `series-${i}`,
        target: { id: `series-${i}`, type: "VECTOR", name: "Series" },
        paths: [{ d }],
        bounds: CANVAS,
      })),
    );
    expect(assets.map((asset) => readViewBox(asset.content))).toEqual([
      [0, 0, 500, 122],
      [0, 0, 500, 122],
    ]);
  });

  it("keeps merged bounds origins and exact fractional canvas dimensions", () => {
    const content = buildSvgContentWithFills(SMALL_PATH, {
      x: -3.25,
      y: 7.5,
      width: 100.25,
      height: 40.5,
    });
    expect(readViewBox(content)).toEqual([-3.25, 7.5, 100.25, 40.5]);
    expect(content).toContain('width="100.25"');
    expect(content).toContain('height="40.5"');
  });

  it("computes merged fallback bounds after transforming the geometry", () => {
    const content = buildSvgContentFromEntries([
      { paths: [{ d: MULTI_SUBPATH }], transform: [1, 0, 0, 1, -50, -40] },
    ]);
    expect(readViewBox(content)).toEqual([-50.3, -40.3, 30.6, 30.6]);
  });

  it("retains the low-level builder's explicit canvas contract", () => {
    const content = buildSvgContent([{ d: "M-1 -1H11V1H-1Z" }], {
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    });
    expect(readViewBox(content)).toEqual([0, 0, 10, 10]);
    expect(content).toContain('overflow="visible"');
    expect(content).toContain('d="M-1 -1H11V1H-1Z"');
  });

  it.each([
    { x: NaN, y: 0, width: 10, height: 10 },
    { x: 0, y: Infinity, width: 10, height: 10 },
    { x: 0, y: 0, width: 0, height: 10 },
    { x: 0, y: 0, width: -10, height: 10 },
    { x: 0, y: 0, width: 10, height: Infinity },
  ])("falls back from invalid explicit bounds %j", (bounds) => {
    const expected = [39.8, 19.8, 20.4, 20.4];
    expect(readViewBox(buildSvgContent(SMALL_PATH, bounds))).toEqual(expected);
    expect(readViewBox(buildSvgContentWithFills(SMALL_PATH, bounds))).toEqual(expected);
  });

  it("uses a finite unit canvas when neither explicit bounds nor geometry is usable", () => {
    expect(
      readViewBox(buildSvgContent([{ d: "bad" }], { x: NaN, y: 0, width: 0, height: 0 })),
    ).toEqual([0, 0, 1, 1]);
    expect(readViewBox(buildSvgContentWithFills([]))).toEqual([0, 0, 1, 1]);
  });

  it("keeps graph export without raw local size working with computed geometry bounds", () => {
    const raw: FigmaRawNode = {
      id: "svg-fallback",
      type: "VECTOR",
      fillGeometry: [{ path: MULTI_SUBPATH }],
    };
    const pending: PendingVectorWriteInput[] = [];
    buildNormalizedGraph(raw, {}, undefined, {}, "bounds-fallback", {}, pending);
    expect(readViewBox(prepareVectorAssets(pending)[0].content)).toEqual([0, 0, 30, 30]);
  });

  it("rasterizes a multi-subpath export into visible pixels", async () => {
    const content = buildSvgContent(
      [{ d: MULTI_SUBPATH }],
      computeBoundsFromPaths([{ d: MULTI_SUBPATH }]),
    );
    const { data, info } = await sharp(Buffer.from(content))
      .resize(64, 64)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(64);
    expect(info.height).toBe(64);
    const alpha = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3];
    expect(alpha(16, 8)).toBeGreaterThan(0);
    expect(alpha(58, 50)).toBeGreaterThan(0);
    expect(alpha(32, 32)).toBe(0);
  });
});

describe("vector local canvas helper", () => {
  it("uses local size, not a translated or rotated absolute bounding box", () => {
    expect(
      getVectorCanvasBounds({
        id: "canvas",
        type: "VECTOR",
        size: { x: 500, y: 122 },
        absoluteBoundingBox: { x: -300, y: 900, width: 122, height: 500 },
      }),
    ).toEqual(CANVAS);
  });

  it.each([
    {},
    { size: { x: 10, y: -1 } },
    { size: { x: NaN, y: 10 } },
    { size: { x: 10, y: Infinity } },
    { size: { x: 10 } },
    { absoluteBoundingBox: { x: 10, y: 20, width: 500, height: 122 } },
  ])("leaves missing or invalid local sizes for computed bounds %j", (properties) => {
    expect(getVectorCanvasBounds({ id: "invalid", type: "VECTOR", ...properties })).toBeUndefined();
  });
});
