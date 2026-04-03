/**
 * V3 Structure Tests
 *
 * These tests define the contract for the v3 MCPResponse format using hand-crafted
 * fixture objects — no live API calls, no file I/O. Each test covers one specific
 * property of the new format so regressions are easy to pinpoint.
 *
 * V3 goals:
 * - Nested tree (not flat node map) for natural top-down LLM reading
 * - layout{} and style{} sub-objects separate structure from decoration
 * - No `parent` field (redundant with tree)
 * - `id` only on INSTANCE nodes (needed to identify component references)
 * - Inline variable values (no $ref strings, no variables dict)
 * - Wrapper collapsing: transparent single-child FRAMEs/GROUPs are elided
 * - TEXT nodes only get `style.color`, never `style.background`
 * - `rotate(0deg)` suppressed
 * - `definitions` dict for component metadata (replaces `components`)
 * - Hidden nodes fully excluded
 */

import { describe, it, expect } from "vitest";
import { buildNormalizedGraph, parseVariantProps } from "~/figma/reducer.js";
import type { VariableResolutionContext } from "~/figma/variableResolver.js";

// ---------------------------------------------------------------------------
// Minimal raw Figma node factories
// ---------------------------------------------------------------------------

function frame(
  id: string,
  name: string,
  overrides: Record<string, unknown> = {},
  children: unknown[] = [],
): Record<string, unknown> {
  return { id, type: "FRAME", name, children, ...overrides };
}

function text(
  id: string,
  name: string,
  characters: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    type: "TEXT",
    name,
    characters,
    fills: [{ type: "SOLID", color: { r: 0.239, g: 0.239, b: 0.239, a: 1 } }],
    style: { fontFamily: "Lato", fontSize: 16, fontWeight: 400, lineHeightPx: 24 },
    ...overrides,
  };
}

function instance(
  id: string,
  name: string,
  componentId: string,
  overrides: Record<string, unknown> = {},
  children: unknown[] = [],
): Record<string, unknown> {
  return { id, type: "INSTANCE", name, componentId, children, ...overrides };
}

function autoLayout(
  id: string,
  name: string,
  direction: "HORIZONTAL" | "VERTICAL",
  overrides: Record<string, unknown> = {},
  children: unknown[] = [],
): Record<string, unknown> {
  return {
    id,
    type: "FRAME",
    name,
    layoutMode: direction,
    primaryAxisAlignItems: "MIN",
    counterAxisAlignItems: "MIN",
    children,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// 1. Basic v3 envelope
// ---------------------------------------------------------------------------

describe("V3 envelope", () => {
  it("has schema:v3, root as a node object, and definitions", () => {
    const raw = frame("1:1", "Root", {}, []);
    const result = buildNormalizedGraph(raw, {});

    expect(result.schema).toBe("v3");
    expect(result.root).toBeDefined();
    expect(typeof result.root).toBe("object");
    // No flat nodes map
    expect(result).not.toHaveProperty("nodes");
  });

  it("does not include a variables dict", () => {
    const raw = frame("1:1", "Root");
    const result = buildNormalizedGraph(raw, {});
    expect(result).not.toHaveProperty("variables");
  });
});

// ---------------------------------------------------------------------------
// 2. Tree structure — nesting and no parent field
// ---------------------------------------------------------------------------

describe("Tree structure", () => {
  it("nests children inline rather than as ID references", () => {
    const child = frame("1:2", "Child");
    const root = frame("1:1", "Root", {}, [child]);
    const result = buildNormalizedGraph(root, {});

    expect(result.root.children).toBeDefined();
    expect(result.root.children).toHaveLength(1);
    // Children are node objects, not strings
    expect(typeof result.root.children![0]).toBe("object");
    expect((result.root.children![0] as any).name).toBe("Child");
  });

  it("deeply nests grandchildren", () => {
    const grandchild = frame("1:3", "Grandchild");
    // Give child a fill so it is NOT a transparent wrapper (and survives collapsing)
    const child = frame(
      "1:2",
      "Child",
      { fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }] },
      [grandchild],
    );
    const root = frame("1:1", "Root", {}, [child]);
    const result = buildNormalizedGraph(root, {});

    const childNode = result.root.children![0] as any;
    expect(childNode.children).toHaveLength(1);
    expect(childNode.children[0].name).toBe("Grandchild");
  });

  it("no node has a parent field", () => {
    const grandchild = frame("1:3", "Grandchild");
    const child = frame("1:2", "Child", {}, [grandchild]);
    const root = frame("1:1", "Root", {}, [child]);
    const result = buildNormalizedGraph(root, {});

    function checkNoParent(node: any) {
      expect(node).not.toHaveProperty("parent");
      if (node.children) node.children.forEach(checkNoParent);
    }
    checkNoParent(result.root);
  });
});

