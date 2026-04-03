/**
 * Enriched Component Definitions Tests
 *
 * Tests the two-pass enrichment in generateMCPResponse:
 *   Phase 1 — componentSetName / variantName from already-fetched metadata maps
 *   Phase 2 — layout/style/children from component source nodes, plus variants dict
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
      components: {
        // mirrors how the Figma file's /nodes response embeds component metadata
      },
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

  it("Phase 1: componentSetName is populated from componentSetMap", async () => {
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

    // Root node contains one INSTANCE referencing the component
    const inst = instanceNode("I1:2", "ButtonInst", compId);
    (fetchNodesBatch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(rootFileResponse("1:1", [inst]))
      // Phase 2 fetch for the library file
      .mockResolvedValueOnce({ [compId]: frameNodeEntry(compId, "Button/Primary") });

    // variables endpoint (safeFetch) — return empty so variable resolution is skipped
    mockSafeFetch({ meta: { variables: {} } });

    const result = await generateMCPResponse({
      fileKey: "designFile",
      authHeaders: { "X-Figma-Token": "tok" },
      rootNodeId: "1:1",
      componentMap,
      componentSetMap,
      resolveVariables: false,
    });

    expect(result.definitions![compId].componentSetName).toBe("Button");
  });

  it("Phase 1: variantName is set to the component's name", async () => {
    const compId = "100:1";

    const componentMap: Record<string, RichComponentMeta> = {
      [compId]: { key: "abc", file_key: "libFile", node_id: compId, name: "Button/Primary" },
    };

    const inst = instanceNode("I1:2", "ButtonInst", compId);
    (fetchNodesBatch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(rootFileResponse("1:1", [inst]))
      .mockResolvedValueOnce({ [compId]: frameNodeEntry(compId, "Button/Primary") });

    const result = await generateMCPResponse({
      fileKey: "designFile",
      authHeaders: { "X-Figma-Token": "tok" },
      rootNodeId: "1:1",
      componentMap,
      resolveVariables: false,
    });

    expect(result.definitions![compId].variantName).toBe("Button/Primary");
  });

  it("Phase 2: layout is merged from the component's fetched node", async () => {
    const compId = "100:1";

    const componentMap: Record<string, RichComponentMeta> = {
      [compId]: { key: "abc", file_key: "libFile", node_id: compId, name: "MyComp" },
    };

    const inst = instanceNode("I1:2", "MyCompInst", compId);

    // The fetched component node has an auto-layout with fixed dimensions
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

    // layout should be present (direction at minimum since layoutMode=HORIZONTAL)
    expect(result.definitions![compId].layout).toBeDefined();
    expect(result.definitions![compId].layout?.direction).toBe("row");
    expect(result.definitions![compId].layout?.width).toBe(200);
    expect(result.definitions![compId].layout?.height).toBe(48);
  });

  it("Phase 2: children are merged from the component's fetched node", async () => {
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

    const def = result.definitions![compId];
    expect(def.children).toBeDefined();
    expect(def.children).toHaveLength(1);
    expect(def.children![0].type).toBe("TEXT");
  });

  it("Phase 2: variants dict is populated with sibling variants from the same set", async () => {
    const setId = "200:1";
    const compIdA = "100:1";
    const compIdB = "100:2";

    const componentMap: Record<string, RichComponentMeta> = {
      [compIdA]: {
        key: "aaa",
        file_key: "libFile",
        node_id: compIdA,
        name: "Button/Primary",
        componentSetId: setId,
      },
      [compIdB]: {
        key: "bbb",
        file_key: "libFile",
        node_id: compIdB,
        name: "Button/Secondary",
        componentSetId: setId,
      },
    };

    // Only A is used in the design; B is a sibling variant
    const inst = instanceNode("I1:2", "BtnInst", compIdA);

    (fetchNodesBatch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(rootFileResponse("1:1", [inst]))
      .mockResolvedValueOnce({
        [compIdA]: frameNodeEntry(compIdA, "Button/Primary"),
        [compIdB]: frameNodeEntry(compIdB, "Button/Secondary"),
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

    const defA = result.definitions![compIdA];
    expect(defA.variants).toBeDefined();
    expect(defA.variants![compIdB]).toBeDefined();
    expect(defA.variants![compIdB].name).toBe("Button/Secondary");
    // The variant itself must not have a nested `variants` field
    expect(defA.variants![compIdB]).not.toHaveProperty("variants");
  });

  it("Phase 2: standalone component (no componentSetId) has no variants dict", async () => {
    const compId = "100:1";

    const componentMap: Record<string, RichComponentMeta> = {
      [compId]: { key: "abc", file_key: "libFile", node_id: compId, name: "StandaloneIcon" },
    };

    const inst = instanceNode("I1:2", "IconInst", compId);

    (fetchNodesBatch as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(rootFileResponse("1:1", [inst]))
      .mockResolvedValueOnce({ [compId]: frameNodeEntry(compId, "StandaloneIcon") });

    const result = await generateMCPResponse({
      fileKey: "designFile",
      authHeaders: { "X-Figma-Token": "tok" },
      rootNodeId: "1:1",
      componentMap,
      resolveVariables: false,
    });

    expect(result.definitions![compId].variants).toBeUndefined();
  });

  it("definitions are absent when no INSTANCE nodes exist (no Phase 2 call)", async () => {
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
    // fetchNodesBatch should only have been called once (for the root node)
    expect(fetchNodesBatch).toHaveBeenCalledTimes(1);
  });
});
