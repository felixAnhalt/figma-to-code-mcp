import sharp from "sharp";
import {
  buildSvgContentFromEntries,
  computePathBounds,
  transformPath,
  type SvgPathEntry,
} from "~/figma/svg";

const CANVAS = { x: -100, y: -100, width: 300, height: 300 };
const IDENTITY: NonNullable<SvgPathEntry["transform"]> = [1, 0, 0, 1, 0, 0];

function emittedPath(content: string): string {
  const d = content.match(/<path[^>]*d="([^"]+)"/)?.[1];
  expect(d).toBeDefined();
  return d!;
}

async function rasterGeometry(d: string) {
  return sharp(
    Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="-100 -100 300 300"><path d="${d}" fill="#3864E8"/></svg>`,
    ),
  )
    .ensureAlpha()
    .raw()
    .toBuffer();
}

describe("merged SVG affine path geometry", () => {
  it.each([
    {
      name: "identity relative/repeated lineto",
      d: "m10 10l10 0 0 10z",
      transform: IDENTITY,
      expected: "M10 10L20 10L20 20Z",
    },
    {
      name: "translation does not translate relative deltas",
      d: "m10 10l10 0 0 10z",
      transform: [1, 0, 0, 1, 20, 30],
      expected: "M30 40L40 40L40 50Z",
    },
    {
      name: "repeated moveto is relative to the previous point",
      d: "m10 10 10 0 0 10z",
      transform: [2, 0, 0, 2, 5, 7],
      expected: "M25 27L45 27L45 47Z",
    },
    {
      name: "rotated absolute horizontal and vertical lines",
      d: "M10 10H30V20H10Z",
      transform: [0, 1, -1, 0, 0, 0],
      expected: "M-10 10L-10 30L-20 30L-20 10Z",
    },
    {
      name: "rotated relative horizontal and vertical lines",
      d: "m10 10h20v10h-20z",
      transform: [0, 1, -1, 0, 5, 7],
      expected: "M-5 17L-5 37L-15 37L-15 17Z",
    },
    {
      name: "nonuniformly scaled elliptical arc radii",
      d: "M0 0A10 5 0 0 1 20 0L0 0Z",
      transform: [2, 0, 0, 3, 5, 7],
      expected: "M5 7A20 15 0 0 1 45 7L5 7Z",
    },
    {
      name: "rotated arc axis",
      d: "M0 0A10 5 0 0 1 20 0L0 0Z",
      transform: [0, 1, -1, 0, 5, 7],
      expected: "M5 7A10 5 90 0 1 5 27L5 7Z",
    },
    {
      name: "reflected relative arc sweep",
      d: "m0 0a10 5 0 0 1 20 0l-20 0z",
      transform: [-1, 0, 0, 1, 5, 7],
      expected: "M5 7A10 5 0 0 0 -15 7L5 7Z",
    },
    {
      name: "closepath then relative subpath",
      d: "M10 10l10 0 0 10zm30 0l10 0 0 10z",
      transform: [1, 0, 0, 1, 5, 7],
      expected: "M15 17L25 17L25 27ZM45 17L55 17L55 27Z",
    },
  ])("preserves $name in the actual merged SVG", async ({ d, transform, expected }) => {
    const content = buildSvgContentFromEntries(
      [{ paths: [{ d }], transform: transform as SvgPathEntry["transform"] }],
      CANVAS,
    );
    const actual = emittedPath(content);
    const bounds = computePathBounds(actual);
    const expectedBounds = computePathBounds(expected);
    expect(bounds).toBeDefined();
    for (const key of ["x", "y", "width", "height"] as const)
      expect(bounds![key]).toBeCloseTo(expectedBounds![key], 3);
    const actualRaster = await rasterGeometry(actual);
    expect(actualRaster.equals(await rasterGeometry(expected))).toBe(true);
  });

  it("keeps the public transformPath identity from widening relative geometry", () => {
    expect(computePathBounds(transformPath("m10 10l10 0 0 10z", IDENTITY))).toEqual({
      x: 10,
      y: 10,
      width: 10,
      height: 10,
    });
  });
});
