import { describe, it, expect } from "vitest";
import { buildNormalizedGraph } from "../figma/reducer.js";

describe("New CSS properties v2", () => {
  it("handles rotation (transform: rotate)", () => {
    const mockNode = {
      id: "1:1",
      type: "FRAME",
      name: "RotatedFrame",
      rotation: Math.PI / 2, // 90 degrees
      children: [],
    };

    const result = buildNormalizedGraph(mockNode, {});
    const node = result.nodes["1:1"];

    expect(node.transform).toBeDefined();
    expect(node.transform).toBe("rotate(90deg)");
  });

  it("handles fixed width/height", () => {
    const mockNode = {
      id: "1:2",
      type: "RECTANGLE",
      name: "FixedRect",
      size: { x: 200.5, y: 100.75 },
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
      children: [],
    };

    const result = buildNormalizedGraph(mockNode, {});
    const node = result.nodes["1:2"];

    expect(node.width).toBe(200.5);
    expect(node.height).toBe(100.75);
  });

  it("omits width/height for auto-layout (FILL/HUG)", () => {
    const mockNode = {
      id: "1:3",
      type: "FRAME",
      name: "AutoLayoutFrame",
      size: { x: 200, y: 100 },
      layoutSizingHorizontal: "FILL",
      layoutSizingVertical: "HUG",
      children: [],
    };

    const result = buildNormalizedGraph(mockNode, {});
    const node = result.nodes["1:3"];

    expect(node.width).toBeUndefined();
    expect(node.height).toBeUndefined();
  });

  it("handles min/max width constraints", () => {
    const mockNode = {
      id: "1:4",
      type: "FRAME",
      name: "ConstrainedFrame",
      minWidth: 100.5,
      maxWidth: 500.25,
      children: [],
    };

    const result = buildNormalizedGraph(mockNode, {});
    const node = result.nodes["1:4"];

    expect(node.minWidth).toBe(100.5);
    expect(node.maxWidth).toBe(500.25);
  });

  it("handles individual corner radii", () => {
    const mockNode = {
      id: "1:5",
      type: "RECTANGLE",
      name: "RoundedRect",
      rectangleCornerRadii: [10, 20, 30, 40],
      children: [],
    };

    const result = buildNormalizedGraph(mockNode, {});
    const node = result.nodes["1:5"];

    expect(node.borderRadius).toEqual([10, 20, 30, 40]);
  });

  it("simplifies corner radii when all same", () => {
    const mockNode = {
      id: "1:6",
      type: "RECTANGLE",
      name: "UniformRounded",
      rectangleCornerRadii: [16, 16, 16, 16],
      children: [],
    };

    const result = buildNormalizedGraph(mockNode, {});
    const node = result.nodes["1:6"];

    expect(node.borderRadius).toBe(16);
  });

  it("handles clipsContent as overflow: hidden", () => {
    const mockNode = {
      id: "1:7",
      type: "FRAME",
      name: "ClippedFrame",
      clipsContent: true,
      children: [],
    };

    const result = buildNormalizedGraph(mockNode, {});
    const node = result.nodes["1:7"];

    expect(node.overflow).toBe("hidden");
  });

  it("handles flexWrap for wrapped layouts", () => {
    const mockNode = {
      id: "1:8",
      type: "FRAME",
      name: "WrappedFrame",
      layoutMode: "HORIZONTAL",
      layoutWrap: "WRAP",
      children: [],
    };

    const result = buildNormalizedGraph(mockNode, {});
    const node = result.nodes["1:8"];

    expect(node.flexWrap).toBe("wrap");
  });

  it("handles blur effects as filter", () => {
    const mockNode = {
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

    const result = buildNormalizedGraph(mockNode, {});
    const node = result.nodes["1:9"];

    expect(node.filter).toBe("blur(10px)");
  });

  it("handles text styling: fontStyle, textDecoration, textTransform", () => {
    const mockNode = {
      id: "1:10",
      type: "TEXT",
      name: "StyledText",
      characters: "Hello World",
      fontName: { family: "Arial", style: "Italic" },
      style: {
        fontFamily: "Arial",
        fontStyle: "Italic",
        textDecoration: "UNDERLINE",
        textCase: "UPPER",
      },
      children: [],
    };

    const result = buildNormalizedGraph(mockNode, {});
    const node = result.nodes["1:10"];

    expect(node.fontStyle).toBe("italic");
    expect(node.textDecoration).toBe("underline");
    expect(node.textTransform).toBe("uppercase");
    expect(node.text).toBe("Hello World");
  });

  it("combines multiple new properties correctly", () => {
    const mockNode = {
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

    const result = buildNormalizedGraph(mockNode, {});
    const node = result.nodes["1:11"];

    // Verify all new properties
    expect(node.transform).toBe("rotate(45deg)");
    expect(node.width).toBe(300);
    expect(node.height).toBe(200);
    expect(node.minWidth).toBe(200);
    expect(node.maxWidth).toBe(400);
    expect(node.overflow).toBe("hidden");
    expect(node.borderRadius).toBe(8);
    expect(node.flexWrap).toBe("wrap");
    expect(node.gap).toBe(16);
  });

  it("omits zero rotation", () => {
    const mockNode = {
      id: "1:12",
      type: "FRAME",
      name: "NoRotation",
      rotation: 0,
      children: [],
    };

    const result = buildNormalizedGraph(mockNode, {});
    const node = result.nodes["1:12"];

    expect(node.transform).toBeUndefined();
  });

  it("handles negative rotation", () => {
    const mockNode = {
      id: "1:13",
      type: "FRAME",
      name: "NegativeRotation",
      rotation: -Math.PI / 4, // -45 degrees
      children: [],
    };

    const result = buildNormalizedGraph(mockNode, {});
    const node = result.nodes["1:13"];

    expect(node.transform).toBe("rotate(-45deg)");
  });
});
