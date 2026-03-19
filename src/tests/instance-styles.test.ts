import { describe, it, expect } from "vitest";
import { buildNormalizedGraph } from "~/figma/reducer.js";

describe("Instance and component style rendering (v3)", () => {
  it("COMPONENT node styles appear in style sub-object", () => {
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

    function findNode(node: any, type: string): any | undefined {
      if (node.type === type) return node;
      for (const child of node.children ?? []) {
        const found = findNode(child, type);
        if (found) return found;
      }
      return undefined;
    }

    const componentNode = findNode(normalized.root, "COMPONENT");
    expect(componentNode).toBeDefined();
    expect(componentNode.style?.background).toBe("rgba(255, 0, 0, 1)");
    expect(componentNode.style?.border).toBe("rgba(0, 0, 0, 1)");
    expect(componentNode.style?.borderWidth).toBe(2);
    expect(componentNode.style?.radius).toBe(8);
    // Must NOT have old flat top-level properties
    expect(componentNode).not.toHaveProperty("backgroundColor");
    expect(componentNode).not.toHaveProperty("borderRadius");
  });

  it("INSTANCE node styles appear in style sub-object", () => {
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

    function findNode(node: any, type: string): any | undefined {
      if (node.type === type) return node;
      for (const child of node.children ?? []) {
        const found = findNode(child, type);
        if (found) return found;
      }
      return undefined;
    }

    const instanceNode = findNode(normalized.root, "INSTANCE");
    expect(instanceNode).toBeDefined();
    expect(instanceNode.style?.background).toBe("rgba(0, 255, 0, 1)");
    expect(instanceNode.style?.radius).toBe(4);
    // v3: component field (not componentId)
    expect(instanceNode.component).toBe("1:1");
    expect(instanceNode).not.toHaveProperty("componentId");
    expect(instanceNode).not.toHaveProperty("backgroundColor");
  });

  it("TEXT node has text content and style.color (not style.background)", () => {
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

    function findNode(node: any, type: string): any | undefined {
      if (node.type === type) return node;
      for (const child of node.children ?? []) {
        const found = findNode(child, type);
        if (found) return found;
      }
      return undefined;
    }

    const textNode = findNode(normalized.root, "TEXT");
    expect(textNode).toBeDefined();
    expect(textNode.text).toBe("Hello World");
    expect(textNode.style?.color).toBe("rgba(0, 0, 0, 1)");
    expect(textNode.style?.background).toBeUndefined();
    expect(textNode.style?.font).toBe("Inter");
    expect(textNode.style?.fontSize).toBe(24);
    expect(textNode.style?.fontWeight).toBe(700);
    expect(textNode.style?.lineHeight).toBe(32);
    expect(textNode.style?.letterSpacing).toBe(-0.5);
    expect(textNode.style?.textAlign).toBe("center");
    // Must NOT have old flat top-level text properties
    expect(textNode).not.toHaveProperty("fontFamily");
    expect(textNode).not.toHaveProperty("color");
  });
});