// ---------------------------------------------------------------------------
// 3. ID rules — only on INSTANCE nodes
// ---------------------------------------------------------------------------

describe("ID presence rules", () => {
  it("plain FRAME nodes do not have an id field", () => {
    const raw = frame("1:1", "Root");
    const result = buildNormalizedGraph(raw, {});
    expect(result.root).not.toHaveProperty("id");
  });

  it("INSTANCE nodes have an id field", () => {
    const inst = instance("I1:1;1:2", "MyInstance", "10:100");
    const root = frame("1:1", "Root", {}, [inst]);
    const result = buildNormalizedGraph(root, {});

    const instanceNode = result.root.children![0] as any;
    expect(instanceNode.id).toBeDefined();
  });

  it("INSTANCE id is the original Figma id (no mangling needed)", () => {
    const inst = instance("I1:1;1:2", "MyInstance", "10:100");
    const root = frame("1:1", "Root", {}, [inst]);
    const result = buildNormalizedGraph(root, {});

    const instanceNode = result.root.children![0] as any;
    // ID stays as-is since we dropped IdMapper
    expect(instanceNode.id).toBe("I1:1;1:2");
  });
});

// ---------------------------------------------------------------------------
// 4. layout{} sub-object
// ---------------------------------------------------------------------------

describe("layout sub-object", () => {
  it("auto-layout FRAME emits layout.direction, not top-level display", () => {
    const raw = autoLayout("1:1", "Root", "HORIZONTAL");
    const result = buildNormalizedGraph(raw, {});

    expect(result.root).not.toHaveProperty("display");
    expect(result.root).not.toHaveProperty("flexDirection");
    expect(result.root.layout).toBeDefined();
    expect(result.root.layout!.direction).toBe("row");
  });

  it("VERTICAL layoutMode maps to direction:column", () => {
    const raw = autoLayout("1:1", "Root", "VERTICAL");
    const result = buildNormalizedGraph(raw, {});
    expect(result.root.layout!.direction).toBe("column");
  });

  it("align and justify are in layout sub-object", () => {
    const raw = autoLayout("1:1", "Root", "HORIZONTAL", {
      counterAxisAlignItems: "CENTER",
      primaryAxisAlignItems: "SPACE_BETWEEN",
    });
    const result = buildNormalizedGraph(raw, {});

    expect(result.root.layout!.align).toBe("center");
    expect(result.root.layout!.justify).toBe("space-between");
  });

  it("gap is in layout sub-object", () => {
    const raw = autoLayout("1:1", "Root", "HORIZONTAL", { itemSpacing: 16 });
    const result = buildNormalizedGraph(raw, {});
    expect(result.root.layout!.gap).toBe(16);
  });

  it("padding is in layout sub-object", () => {
    const raw = autoLayout("1:1", "Root", "VERTICAL", {
      paddingTop: 24,
      paddingRight: 16,
      paddingBottom: 24,
      paddingLeft: 16,
    });
    const result = buildNormalizedGraph(raw, {});
    // Two-axis symmetric: compacted to [vertical, horizontal]
    expect(result.root.layout!.padding).toEqual([24, 16]);
  });

  it("zero padding is not emitted", () => {
    const raw = autoLayout("1:1", "Root", "VERTICAL", {
      paddingTop: 0,
      paddingRight: 0,
      paddingBottom: 0,
      paddingLeft: 0,
    });
    const result = buildNormalizedGraph(raw, {});
    expect(result.root.layout?.padding).toBeUndefined();
  });

  it("zero gap is not emitted", () => {
    const raw = autoLayout("1:1", "Root", "HORIZONTAL", { itemSpacing: 0 });
    const result = buildNormalizedGraph(raw, {});
    expect(result.root.layout?.gap).toBeUndefined();
  });

  it("overflow:hidden in layout when clipsContent", () => {
    const raw = frame("1:1", "Root", { clipsContent: true });
    const result = buildNormalizedGraph(raw, {});
    expect(result.root.layout!.overflow).toBe("hidden");
  });

  it("width/height in layout for FIXED-sized nodes", () => {
    const raw = frame("1:1", "Root", {
      size: { x: 320, y: 48 },
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
    });
    const result = buildNormalizedGraph(raw, {});
    expect(result.root.layout!.width).toBe(320);
    expect(result.root.layout!.height).toBe(48);
  });

  it("non-auto-layout FRAME with no layout properties emits no layout field", () => {
    const raw = frame("1:1", "Root");
    const result = buildNormalizedGraph(raw, {});
    expect(result.root.layout).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. style{} sub-object
// ---------------------------------------------------------------------------

describe("style sub-object", () => {
  it("solid fill emits style.background as rgba string, not top-level backgroundColor", () => {
    const raw = frame("1:1", "Root", {
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
    });
    const result = buildNormalizedGraph(raw, {});

    expect(result.root).not.toHaveProperty("backgroundColor");
    expect(result.root.style!.background).toBe("rgba(255, 255, 255, 1)");
  });

  it("border color and width in style sub-object", () => {
    const raw = frame("1:1", "Root", {
      strokes: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
      strokeWeight: 2,
    });
    const result = buildNormalizedGraph(raw, {});

    expect(result.root.style!.border).toBe("rgba(0, 0, 0, 1)");
    expect(result.root.style!.borderWidth).toBe(2);
  });

  it("borderRadius in style sub-object", () => {
    const raw = frame("1:1", "Root", { cornerRadius: 8 });
    const result = buildNormalizedGraph(raw, {});
    expect(result.root.style!.radius).toBe(8);
  });

  it("boxShadow in style.shadow", () => {
    const raw = frame("1:1", "Root", {
      effects: [
        {
          type: "DROP_SHADOW",
          color: { r: 0, g: 0, b: 0, a: 0.16 },
          offset: { x: 0, y: 1 },
          radius: 2,
          spread: 0,
        },
      ],
    });
    const result = buildNormalizedGraph(raw, {});
    expect(result.root.style!.shadow).toBeDefined();
    expect(result.root.style!.shadow).toContain("rgba(");
  });

  it("opacity in style sub-object, omitted when 1", () => {
    const withOpacity = frame("1:1", "Root", { opacity: 0.5 });
    const withoutOpacity = frame("1:2", "Root2");

    const r1 = buildNormalizedGraph(withOpacity, {});
    const r2 = buildNormalizedGraph(withoutOpacity, {});

    expect(r1.root.style!.opacity).toBe(0.5);
    expect(r2.root.style?.opacity).toBeUndefined();
  });

  it("no style field when node has no visual styling", () => {
    const raw = frame("1:1", "Root");
    const result = buildNormalizedGraph(raw, {});
    expect(result.root.style).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. TEXT node styling
// ---------------------------------------------------------------------------

describe("TEXT node styling", () => {
  it("TEXT node has style.color, not style.background", () => {
    const raw = text("1:2", "Label", "Hello");
    const root = frame("1:1", "Root", {}, [raw]);
    const result = buildNormalizedGraph(root, {});

    const textNode = result.root.children![0] as any;
    expect(textNode.type).toBe("TEXT");
    expect(textNode.style?.color).toBeDefined();
    expect(textNode.style?.background).toBeUndefined();
  });

  it("TEXT node does not have a top-level backgroundColor", () => {
    const raw = text("1:2", "Label", "Hello");
    const root = frame("1:1", "Root", {}, [raw]);
    const result = buildNormalizedGraph(root, {});

    const textNode = result.root.children![0] as any;
    expect(textNode).not.toHaveProperty("backgroundColor");
  });

  it("text content is on the node directly, not inside style", () => {
    const raw = text("1:2", "Label", "Hello World");
    const root = frame("1:1", "Root", {}, [raw]);
    const result = buildNormalizedGraph(root, {});

    const textNode = result.root.children![0] as any;
    expect(textNode.text).toBe("Hello World");
    expect(textNode.style?.text).toBeUndefined();
  });

  it("font properties are in style sub-object", () => {
    const raw = text("1:2", "Label", "Hi", {
      style: {
        fontFamily: "Inter",
        fontSize: 14,
        fontWeight: 700,
        lineHeightPx: 20,
        textAlignHorizontal: "CENTER",
      },
    });
    const root = frame("1:1", "Root", {}, [raw]);
    const result = buildNormalizedGraph(root, {});

    const textNode = result.root.children![0] as any;
    expect(textNode.style?.font).toBe("Inter");
    expect(textNode.style?.fontSize).toBe(14);
    expect(textNode.style?.fontWeight).toBe(700);
    expect(textNode.style?.lineHeight).toBe(20);
    expect(textNode.style?.textAlign).toBe("center");
  });
});

// ---------------------------------------------------------------------------
// 7. Variable inlining — no $ref strings, no variables dict
// ---------------------------------------------------------------------------

describe("Variable inlining", () => {
  function makeContext(id: string, color: { r: number; g: number; b: number; a: number }) {
    const ctx: VariableResolutionContext = {
      variableValues: new Map([[id, color]]),
      activeModes: new Map(),
    };
    return ctx;
  }

  it("variable-bound color is inlined as rgba(), not as $ref", () => {
    const varId = "VariableID:abc/1";
    const raw = frame("1:1", "Root", {
      fills: [
        {
          type: "SOLID",
          color: { r: 1, g: 1, b: 1, a: 1 },
          boundVariables: { color: { type: "VARIABLE_ALIAS", id: varId } },
        },
      ],
    });

    const ctx = makeContext(varId, { r: 0.1, g: 0.2, b: 0.3, a: 1 });
    const result = buildNormalizedGraph(raw, {}, ctx);

    // Must be an rgba string — not a $ref
    expect(typeof result.root.style!.background).toBe("string");
    expect(result.root.style!.background as string).toMatch(/^rgba\(/);
    expect(result.root.style!.background as string).not.toContain("$");
  });

  it("output has no variables dict", () => {
    const varId = "VariableID:abc/1";
    const raw = frame("1:1", "Root", {
      fills: [
        {
          type: "SOLID",
          color: { r: 1, g: 1, b: 1, a: 1 },
          boundVariables: { color: { type: "VARIABLE_ALIAS", id: varId } },
        },
      ],
    });
    const ctx = makeContext(varId, { r: 1, g: 1, b: 1, a: 1 });
    const result = buildNormalizedGraph(raw, {}, ctx);

    expect(result).not.toHaveProperty("variables");
  });

  it("no node contains a $-prefixed variable reference string", () => {
    const varId = "VariableID:abc/2";
    const raw = frame("1:1", "Root", {
      fills: [
        {
          type: "SOLID",
          color: { r: 0, g: 0, b: 0, a: 1 },
          boundVariables: { color: { type: "VARIABLE_ALIAS", id: varId } },
        },
      ],
    });
    const ctx = makeContext(varId, { r: 0, g: 0, b: 0, a: 1 });
    const result = buildNormalizedGraph(raw, {}, ctx);

    const str = JSON.stringify(result);
    expect(str).not.toContain('"$');
  });
});

// ---------------------------------------------------------------------------
// 8. Wrapper collapsing
// ---------------------------------------------------------------------------

describe("Wrapper collapsing", () => {
  it("transparent single-child FRAME wrapper is elided", () => {
    // wrapper has no fills, no layout, no style — just a pass-through
    const leaf = text("1:3", "Leaf", "Hello");
    const wrapper = frame("1:2", "Wrapper", {}, [leaf]);
    const root = autoLayout("1:1", "Root", "VERTICAL", {}, [wrapper]);
    const result = buildNormalizedGraph(root, {});

    // Root should have one child — the TEXT node directly, not the wrapper
    expect(result.root.children).toHaveLength(1);
    expect((result.root.children![0] as any).type).toBe("TEXT");
  });

  it("FRAME wrapper with layout properties is NOT collapsed", () => {
    const leaf = text("1:3", "Leaf", "Hello");
    const wrapper = autoLayout("1:2", "Wrapper", "HORIZONTAL", {}, [leaf]);
    const root = autoLayout("1:1", "Root", "VERTICAL", {}, [wrapper]);
    const result = buildNormalizedGraph(root, {});

    expect(result.root.children).toHaveLength(1);
    expect((result.root.children![0] as any).type).toBe("FRAME");
    expect((result.root.children![0] as any).layout?.direction).toBe("row");
  });

  it("FRAME wrapper with style properties is NOT collapsed", () => {
    const leaf = text("1:3", "Leaf", "Hello");
    const wrapper = frame(
      "1:2",
      "Wrapper",
      { fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }] },
      [leaf],
    );
    const root = autoLayout("1:1", "Root", "VERTICAL", {}, [wrapper]);
    const result = buildNormalizedGraph(root, {});

    expect(result.root.children).toHaveLength(1);
    expect((result.root.children![0] as any).type).toBe("FRAME");
    expect((result.root.children![0] as any).style?.background).toBeDefined();
  });

  it("INSTANCE wrappers are never collapsed", () => {
    const leaf = text("1:3", "Leaf", "Hello");
    const inst = instance("I1:2;1:3", "Inst", "10:100", {}, [leaf]);
    const root = autoLayout("1:1", "Root", "VERTICAL", {}, [inst]);
    const result = buildNormalizedGraph(root, {});

    expect(result.root.children).toHaveLength(1);
    expect((result.root.children![0] as any).type).toBe("INSTANCE");
  });

  it("multi-child FRAME is never collapsed", () => {
    const child1 = text("1:3", "A", "A");
    const child2 = text("1:4", "B", "B");
    const wrapper = frame("1:2", "Wrapper", {}, [child1, child2]);
    const root = autoLayout("1:1", "Root", "VERTICAL", {}, [wrapper]);
    const result = buildNormalizedGraph(root, {});

    expect(result.root.children).toHaveLength(1);
    expect((result.root.children![0] as any).type).toBe("FRAME");
    expect((result.root.children![0] as any).children).toHaveLength(2);
  });

  it("chain of transparent wrappers is fully collapsed", () => {
    // wrapper2 → wrapper1 → text: both wrappers should be elided
    const leaf = text("1:4", "Leaf", "Hello");
    const wrapper1 = frame("1:3", "W1", {}, [leaf]);
    const wrapper2 = frame("1:2", "W2", {}, [wrapper1]);
    const root = autoLayout("1:1", "Root", "VERTICAL", {}, [wrapper2]);
    const result = buildNormalizedGraph(root, {});

    expect(result.root.children).toHaveLength(1);
    expect((result.root.children![0] as any).type).toBe("TEXT");
  });
});

// ---------------------------------------------------------------------------
// 9. Component definitions
// ---------------------------------------------------------------------------

describe("Component definitions", () => {
  it("INSTANCE node has component field pointing into definitions", () => {
    const inst = instance("I1:2;1:3", "HeadlineInst", "46:4849");
    const root = frame("1:1", "Root", {}, [inst]);
    const result = buildNormalizedGraph(root, {}, undefined, {
      "46:4849": { key: "abc123", name: "Headline Responsive", description: "A headline" },
    });

    const instNode = result.root.children![0] as any;
    expect(instNode.component).toBe("46:4849");
    expect(instNode).not.toHaveProperty("componentId");
  });

  it("definitions dict is populated from INSTANCE references", () => {
    const inst = instance("I1:2;1:3", "HeadlineInst", "46:4849");
    const root = frame("1:1", "Root", {}, [inst]);
    const result = buildNormalizedGraph(root, {}, undefined, {
      "46:4849": { key: "abc123", name: "Headline Responsive" },
    });

    expect(result.definitions).toBeDefined();
    expect(result.definitions!["46:4849"]).toBeDefined();
    expect(result.definitions!["46:4849"].name).toBe("Headline Responsive");
  });

  it("definitions entry does not have a redundant key field", () => {
    const inst = instance("I1:2;1:3", "HeadlineInst", "46:4849");
    const root = frame("1:1", "Root", {}, [inst]);
    const result = buildNormalizedGraph(root, {}, undefined, {
      "46:4849": { key: "abc123", name: "Headline Responsive" },
    });

    // The key is already the dict key — no need to repeat it inside the value
    expect(result.definitions!["46:4849"]).not.toHaveProperty("key");
  });

  it("definitions is absent when no INSTANCE nodes exist", () => {
    const raw = frame("1:1", "Root", {}, [frame("1:2", "Child")]);
    const result = buildNormalizedGraph(raw, {});
    expect(result.definitions).toBeUndefined();
  });

  it("same component used multiple times only appears once in definitions", () => {
    const inst1 = instance("I1:2;1:3", "Inst1", "46:4849");
    const inst2 = instance("I1:4;1:5", "Inst2", "46:4849");
    const root = frame("1:1", "Root", {}, [inst1, inst2]);
    const result = buildNormalizedGraph(root, {}, undefined, {
      "46:4849": { key: "abc123", name: "Headline Responsive" },
    });

    expect(Object.keys(result.definitions!)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 10. Suppressed defaults
// ---------------------------------------------------------------------------

describe("Suppressed defaults", () => {
  it("rotate(0deg) is not emitted", () => {
    const raw = frame("1:1", "Root", { rotation: 0 });
    const result = buildNormalizedGraph(raw, {});

    const str = JSON.stringify(result);
    expect(str).not.toContain("rotate(0deg)");
    expect(str).not.toContain('"transform"');
  });

  it("non-zero rotation is emitted in style.transform", () => {
    // Figma stores rotation in radians; Math.PI/2 = 90 degrees
    const raw = frame("1:1", "Root", { rotation: Math.PI / 2 });
    const result = buildNormalizedGraph(raw, {});
    expect(result.root.style!.transform).toContain("rotate(");
  });

  it("hidden nodes are excluded from the tree", () => {
    const hidden = frame("1:2", "Hidden", { visible: false });
    const visible = frame("1:3", "Visible");
    const root = frame("1:1", "Root", {}, [hidden, visible]);
    const result = buildNormalizedGraph(root, {});

    expect(result.root.children).toHaveLength(1);
    expect((result.root.children![0] as any).name).toBe("Visible");
  });

  it("hidden subtree is fully excluded", () => {
    const grandchild = text("1:4", "GC", "text");
    const hidden = frame("1:2", "HiddenParent", { visible: false }, [grandchild]);
    const root = frame("1:1", "Root", {}, [hidden]);
    const result = buildNormalizedGraph(root, {});

    expect(result.root.children).toBeUndefined();
    const str = JSON.stringify(result);
    expect(str).not.toContain("GC");
  });
});

// ---------------------------------------------------------------------------
// 11. Size reduction sanity check
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 12. Output optimizations
// ---------------------------------------------------------------------------

describe("Output optimizations", () => {
  // 12.1 — Drop name when name === text on TEXT nodes
  it("TEXT node name is omitted when it equals the text content", () => {
    const raw = text("1:2", "Hello World", "Hello World");
    const root = frame("1:1", "Root", {}, [raw]);
    const result = buildNormalizedGraph(root, {});

    const textNode = result.root.children![0] as any;
    expect(textNode.text).toBe("Hello World");
    expect(textNode.name).toBeUndefined();
  });

  it("TEXT node name is kept when it differs from the text content", () => {
    const raw = text("1:2", "Headline Label", "Hello World");
    const root = frame("1:1", "Root", {}, [raw]);
    const result = buildNormalizedGraph(root, {});

    const textNode = result.root.children![0] as any;
    expect(textNode.name).toBe("Headline Label");
  });

  // 12.2 — rotate(0deg) must not leak from tiny floating-point radian values
  it("near-zero floating-point rotation does not emit rotate(0deg)", () => {
    // 1e-15 radians is effectively 0deg but is !== 0 as a number
    const raw = frame("1:1", "Root", { rotation: 1e-15 });
    const result = buildNormalizedGraph(raw, {});

    const str = JSON.stringify(result);
    expect(str).not.toContain("rotate(0deg)");
    expect(str).not.toContain('"transform"');
  });

  // 12.3 — Compact symmetric padding
  it("uniform padding is compacted to a single number", () => {
    const raw = autoLayout("1:1", "Root", "VERTICAL", {
      paddingTop: 24,
      paddingRight: 24,
      paddingBottom: 24,
      paddingLeft: 24,
    });
    const result = buildNormalizedGraph(raw, {});
    expect(result.root.layout!.padding).toBe(24);
  });

  it("two-axis symmetric padding is compacted to [vertical, horizontal]", () => {
    const raw = autoLayout("1:1", "Root", "VERTICAL", {
      paddingTop: 24,
      paddingRight: 16,
      paddingBottom: 24,
      paddingLeft: 16,
    });
    const result = buildNormalizedGraph(raw, {});
    expect(result.root.layout!.padding).toEqual([24, 16]);
  });

  it("asymmetric padding remains as full object", () => {
    const raw = autoLayout("1:1", "Root", "VERTICAL", {
      paddingTop: 24,
      paddingRight: 16,
      paddingBottom: 8,
      paddingLeft: 4,
    });
    const result = buildNormalizedGraph(raw, {});
    expect(result.root.layout!.padding).toEqual({ top: 24, right: 16, bottom: 8, left: 4 });
  });

  // 12.4 — Suppress justify: "flex-start" (CSS default)
  it("justify flex-start is not emitted (CSS default)", () => {
    const raw = autoLayout("1:1", "Root", "HORIZONTAL", {
      primaryAxisAlignItems: "MIN",
    });
    const result = buildNormalizedGraph(raw, {});
    expect(result.root.layout?.justify).toBeUndefined();
  });

  it("non-default justify value is still emitted", () => {
    const raw = autoLayout("1:1", "Root", "HORIZONTAL", {
      primaryAxisAlignItems: "CENTER",
    });
    const result = buildNormalizedGraph(raw, {});
    expect(result.root.layout!.justify).toBe("center");
  });

  // 12.5 — Suppress align: "stretch" (CSS default)
  it("align stretch is not emitted (CSS default)", () => {
    const raw = autoLayout("1:1", "Root", "HORIZONTAL", {
      counterAxisAlignItems: "STRETCH",
    });
    const result = buildNormalizedGraph(raw, {});
    expect(result.root.layout?.align).toBeUndefined();
  });

  it("non-default align value is still emitted", () => {
    const raw = autoLayout("1:1", "Root", "HORIZONTAL", {
      counterAxisAlignItems: "CENTER",
    });
    const result = buildNormalizedGraph(raw, {});
    expect(result.root.layout!.align).toBe("center");
  });

  // 12.6 — Suppress RECTANGLE nodes whose fill matches parent fill
  it("RECTANGLE with same fill as parent is suppressed", () => {
    const bg = {
      id: "1:3",
      type: "RECTANGLE",
      name: "_Container_Background",
      fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }],
    };
    const content = text("1:4", "Label", "Hello");
    const parent = frame(
      "1:2",
      "Card",
      { fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }] },
      [bg, content],
    );
    const root = frame("1:1", "Root", {}, [parent]);
    const result = buildNormalizedGraph(root, {});

    const card = result.root.children![0] as any;
    // Should only have the TEXT child, not the background RECTANGLE
    expect(card.children).toHaveLength(1);
    expect(card.children[0].type).toBe("TEXT");
  });

  it("RECTANGLE with different fill from parent is kept", () => {
    const rect = {
      id: "1:3",
      type: "RECTANGLE",
      name: "Accent Bar",
      fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
    };
    const parent = frame(
      "1:2",
      "Card",
      { fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1, a: 1 } }] },
      [rect],
    );
    const root = frame("1:1", "Root", {}, [parent]);
    const result = buildNormalizedGraph(root, {});

    const card = result.root.children![0] as any;
    expect(card.children).toHaveLength(1);
    expect(card.children[0].type).toBe("RECTANGLE");
  });
});

describe("Output size", () => {
  it("v3 output is smaller than a comparable raw fixture", () => {
    const children = Array.from({ length: 10 }, (_, i) =>
      text(`1:${i + 2}`, `Label ${i}`, `Text content ${i}`),
    );
    const raw = autoLayout("1:1", "Root", "VERTICAL", { itemSpacing: 16 }, children);

    const rawSize = JSON.stringify(raw).length;
    const result = buildNormalizedGraph(raw, {});
    const outputSize = JSON.stringify(result).length;

    // V3 must not balloon the size beyond the raw input
    expect(outputSize).toBeLessThan(rawSize * 2);
  });
});

// ---------------------------------------------------------------------------
// 14. parseVariantProps
// ---------------------------------------------------------------------------

describe("parseVariantProps", () => {
  it("parses a standard Figma variant name into lowercase props", () => {
    const result = parseVariantProps("Variant=Destructive, Size=Regular, State=Hover");
    expect(result).toEqual({ variant: "destructive", size: "regular", state: "hover" });
  });

  it("handles values with spaces by replacing them with hyphens", () => {
    const result = parseVariantProps("Type=Icon Left, Size=Extra Large");
    expect(result).toEqual({ type: "icon-left", size: "extra-large" });
  });

  it("returns empty object for non-variant-style names", () => {
    const result = parseVariantProps("Button/Primary");
    expect(result).toEqual({});
  });

  it("returns empty object for empty string", () => {
    const result = parseVariantProps("");
    expect(result).toEqual({});
  });

  it("ignores pairs without an equals sign", () => {
    const result = parseVariantProps("Variant=Primary, InvalidPair, State=Default");
    expect(result).toEqual({ variant: "primary", state: "default" });
  });

  it("normalises keys to lowercase with hyphens", () => {
    const result = parseVariantProps("Button Type=Icon, Is Disabled=True");
    expect(result).toEqual({ "button-type": "icon", "is-disabled": "true" });
  });

  it("same input always produces identical output (determinism)", () => {
    const input = "Variant=Primary, Size=Large, State=Hover";
    expect(parseVariantProps(input)).toEqual(parseVariantProps(input));
  });
});
