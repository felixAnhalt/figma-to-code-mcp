import { describe, it, expect } from "vitest";
import {
  compressChildren,
  decompressNode,
  decompressChildren,
  decompressTree,
} from "~/figma/compress";
import type { V3Node } from "~/figma/types";

describe("Compression and Decompression", () => {
  it("compresses identical consecutive nodes", () => {
    const node1: V3Node = { type: "RECTANGLE", name: "Row" };
    const node2: V3Node = { type: "RECTANGLE", name: "Row" };
    const node3: V3Node = { type: "RECTANGLE", name: "Row" };

    const compressed = compressChildren([node1, node2, node3]);

    expect(compressed).toHaveLength(1);
    expect(compressed![0].repeat?.count).toBe(3);
    expect(compressed![0].repeatExcept).toBeUndefined();
  });

  it("compresses nodes with text exceptions", () => {
    const node1: V3Node = { type: "TEXT", text: "A" };
    const node2: V3Node = { type: "TEXT", text: "B" };
    const node3: V3Node = { type: "TEXT", text: "C" };

    const compressed = compressChildren([node1, node2, node3]);

    expect(compressed).toHaveLength(1);
    expect(compressed![0].repeat?.count).toBe(3);
    expect(compressed![0].repeatExcept).toBeDefined();
    // Each has a different merge, so they don't group into ranges
    expect(compressed![0].repeatExcept!.length).toBeGreaterThan(0);
  });

  it("compresses nodes with style exceptions", () => {
    const base: V3Node = {
      type: "RECTANGLE",
      style: { background: "rgba(0,0,0,1)" },
    };
    const withBorder: V3Node = {
      type: "RECTANGLE",
      style: { background: "rgba(0,0,0,1)", border: "rgba(255,0,0,1)" },
    };

    const compressed = compressChildren([base, withBorder, withBorder]);

    expect(compressed).toHaveLength(1);
    expect(compressed![0].repeat?.count).toBe(3);
    expect(compressed![0].repeatExcept).toBeDefined();
  });

  it("does not compress if fewer than 2 identical nodes", () => {
    const node1: V3Node = { type: "RECTANGLE", name: "Unique" };
    const node2: V3Node = { type: "FRAME", name: "Different" };

    const compressed = compressChildren([node1, node2]);

    expect(compressed).toHaveLength(2);
    expect(compressed![0].repeat).toBeUndefined();
    expect(compressed![1].repeat).toBeUndefined();
  });

  it("compresses nested children recursively", () => {
    // Create an outer node with identical inner children
    const outerNode: V3Node = {
      type: "FRAME",
      children: [
        { type: "TEXT", text: "Item" },
        { type: "TEXT", text: "Item" },
      ],
    };

    const compressed = compressChildren([outerNode]);

    expect(compressed).toHaveLength(1);
    // Inner children should be compressed
    expect(compressed![0].children).toHaveLength(1);
    expect(compressed![0].children![0].repeat?.count).toBe(2);
  });

  it("decompresses single repeated node", () => {
    const compressed: V3Node = {
      type: "RECTANGLE",
      name: "Row",
      repeat: { count: 3 },
    };

    const decompressed = decompressNode(compressed);

    expect(decompressed).toHaveLength(3);
    expect(decompressed[0]).toEqual({ type: "RECTANGLE", name: "Row" });
    expect(decompressed[1]).toEqual({ type: "RECTANGLE", name: "Row" });
    expect(decompressed[2]).toEqual({ type: "RECTANGLE", name: "Row" });
  });

  it("decompresses node with text exceptions", () => {
    const compressed: V3Node = {
      type: "TEXT",
      text: "A",
      repeat: { count: 3 },
      repeatExcept: [
        { indices: 1, merge: { text: "B" } },
        { indices: 2, merge: { text: "C" } },
      ],
    };

    const decompressed = decompressNode(compressed);

    expect(decompressed).toHaveLength(3);
    expect(decompressed[0].text).toBe("A");
    expect(decompressed[1].text).toBe("B");
    expect(decompressed[2].text).toBe("C");
  });

  it("decompresses with range exceptions", () => {
    const compressed: V3Node = {
      type: "RECTANGLE",
      style: { background: "rgba(0,0,0,1)" },
      repeat: { count: 5 },
      repeatExcept: [
        {
          indices: "1..4",
          merge: { style: { border: "rgba(255,0,0,1)" } },
        },
      ],
    };

    const decompressed = decompressNode(compressed);

    expect(decompressed).toHaveLength(5);
    expect(decompressed[0].style?.border).toBeUndefined();
    expect(decompressed[1].style?.border).toBe("rgba(255,0,0,1)");
    expect(decompressed[2].style?.border).toBe("rgba(255,0,0,1)");
    expect(decompressed[3].style?.border).toBe("rgba(255,0,0,1)");
    expect(decompressed[4].style?.border).toBe("rgba(255,0,0,1)");
  });

  it("roundtrips: compress then decompress yields original", () => {
    const original: V3Node[] = [
      { type: "TEXT", text: "Row 1" },
      { type: "TEXT", text: "Row 2" },
      { type: "TEXT", text: "Row 3" },
    ];

    const compressed = compressChildren(original);
    const decompressed = decompressChildren(compressed);

    expect(decompressed).toEqual(original);
  });

  it("roundtrips with nested children", () => {
    const original: V3Node[] = [
      {
        type: "FRAME",
        name: "Group 1",
        children: [
          { type: "RECTANGLE", name: "Item" },
          { type: "RECTANGLE", name: "Item" },
        ],
      },
      {
        type: "FRAME",
        name: "Group 1",
        children: [
          { type: "RECTANGLE", name: "Item" },
          { type: "RECTANGLE", name: "Item" },
        ],
      },
    ];

    const compressed = compressChildren(original);
    const decompressed = decompressChildren(compressed);

    expect(decompressed).toEqual(original);
  });

  it("groups consecutive exceptions with identical merge objects into ranges", () => {
    const node1: V3Node = { type: "RECTANGLE", style: { background: "white" } };
    const nodeBordered: V3Node = {
      type: "RECTANGLE",
      style: { background: "white", border: "red" },
    };

    const children = [node1, ...Array(19).fill(nodeBordered)];
    const compressed = compressChildren(children);

    expect(compressed).toHaveLength(1);
    expect(compressed![0].repeatExcept).toHaveLength(1);
    // Should group into a range "1..19"
    expect(compressed![0].repeatExcept![0].indices).toBe("1..19");
  });

  it("preserves non-compressed nodes", () => {
    const node1: V3Node = { type: "RECTANGLE", name: "A" };
    const node2: V3Node = { type: "RECTANGLE", name: "B" };
    const node3: V3Node = { type: "RECTANGLE", name: "C" };

    const compressed = compressChildren([node1, node2, node3]);

    expect(compressed).toHaveLength(3);
    expect(compressed![0].repeat).toBeUndefined();
    expect(compressed![1].repeat).toBeUndefined();
    expect(compressed![2].repeat).toBeUndefined();
  });

  it("decompressTree expands root node", () => {
    const tree: V3Node = {
      type: "FRAME",
      repeat: { count: 2 },
      children: [{ type: "TEXT", text: "Item" }],
    };

    const decompressed = decompressTree(tree);

    expect(decompressed.type).toBe("FRAME");
    expect(decompressed.repeat).toBeUndefined();
  });

  it("handles mixed compression patterns", () => {
    const children: V3Node[] = [
      { type: "RECTANGLE", name: "A" },
      { type: "RECTANGLE", name: "A" },
      { type: "RECTANGLE", name: "A" },
      { type: "FRAME", name: "B" },
      { type: "FRAME", name: "B" },
    ];

    const compressed = compressChildren(children);

    expect(compressed).toHaveLength(2);
    expect(compressed![0].repeat?.count).toBe(3);
    expect(compressed![1].repeat?.count).toBe(2);
  });

  it("preserves non-exception fields during decompression", () => {
    const compressed: V3Node = {
      type: "RECTANGLE",
      name: "Base",
      style: { background: "blue" },
      layout: { width: "100%" },
      repeat: { count: 2 },
    };

    const decompressed = decompressNode(compressed);

    expect(decompressed[0].name).toBe("Base");
    expect(decompressed[0].style?.background).toBe("blue");
    expect(decompressed[0].layout?.width).toBe("100%");
    expect(decompressed[1].name).toBe("Base");
  });
});
