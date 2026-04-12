import { describe, it, expect } from "vitest";
import { extractTokens, normalizeShadowKey } from "~/figma/tokenizer";
import type { MCPResponse, V3Node } from "~/figma/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeResponse(root: V3Node): MCPResponse {
  return { schema: "v3", root };
}

function makeFrame(overrides: Partial<V3Node> = {}): V3Node {
  return { type: "FRAME", ...overrides };
}

// ── Shadow normalization ───────────────────────────────────────────────────────

describe("normalizeShadowKey", () => {
  it("strips spaces inside rgba() and rounds float alpha", () => {
    const raw = "0px 1px 2px 0px rgba(0, 0, 0, 0.05000000074505806)";
    expect(normalizeShadowKey(raw)).toBe("0px 1px 2px 0px rgba(0,0,0,0.05)");
  });

  it("handles multi-shadow strings (comma-separated shadows)", () => {
    const raw =
      "0px 1px 2px -1px rgba(0, 0, 0, 0.10000000149011612), 0px 1px 3px 0px rgba(0, 0, 0, 0.10000000149011612)";
    expect(normalizeShadowKey(raw)).toBe(
      "0px 1px 2px -1px rgba(0,0,0,0.1), 0px 1px 3px 0px rgba(0,0,0,0.1)",
    );
  });

  it("leaves already-clean shadow strings unchanged", () => {
    const clean = "0px 0px 0px 3px rgba(6,182,212,1)";
    expect(normalizeShadowKey(clean)).toBe(clean);
  });

  it("rounds alpha to 2 significant decimal places", () => {
    expect(normalizeShadowKey("0px 0px rgba(0, 0, 0, 0.100)")).toBe("0px 0px rgba(0,0,0,0.1)");
    expect(normalizeShadowKey("0px 0px rgba(255, 0, 0, 1.0)")).toBe("0px 0px rgba(255,0,0,1)");
  });
});

// ── Flat string token refs ─────────────────────────────────────────────────────

describe("extractTokens — flat string token refs", () => {
  it("replaces background color with a flat string like 'colors.white'", () => {
    const response = makeResponse(
      makeFrame({
        children: [
          makeFrame({ style: { background: "rgba(255, 255, 255, 1)" } }),
          makeFrame({ style: { background: "rgba(255, 255, 255, 1)" } }),
        ],
      }),
    );
    const result = extractTokens(response);
    const child = result.root.children![0];
    // Should be a plain string, not { token: "..." }
    expect(child.style?.background).toBe("colors.white");
    expect(typeof child.style?.background).toBe("string");
  });

  it("replaces border color with a flat string", () => {
    const response = makeResponse(
      makeFrame({
        children: [
          makeFrame({ style: { border: "rgba(22, 25, 34, 1)" } }),
          makeFrame({ style: { border: "rgba(22, 25, 34, 1)" } }),
        ],
      }),
    );
    const result = extractTokens(response);
    expect(result.root.children![0].style?.border).toBe("colors.textPrimary");
  });

  it("replaces text color with a flat string", () => {
    const response = makeResponse(
      makeFrame({
        children: [
          { type: "TEXT", style: { color: "rgba(151, 71, 255, 1)" } },
          { type: "TEXT", style: { color: "rgba(151, 71, 255, 1)" } },
        ],
      }),
    );
    const result = extractTokens(response);
    expect(result.root.children![0].style?.color).toBe("colors.primary");
  });

  it("replaces gap with a flat string like 'spacing.lg'", () => {
    const response = makeResponse(
      makeFrame({
        children: [makeFrame({ layout: { gap: 8 } }), makeFrame({ layout: { gap: 8 } })],
      }),
    );
    const result = extractTokens(response);
    expect(result.root.children![0].layout?.gap).toBe("spacing.lg");
  });

  it("replaces radius with a flat string like 'radius.md'", () => {
    const response = makeResponse(
      makeFrame({
        children: [makeFrame({ style: { radius: 8 } }), makeFrame({ style: { radius: 8 } })],
      }),
    );
    const result = extractTokens(response);
    expect(result.root.children![0].style?.radius).toBe("radius.md");
  });

  it("replaces typography with a flat string and removes individual fields", () => {
    const typoNode: V3Node = {
      type: "TEXT",
      style: { font: "Geist", fontSize: 14, fontWeight: 600, lineHeight: 18 },
    };
    const response = makeResponse(makeFrame({ children: [typoNode, { ...typoNode }] }));
    const result = extractTokens(response);
    const child = result.root.children![0].style!;
    expect(child.typography).toBe("typography.labelMd");
    expect(child.font).toBeUndefined();
    expect(child.fontSize).toBeUndefined();
    expect(child.fontWeight).toBeUndefined();
    expect(child.lineHeight).toBeUndefined();
  });

  it("does NOT produce { token: ... } objects anywhere", () => {
    const response = makeResponse(
      makeFrame({
        children: [
          makeFrame({
            style: { background: "rgba(255, 255, 255, 1)", radius: 8 },
            layout: { gap: 8 },
          }),
          makeFrame({
            style: { background: "rgba(255, 255, 255, 1)", radius: 8 },
            layout: { gap: 8 },
          }),
        ],
      }),
    );
    const result = extractTokens(response);
    const json = JSON.stringify(result);
    expect(json).not.toContain('"token"');
  });
});

