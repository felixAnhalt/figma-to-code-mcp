/**
 * Enriched Component Definitions Tests
 *
 * Tests the enrichment in generateMCPResponse:
 *   Phase 1 — componentSetName / variantName / props from already-fetched metadata maps
 *   Phase 2 — layout/style/children from component source nodes, plus variants dict
 *   Phase 3 — conversion of definitions → componentSets with base dedup and tree patching
 *
 * Network calls are mocked so tests run without a Figma API key.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RichComponentMeta } from "~/figma";

// ---------------------------------------------------------------------------
// Module mocks — must be hoisted before any imports that trigger module init
// ---------------------------------------------------------------------------

vi.mock("~/figma/batchFetch", () => ({
  fetchNodesBatch: vi.fn(),
}));

vi.mock("~/figma/rateLimit", () => ({
  safeFetch: vi.fn(),
}));

vi.mock("~/figma/cache", () => ({
  getCache: vi.fn(() => null),
  setCache: vi.fn(),
}));

import { generateMCPResponse } from "~/figma/index";
import { fetchNodesBatch } from "~/figma/batchFetch";
import { safeFetch } from "~/figma/rateLimit";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function mockSafeFetch(body: unknown) {
  (safeFetch as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    json: async () => body,
  });
}

/** Returns a minimal raw FRAME node entry as fetchNodesBatch would return it */
function frameNodeEntry(
  nodeId: string,
  name: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    document: {
      id: nodeId,
      type: "FRAME",
      name,
      children: [],
      ...overrides,
    },
    components: {},
    componentSets: {},
  };
}

/** Returns a minimal raw INSTANCE node for the root document */
function instanceNode(id: string, name: string, componentId: string): Record<string, unknown> {
  return { id, type: "INSTANCE", name, componentId, children: [] };
}

