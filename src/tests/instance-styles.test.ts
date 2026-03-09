import { describe, it, expect } from "vitest";
import { buildNormalizedGraph } from "~/figma/reducer.js";

describe("Instance style inheritance (v2 - inline styles)", () => {
  it("includes styles inline in component nodes", () => {
    const mockData = {
      id: "0:1",
      type: "CANVAS",
      name: "Page",
      children: [
        {
          id: "1:1",
          type: "COMPONENT",
          name: "Button",
          fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
          strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
          strokeWeight: 2,
          cornerRadius: 8,
          children: [],
        },
      ],
    };

    const normalized = buildNormalizedGraph(mockData, {});

    const componentNode = Object.values(normalized.nodes).find((n) => n.type === "COMPONENT");

    expect(componentNode).toBeDefined();
    expect(componentNode!.backgroundColor).toBe("rgba(255, 0, 0, 1)"); // Red
    expect(componentNode!.border).toBe("rgba(0, 0, 0, 1)"); // Black
    expect(componentNode!.borderWidth).toBe(2);
    expect(componentNode!.borderRadius).toBe(8);
  });

  it("includes styles inline in instance nodes", () => {
    const mockData = {
      id: "0:1",
      type: "CANVAS",
      name: "Page",
      children: [
        {
          id: "2:1",
          type: "INSTANCE",
          name: "Button Instance",
          componentId: "1:1",
          fills: [{ type: "SOLID", color: { r: 0, g: 1, b: 0, a: 1 } }],
          cornerRadius: 4,
          children: [],
        },
      ],
    };

    const normalized = buildNormalizedGraph(mockData, {});

    const instanceNode = Object.values(normalized.nodes).find((n) => n.type === "INSTANCE");

    expect(instanceNode).toBeDefined();
    expect(instanceNode!.backgroundColor).toBe("rgba(0, 255, 0, 1)"); // Green (override)
    expect(instanceNode!.borderRadius).toBe(4);
    expect(instanceNode!.componentId).toBe("1:1");
  });

  it("handles text styles inline", () => {
    const mockData = {
      id: "0:1",
      type: "CANVAS",
      name: "Page",
      children: [
        {
          id: "1:1",
          type: "TEXT",
          name: "Heading",
          characters: "Hello World",
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
          fontName: { family: "Inter", style: "Bold" },
          fontSize: 24,
          fontWeight: 700,
          style: {
            fontFamily: "Inter",
            fontSize: 24,
            fontWeight: 700,
            lineHeightPx: 32,
            letterSpacing: -0.5,
            textAlignHorizontal: "CENTER",
          },
          children: [],
        },
      ],
    };

    const normalized = buildNormalizedGraph(mockData, {});

    const textNode = Object.values(normalized.nodes).find((n) => n.type === "TEXT");

    expect(textNode).toBeDefined();
    expect(textNode!.text).toBe("Hello World");
    expect(textNode!.color).toBe("rgba(0, 0, 0, 1)");
    expect(textNode!.fontFamily).toBe("Inter");
    expect(textNode!.fontSize).toBe(24);
    expect(textNode!.fontWeight).toBe(700);
    expect(textNode!.lineHeight).toBe(32);
    expect(textNode!.letterSpacing).toBe(-0.5);
    expect(textNode!.textAlign).toBe("center");
  });
});