// ── Shadow float normalization ────────────────────────────────────────────────

describe("extractTokens — shadow semantic names after float normalization", () => {
  it("assigns semantic name 'sm' to shadow with float alpha noise", () => {
    const rawShadow = "0px 1px 2px 0px rgba(0, 0, 0, 0.05000000074505806)";
    const response = makeResponse(
      makeFrame({
        children: [
          makeFrame({ style: { shadow: rawShadow } }),
          makeFrame({ style: { shadow: rawShadow } }),
        ],
      }),
    );
    const result = extractTokens(response);
    expect(result.root.children![0].style?.shadow).toBe("shadows.sm");
    expect(result.tokens?.shadows?.sm).toBeDefined();
  });

  it("assigns semantic name 'md' to double shadow with float alpha noise", () => {
    const rawShadow =
      "0px 1px 2px -1px rgba(0, 0, 0, 0.10000000149011612), 0px 1px 3px 0px rgba(0, 0, 0, 0.10000000149011612)";
    const response = makeResponse(
      makeFrame({
        children: [
          makeFrame({ style: { shadow: rawShadow } }),
          makeFrame({ style: { shadow: rawShadow } }),
        ],
      }),
    );
    const result = extractTokens(response);
    expect(result.root.children![0].style?.shadow).toBe("shadows.md");
  });

  it("assigns 'focusRing' and 'focusRingDestructive' correctly", () => {
    const focusRing = "0px 0px 0px 3px rgba(6, 182, 212, 1)";
    const focusDestructive = "0px 0px 0px 3px rgba(239, 68, 68, 1)";
    const response = makeResponse(
      makeFrame({
        children: [
          makeFrame({ style: { shadow: focusRing } }),
          makeFrame({ style: { shadow: focusRing } }),
          makeFrame({ style: { shadow: focusDestructive } }),
          makeFrame({ style: { shadow: focusDestructive } }),
        ],
      }),
    );
    const result = extractTokens(response);
    expect(result.root.children![0].style?.shadow).toBe("shadows.focusRing");
    expect(result.root.children![2].style?.shadow).toBe("shadows.focusRingDestructive");
  });

  it("does NOT tokenize an unknown shadow value", () => {
    const unknownShadow = "5px 5px 10px rgba(100, 100, 100, 0.5)";
    const response = makeResponse(
      makeFrame({
        children: [
          makeFrame({ style: { shadow: unknownShadow } }),
          makeFrame({ style: { shadow: unknownShadow } }),
        ],
      }),
    );
    const result = extractTokens(response);
    // Should stay as raw string
    expect(result.root.children![0].style?.shadow).toBe(unknownShadow);
    expect(result.tokens?.shadows).toBeUndefined();
  });
});

// ── No fallback tokens for unnamed values ─────────────────────────────────────