/** Returns the root fetchNodesBatch response (the design file root node) */
function rootFileResponse(rootId: string, children: unknown[]): Record<string, unknown> {
  return {
    [rootId]: {
      document: { id: rootId, type: "FRAME", name: "Root", children },
      components: {},
      componentSets: {},
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Component definitions — enriched", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Phase 3: componentSets is populated and definitions is absent", async () => {
    const compId = "100:1";
    const setId = "200:1";

    const componentMap: Record<string, RichComponentMeta> = {
      [compId]: {
        key: "abc",
        file_key: "libFile",
        node_id: compId,
        name: "Button/Primary",
        componentSetId: setId,
      },
    };
    const componentSetMap = { [setId]: { name: "Button" } };

    const inst = instanceNode("I1:2", "ButtonInst", compId);
    (fetchNodesBatch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(rootFileResponse("1:1", [inst]))
      .mockResolvedValueOnce({ [compId]: frameNodeEntry(compId, "Button/Primary") });

    mockSafeFetch({ meta: { variables: {} } });

    const result = await generateMCPResponse({
      fileKey: "designFile",
      authHeaders: { "X-Figma-Token": "tok" },
      rootNodeId: "1:1",
      componentMap,
      componentSetMap,
      resolveVariables: false,
    });

    expect(result.definitions).toBeUndefined();
    expect(result.componentSets).toBeDefined();
    expect(result.componentSets!["Button"]).toBeDefined();
  });

  it("Phase 3: componentSet is keyed by the set name", async () => {
    const compId = "100:1";
    const setId = "200:1";

    const componentMap: Record<string, RichComponentMeta> = {
      [compId]: {
        key: "abc",
        file_key: "libFile",
        node_id: compId,
        name: "Button/Primary",
        componentSetId: setId,
      },
    };
    const componentSetMap = { [setId]: { name: "Button" } };

    const inst = instanceNode("I1:2", "ButtonInst", compId);
    (fetchNodesBatch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(rootFileResponse("1:1", [inst]))
      .mockResolvedValueOnce({ [compId]: frameNodeEntry(compId, "Button/Primary") });

    const result = await generateMCPResponse({
      fileKey: "designFile",
      authHeaders: { "X-Figma-Token": "tok" },
      rootNodeId: "1:1",
      componentMap,
      componentSetMap,
      resolveVariables: false,
    });

    const set = result.componentSets!["Button"];
    expect(set).toBeDefined();
    expect(set.name).toBe("Button");
  });

  it("Phase 1+3: variant props are parsed from the component name", async () => {
    const compId = "100:1";
    const setId = "200:1";

    const componentMap: Record<string, RichComponentMeta> = {
      [compId]: {
        key: "abc",
        file_key: "libFile",
        node_id: compId,
        name: "Variant=Destructive, Size=Regular, State=Default",
        componentSetId: setId,
      },
    };
    const componentSetMap = { [setId]: { name: "Button" } };

    const inst = instanceNode("I1:2", "ButtonInst", compId);
    (fetchNodesBatch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(rootFileResponse("1:1", [inst]))
      .mockResolvedValueOnce({
        [compId]: frameNodeEntry(compId, "Variant=Destructive, Size=Regular, State=Default"),
      });

    const result = await generateMCPResponse({
      fileKey: "designFile",
      authHeaders: { "X-Figma-Token": "tok" },
      rootNodeId: "1:1",
      componentMap,
      componentSetMap,
      resolveVariables: false,
    });

    const set = result.componentSets!["Button"];
    expect(set.propKeys).toContain("variant");
    expect(set.propKeys).toContain("size");
    expect(set.propKeys).toContain("state");

    // The one variant entry in the set should have parsed props
    const variantEntry = set.variants[compId];
    expect(variantEntry).toBeDefined();
    expect(variantEntry.props).toEqual({
      variant: "destructive",
      size: "regular",
      state: "default",
    });
  });

  it("Phase 3: INSTANCE node in tree has component set name and props", async () => {
    const compId = "100:1";
    const setId = "200:1";

    const componentMap: Record<string, RichComponentMeta> = {
      [compId]: {
        key: "abc",
        file_key: "libFile",
        node_id: compId,
        name: "Variant=Primary, Size=Large",
        componentSetId: setId,
      },
    };
    const componentSetMap = { [setId]: { name: "Button" } };

    const inst = instanceNode("I1:2", "ButtonInst", compId);
    (fetchNodesBatch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(rootFileResponse("1:1", [inst]))
      .mockResolvedValueOnce({
        [compId]: frameNodeEntry(compId, "Variant=Primary, Size=Large"),
      });

    const result = await generateMCPResponse({
      fileKey: "designFile",
      authHeaders: { "X-Figma-Token": "tok" },
      rootNodeId: "1:1",
      componentMap,
      componentSetMap,
      resolveVariables: false,
    });

    const instNode = result.root.children![0] as any;
    expect(instNode.component).toBe("Button");
    expect(instNode.props).toEqual({ variant: "primary", size: "large" });
  });

  it("Phase 2+3: layout is merged from the component's fetched node", async () => {
    const compId = "100:1";

    const componentMap: Record<string, RichComponentMeta> = {
      [compId]: { key: "abc", file_key: "libFile", node_id: compId, name: "MyComp" },
    };

    const inst = instanceNode("I1:2", "MyCompInst", compId);

    const compNodeEntry = frameNodeEntry(compId, "MyComp", {
      layoutMode: "HORIZONTAL",
      size: { x: 200, y: 48 },
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
    });

    (fetchNodesBatch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(rootFileResponse("1:1", [inst]))
      .mockResolvedValueOnce({ [compId]: compNodeEntry });

    const result = await generateMCPResponse({
      fileKey: "designFile",
      authHeaders: { "X-Figma-Token": "tok" },
      rootNodeId: "1:1",
      componentMap,
      resolveVariables: false,
    });

    // The component ends up in componentSets keyed by its name (no set ID → uses name)
    const set = result.componentSets!["MyComp"];
    expect(set).toBeDefined();

    // The variant entry (or base) should carry the layout
    const variantEntry = set.variants[compId];
    const effectiveLayout = variantEntry?.layout ?? set.base?.layout;
    expect(effectiveLayout).toBeDefined();
    expect(effectiveLayout?.direction).toBe("row");
    expect(effectiveLayout?.width).toBe(200);
    expect(effectiveLayout?.height).toBe(48);
  });

  it("Phase 2+3: children are available in the componentSet", async () => {
    const compId = "100:1";

    const componentMap: Record<string, RichComponentMeta> = {
      [compId]: { key: "abc", file_key: "libFile", node_id: compId, name: "Card" },
    };

    const inst = instanceNode("I1:2", "CardInst", compId);

    const childText = {
      id: "100:2",
      type: "TEXT",
      name: "Label",
      characters: "Hello",
      fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 } }],
      style: { fontFamily: "Inter", fontSize: 14, fontWeight: 400, lineHeightPx: 20 },
    };
    const compNodeEntry = frameNodeEntry(compId, "Card", { children: [childText] });

    (fetchNodesBatch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(rootFileResponse("1:1", [inst]))
      .mockResolvedValueOnce({ [compId]: compNodeEntry });

    const result = await generateMCPResponse({
      fileKey: "designFile",
      authHeaders: { "X-Figma-Token": "tok" },
      rootNodeId: "1:1",
      componentMap,
      resolveVariables: false,
    });

    const set = result.componentSets!["Card"];
    expect(set).toBeDefined();

    const variantEntry = set.variants[compId];
    const effectiveChildren = variantEntry?.children ?? set.base?.children;
    expect(effectiveChildren).toBeDefined();
    expect(effectiveChildren).toHaveLength(1);
    expect(effectiveChildren![0].type).toBe("TEXT");
  });

  it("Phase 2+3: sibling variants appear in the componentSet variants dict", async () => {
    const setId = "200:1";
    const compIdA = "100:1";
    const compIdB = "100:2";

    const componentMap: Record<string, RichComponentMeta> = {
      [compIdA]: {
        key: "aaa",
        file_key: "libFile",
        node_id: compIdA,
        name: "Variant=Primary",
        componentSetId: setId,
      },
      [compIdB]: {
        key: "bbb",
        file_key: "libFile",
        node_id: compIdB,
        name: "Variant=Secondary",
        componentSetId: setId,
      },
    };

    const inst = instanceNode("I1:2", "BtnInst", compIdA);

    (fetchNodesBatch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(rootFileResponse("1:1", [inst]))
      .mockResolvedValueOnce({
        [compIdA]: frameNodeEntry(compIdA, "Variant=Primary"),
        [compIdB]: frameNodeEntry(compIdB, "Variant=Secondary"),
      });

    const componentSetMap = { [setId]: { name: "Button" } };

    const result = await generateMCPResponse({
      fileKey: "designFile",
      authHeaders: { "X-Figma-Token": "tok" },
      rootNodeId: "1:1",
      componentMap,
      componentSetMap,
      resolveVariables: false,
    });

    const set = result.componentSets!["Button"];
    expect(set).toBeDefined();
    // Both variants should be present
    expect(set.variants[compIdA]).toBeDefined();
    expect(set.variants[compIdB]).toBeDefined();
    expect(set.variants[compIdA].props).toEqual({ variant: "primary" });
    expect(set.variants[compIdB].props).toEqual({ variant: "secondary" });
    // propKeys captures the dimension
    expect(set.propKeys).toContain("variant");
  });

  it("Phase 3: base styles hold shared values and variant overrides hold only deltas", async () => {
    const setId = "200:1";
    const compIdA = "100:1";
    const compIdB = "100:2";

    const componentMap: Record<string, RichComponentMeta> = {
      [compIdA]: {
        key: "aaa",
        file_key: "libFile",
        node_id: compIdA,
        name: "Variant=Primary",
        componentSetId: setId,
      },
      [compIdB]: {
        key: "bbb",
        file_key: "libFile",
        node_id: compIdB,
        name: "Variant=Secondary",
        componentSetId: setId,
      },
    };

    const inst = instanceNode("I1:2", "BtnInst", compIdA);

    // Both share layoutMode=HORIZONTAL; they differ only in fill colour
    (fetchNodesBatch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(rootFileResponse("1:1", [inst]))
      .mockResolvedValueOnce({
        [compIdA]: frameNodeEntry(compIdA, "Variant=Primary", {
          layoutMode: "HORIZONTAL",
          fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 1, a: 1 } }],
        }),
        [compIdB]: frameNodeEntry(compIdB, "Variant=Secondary", {
          layoutMode: "HORIZONTAL",
          fills: [{ type: "SOLID", color: { r: 1, g: 0, b: 0, a: 1 } }],
        }),
      });

    const componentSetMap = { [setId]: { name: "Button" } };

    const result = await generateMCPResponse({
      fileKey: "designFile",
      authHeaders: { "X-Figma-Token": "tok" },
      rootNodeId: "1:1",
      componentMap,
      componentSetMap,
      resolveVariables: false,
    });

    const set = result.componentSets!["Button"];
    // Shared direction should be in base
    expect(set.base?.layout?.direction).toBe("row");
    // Each variant should have only the style override (the differing background)
    expect(set.variants[compIdA].layout).toBeUndefined();
    expect(set.variants[compIdA].style?.background).toBeDefined();
    expect(set.variants[compIdB].layout).toBeUndefined();
    expect(set.variants[compIdB].style?.background).toBeDefined();
  });

  it("componentSets is absent when no INSTANCE nodes exist", async () => {
    (fetchNodesBatch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      "1:1": {
        document: { id: "1:1", type: "FRAME", name: "Root", children: [] },
        components: {},
        componentSets: {},
      },
    });

    const result = await generateMCPResponse({
      fileKey: "designFile",
      authHeaders: { "X-Figma-Token": "tok" },
      rootNodeId: "1:1",
      resolveVariables: false,
    });

    expect(result.definitions).toBeUndefined();
    expect(result.componentSets).toBeUndefined();
    expect(fetchNodesBatch).toHaveBeenCalledTimes(1);
  });
});
