import { describe, expect, it } from "vitest";
import { toEmittedSvgViewport } from "~/figma/svg/transform";

describe("toEmittedSvgViewport", () => {
  it("omits x and y when they are zero within float noise", () => {
    const emitted = toEmittedSvgViewport({ x: -2.3e-8, y: -1.4e-6, width: 19.9, height: 19.9 });

    expect(Object.keys(emitted)).toEqual(["width", "height"]);
  });

  it("keeps an offset that is visible and omits one that is not", () => {
    const emitted = toEmittedSvgViewport({ x: -0.8, y: 0.004, width: 8.1, height: 5.18 });

    expect(Object.keys(emitted)).toEqual(["x", "width", "height"]);
    expect(emitted.x).toBe(-0.8);
  });
});
