import { describe, it, expect } from "vitest";
import { buildNormalizedGraph } from "../figma/reducer.js";

describe("CSS properties (v3)", () => {
  it("handles rotation (style.transform: rotate)", () => {
    const raw = {
      id: "1:1",
      type: "FRAME",
      name: "RotatedFrame",
      rotation: Math.PI / 2, // 90 degrees
      children: [],
    };

    const result = buildNormalizedGraph(raw, {});
    expect(result.root.style?.transform).toBe("rotate(90deg)");
  });

  it("handles fixed width/height in layout sub-object", () => {
    const raw = {
      id: "1:2",
      type: "RECTANGLE",
      name: "FixedRect",
      size: { x: 200.5, y: 100.75 },
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
      children: [],
    };

    const result = buildNormalizedGraph(raw, {});
    expect(result.root.layout?.width).toBe(200.5);
    expect(result.root.layout?.height).toBe(100.75);
  });

  it("omits width/height for auto-layout (FILL/HUG)", () => {
    const raw = {
      id: "1:3",
      type: "FRAME",
      name: "AutoLayoutFrame",
      size: { x: 200, y: 100 },
      layoutSizingHorizontal: "FILL",
      layoutSizingVertical: "HUG",
      children: [],
    };

    const result = buildNormalizedGraph(raw, {});
    expect(result.root.layout?.width).toBeUndefined();
    expect(result.root.layout?.height).toBeUndefined();
  });

  it("handles min/max width constraints in layout sub-object", () => {
    const raw = {
      id: "1:4",
      type: "FRAME",
      name: "ConstrainedFrame",
      minWidth: 100.5,
      maxWidth: 500.25,
      children: [],
    };

    const result = buildNormalizedGraph(raw, {});
    expect(result.root.layout?.minWidth).toBe(100.5);
    expect(result.root.layout?.maxWidth).toBe(500.25);
  });

  it("handles individual corner radii in style sub-object", () => {
    const raw = {
      id: "1:5",
      type: "RECTANGLE",
      name: "RoundedRect",
      rectangleCornerRadii: [10, 20, 30, 40],
      children: [],
    };

    const result = buildNormalizedGraph(raw, {});
    expect(result.root.style?.radius).toEqual([10, 20, 30, 40]);
  });

  it("simplifies corner radii when all same", () => {
    const raw = {
      id: "1:6",
      type: "RECTANGLE",
      name: "UniformRounded",
      rectangleCornerRadii: [16, 16, 16, 16],
      children: [],
    };

    const result = buildNormalizedGraph(raw, {});
    expect(result.root.style?.radius).toBe(16);
  });

  it("handles clipsContent as layout.overflow: hidden", () => {
    const raw = {
      id: "1:7",
      type: "FRAME",
      name: "ClippedFrame",
      clipsContent: true,
      children: [],
    };

    const result = buildNormalizedGraph(raw, {});
    expect(result.root.layout?.overflow).toBe("hidden");
  });

  it("handles flexWrap for wrapped layouts in layout sub-object", () => {
    const raw = {
      id: "1:8",
      type: "FRAME",
      name: "WrappedFrame",
      layoutMode: "HORIZONTAL",
      layoutWrap: "WRAP",
      children: [],
    };

    const result = buildNormalizedGraph(raw, {});
    expect(result.root.layout?.wrap).toBe(true);
  });

  it("handles blur effects as style.blur", () => {
    const raw = {
      id: "1:9",
      type: "RECTANGLE",
      name: "BlurredRect",
      effects: [
        {
          type: "LAYER_BLUR",
          radius: 10,
          visible: true,
        },
      ],
      children: [],
    };

    const result = buildNormalizedGraph(raw, {});
    expect(result.root.style?.blur).toBe("blur(10px)");
  });

  it("handles text styling: fontStyle, textDecoration, textTransform", () => {
    const raw = {
      id: "1:10",
      type: "TEXT",
      name: "StyledText",
      characters: "Hello World",
      fontName: { family: "Arial", style: "Italic" },
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
      style: {
        fontFamily: "Arial",
        fontStyle: "Italic",
        textDecoration: "UNDERLINE",
        textCase: "UPPER",
      },
      children: [],
    };

    const result = buildNormalizedGraph(raw, {});
    expect(result.root.style?.fontStyle).toBe("italic");
    expect(result.root.style?.textDecoration).toBe("underline");
    expect(result.root.style?.textTransform).toBe("uppercase");
    expect(result.root.text).toBe("Hello World");
  });

  it("combines multiple new properties correctly", () => {
    const raw = {
      id: "1:11",
      type: "FRAME",
      name: "ComplexFrame",
      rotation: Math.PI / 4, // 45 degrees
      size: { x: 300, y: 200 },
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
      minWidth: 200,
      maxWidth: 400,
      clipsContent: true,
      rectangleCornerRadii: [8, 8, 8, 8],
      layoutMode: "HORIZONTAL",
      layoutWrap: "WRAP",
      itemSpacing: 16,
      children: [],
    };

    const result = buildNormalizedGraph(raw, {});
    expect(result.root.style?.transform).toBe("rotate(45deg)");
    expect(result.root.layout?.width).toBe(300);
    expect(result.root.layout?.height).toBe(200);
    expect(result.root.layout?.minWidth).toBe(200);
    expect(result.root.layout?.maxWidth).toBe(400);
    expect(result.root.layout?.overflow).toBe("hidden");
    expect(result.root.style?.radius).toBe(8);
    expect(result.root.layout?.wrap).toBe(true);
    expect(result.root.layout?.gap).toBe(16);
  });

  it("omits zero rotation", () => {
    const raw = {
      id: "1:12",
      type: "FRAME",
      name: "NoRotation",
      rotation: 0,
      children: [],
    };

    const result = buildNormalizedGraph(raw, {});
    expect(result.root.style?.transform).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain("rotate(0deg)");
  });

  it("handles negative rotation", () => {
    const raw = {
      id: "1:13",
      type: "FRAME",
      name: "NegativeRotation",
      rotation: -Math.PI / 4, // -45 degrees
      children: [],
    };

    const result = buildNormalizedGraph(raw, {});
    expect(result.root.style?.transform).toBe("rotate(-45deg)");
  });
});