describe("extractTokens — no fallback tokens for unnamed values", () => {
  it("does NOT tokenize an unnamed color even if used 10+ times", () => {
    const unknownColor = "rgba(123, 45, 67, 1)";
    const children = Array.from({ length: 10 }, () =>
      makeFrame({ style: { background: unknownColor } }),
    );
    const response = makeResponse(makeFrame({ children }));
    const result = extractTokens(response);
    expect(result.tokens?.colors).toBeUndefined();
    // Raw value preserved
    expect(result.root.children![0].style?.background).toBe(unknownColor);
  });

  it("does NOT tokenize an unnamed spacing value (e.g. 5.5)", () => {
    const children = Array.from({ length: 10 }, () => makeFrame({ layout: { gap: 5.5 } }));
    const response = makeResponse(makeFrame({ children }));
    const result = extractTokens(response);
    expect(result.tokens?.spacing).toBeUndefined();
    expect(result.root.children![0].layout?.gap).toBe(5.5);
  });

  it("does NOT tokenize an unnamed radius value (e.g. 10)", () => {
    const children = Array.from({ length: 10 }, () => makeFrame({ style: { radius: 10 } }));
    const response = makeResponse(makeFrame({ children }));
    const result = extractTokens(response);
    expect(result.tokens?.radius).toBeUndefined();
    expect(result.root.children![0].style?.radius).toBe(10);
  });

  it("only tokenizes values that appear 2+ times AND have a semantic name", () => {
    const response = makeResponse(
      makeFrame({
        children: [
          // white appears twice → should get token
          makeFrame({ style: { background: "rgba(255, 255, 255, 1)" } }),
          makeFrame({ style: { background: "rgba(255, 255, 255, 1)" } }),
          // unknown color appears twice → should NOT get token
          makeFrame({ style: { background: "rgba(99, 99, 99, 1)" } }),
          makeFrame({ style: { background: "rgba(99, 99, 99, 1)" } }),
        ],
      }),
    );
    const result = extractTokens(response);
    expect(result.tokens?.colors?.white).toBeDefined();
    // Should have exactly 1 color token — no fallback for unknown
    expect(Object.keys(result.tokens?.colors ?? {}).length).toBe(1);
    // Unknown stays raw
    expect(result.root.children![2].style?.background).toBe("rgba(99, 99, 99, 1)");
  });
});

// ── size shorthand collapse (width + height) ──────────────────────────────────

describe("extractTokens — size shorthand collapse (width + height)", () => {
  it("leaves width:100% + height:fit-content as separate fields (no collapse)", () => {
    const response = makeResponse(
      makeFrame({
        children: [makeFrame({ layout: { width: "100%", height: "fit-content" } })],
      }),
    );
    const result = extractTokens(response);
    const layout = result.root.children![0].layout!;
    expect(layout.size).toBeUndefined();
    expect(layout.width).toBe("100%");
    expect(layout.height).toBe("fit-content");
  });

  it("leaves solo width (no height) unchanged", () => {
    const response = makeResponse(
      makeFrame({
        children: [makeFrame({ layout: { width: "100%" } })],
      }),
    );
    const result = extractTokens(response);
    const layout = result.root.children![0].layout!;
    expect(layout.size).toBeUndefined();
    expect(layout.width).toBe("100%");
    expect(layout.height).toBeUndefined();
  });

  it("leaves solo height (no width) unchanged", () => {
    const response = makeResponse(
      makeFrame({
        children: [makeFrame({ layout: { height: "fit-content" } })],
      }),
    );
    const result = extractTokens(response);
    const layout = result.root.children![0].layout!;
    expect(layout.size).toBeUndefined();
    expect(layout.width).toBeUndefined();
    expect(layout.height).toBe("fit-content");
  });
});

// ── Array padding tokenization ─────────────────────────────────────────────────

describe("extractTokens — paddingCombos tokens", () => {
  const BUTTON_COMBOS: [number, number, string][] = [
    [8, 16, "buttonMd"],
    [5.5, 12, "buttonSm"],
    [10, 24, "buttonLg"],
    [3, 8, "buttonXs"],
  ];

  for (const [v, h, tokenName] of BUTTON_COMBOS) {
    it(`tokenizes [${v}, ${h}] as paddingCombos.${tokenName}`, () => {
      const children = Array.from({ length: 3 }, () => makeFrame({ layout: { padding: [v, h] } }));
      const response = makeResponse(makeFrame({ children }));
      const result = extractTokens(response);
      expect(result.root.children![0].layout?.padding).toBe(`paddingCombos.${tokenName}`);
      expect(result.tokens?.paddingCombos?.[tokenName]).toEqual([v, h]);
    });
  }

  it("does NOT tokenize an unknown [v, h] combo", () => {
    const children = Array.from({ length: 5 }, () =>
      makeFrame({ layout: { padding: [7, 14] as [number, number] } }),
    );
    const response = makeResponse(makeFrame({ children }));
    const result = extractTokens(response);
    // Stays as raw array
    expect(result.root.children![0].layout?.padding).toEqual([7, 14]);
    expect(result.tokens?.paddingCombos).toBeUndefined();
  });

  it("does NOT tokenize a combo that appears only once", () => {
    const response = makeResponse(
      makeFrame({
        children: [makeFrame({ layout: { padding: [8, 16] as [number, number] } })],
      }),
    );
    const result = extractTokens(response);
    expect(result.root.children![0].layout?.padding).toEqual([8, 16]);
    expect(result.tokens?.paddingCombos).toBeUndefined();
  });
});

// ── minHeight tokenization (now as CSS strings) ──────────────────────────────

describe("extractTokens — heights tokens (minHeight as CSS strings)", () => {
  const HEIGHT_CASES: [string, string][] = [
    ["36px", "md"],
    ["32px", "sm"],
    ["40px", "lg"],
    ["24px", "xs"],
  ];

  for (const [cssValue, tokenName] of HEIGHT_CASES) {
    it(`tokenizes minHeight:${cssValue} as heights.${tokenName}`, () => {
      const children = Array.from({ length: 3 }, () =>
        makeFrame({ layout: { minHeight: cssValue } }),
      );
      const response = makeResponse(makeFrame({ children }));
      const result = extractTokens(response);
      expect(result.root.children![0].layout?.minHeight).toBe(`heights.${tokenName}`);
      expect(result.tokens?.heights?.[tokenName]).toBe(parseInt(cssValue));
    });
  }

  it("does NOT tokenize an unknown minHeight value (e.g. 50px)", () => {
    const children = Array.from({ length: 5 }, () => makeFrame({ layout: { minHeight: "50px" } }));
    const response = makeResponse(makeFrame({ children }));
    const result = extractTokens(response);
    expect(result.root.children![0].layout?.minHeight).toBe("50px");
    expect(result.tokens?.heights).toBeUndefined();
  });

  it("does NOT tokenize a minHeight that appears only once", () => {
    const response = makeResponse(
      makeFrame({ children: [makeFrame({ layout: { minHeight: "36px" } })] }),
    );
    const result = extractTokens(response);
    expect(result.root.children![0].layout?.minHeight).toBe("36px");
    expect(result.tokens?.heights).toBeUndefined();
  });

  it("leaves non-px minHeight values unchanged (e.g. fit-content)", () => {
    const children = Array.from({ length: 5 }, () =>
      makeFrame({ layout: { minHeight: "fit-content" } }),
    );
    const response = makeResponse(makeFrame({ children }));
    const result = extractTokens(response);
    // fit-content doesn't end with px, so no tokenization attempt
    expect(result.root.children![0].layout?.minHeight).toBe("fit-content");
    expect(result.tokens?.heights).toBeUndefined();
  });
});

// ── componentSets token replacement ──────────────────────────────────────────

describe("extractTokens — componentSets get token replacement", () => {
  it("replaces color tokens in componentSet base styles", () => {
    const response: MCPResponse = {
      schema: "v3",
      root: makeFrame({
        children: [
          makeFrame({ style: { background: "rgba(255, 255, 255, 1)" } }),
          makeFrame({ style: { background: "rgba(255, 255, 255, 1)" } }),
        ],
      }),
      componentSets: {
        Button: {
          name: "Button",
          propKeys: ["variant"],
          base: {
            style: { background: "rgba(255, 255, 255, 1)" },
          },
          variants: {
            "1:1": {
              props: { variant: "primary" },
              style: { background: "rgba(151, 71, 255, 1)" },
            },
            "1:2": {
              props: { variant: "secondary" },
              style: { background: "rgba(151, 71, 255, 1)" },
            },
          },
        },
      },
    };
    const result = extractTokens(response);
    expect(result.componentSets?.Button.base?.style?.background).toBe("colors.white");
    expect(result.componentSets?.Button.variants["1:1"].style?.background).toBe("colors.primary");
  });

  it("keeps width and height separate in componentSet variant layouts", () => {
    const response: MCPResponse = {
      schema: "v3",
      root: makeFrame(),
      componentSets: {
        Button: {
          name: "Button",
          propKeys: ["size"],
          variants: {
            "1:1": {
              layout: { width: "fit-content", height: "fit-content" },
            },
          },
        },
      },
    };
    const result = extractTokens(response);
    const variantLayout = result.componentSets?.Button.variants["1:1"].layout;
    expect(variantLayout?.width).toBe("fit-content");
    expect(variantLayout?.height).toBe("fit-content");
  });
});

// ── No tokens when no values repeat ──────────────────────────────────────────

describe("extractTokens — no tokens when nothing repeats", () => {
  it("returns undefined tokens when all values appear only once", () => {
    const response = makeResponse(
      makeFrame({
        children: [
          makeFrame({ style: { background: "rgba(255, 255, 255, 1)", radius: 8 } }),
          makeFrame({ style: { background: "rgba(151, 71, 255, 1)", radius: 4 } }),
        ],
      }),
    );
    const result = extractTokens(response);
    // Each value appears only once, so no tokens
    expect(result.tokens).toBeUndefined();
  });
});
