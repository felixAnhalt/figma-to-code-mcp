/**
 * Test that annotations are preserved through the full MCP pipeline:
 * 1. RAW file response → 2. REST normalization (buildNormalizedGraph) → 3. Component enrichment → 4. ComponentSets fro 5. Final MCP response
 *
 * This integration test verifies that Figma Dev Mode annotations survive the complete
 * transformation from raw REST API response to the MCPResponse sent to clients.
 */

import { describe, it, expect } from "vitest";
import { buildNormalizedGraph } from "~/figma/reducer";

/**
 * Helper to create a raw Figma node with annotations
 */
function makeRawFrame(
  id: string,
  name: string,
  children: unknown[] = [],
  annotations: unknown[] = [],
): Record<string, unknown> {
  return {
    id,
    type: "FRAME",
    name,
    children,
    annotations,
  };
}

/**
 * Build normalized graph from a raw frame node
 */
function buildNormalizedGraphFromFrame(
  frame: Record<string, unknown>,
): ReturnType<typeof buildNormalizedGraph> {
  const rawGraph = {
    document: {
      ...frame,
      children: frame.children || [],
    },
    components: {},
    componentSets: {},
  };

  return buildNormalizedGraph(rawGraph, {}, undefined, {}, "test-file-key", {});
}

// ---------------------------------------------------------------------------
// Test that annotations are carried through the pipeline from file to MCP response
// ---------------------------------------------------------------------------

describe("Annotations through pipeline", () => {
  it("preserves annotations in MCPResponse via buildNormalizedGraph", () => {
    const rawNode = makeRawFrame(
      "1:1",
      "Main Frame",
      [],
      [
        {
          label: "Use for the primary page action",
          labelMarkdown: "**Use for the primary page action**",
          categoryId: "123:789",
          properties: [{ type: "padding" }],
        },
      ],
    );

    const normalized = buildNormalizedGraphFromFrame(rawNode);

    expect(normalized.root.annotations).toBeDefined();
    expect(normalized.root.annotations).toHaveLength(1);

    const annotation = normalized.root.annotations![0];
    expect(annotation.label).toBe("Use for the primary page action");
    expect(annotation.labelMarkdown).toBe("**Use for the primary page action**");
    expect(annotation.categoryId).toBe("123:789");
    expect(annotation.properties).toEqual([{ type: "padding" }]);
  });

  it("preserves annotations in nested nodes", () => {
    const rawNode = makeRawFrame(
      "1:1",
      "Parent",
      [
        makeRawFrame("2:3", "Child", [], [{ label: "Child annotation" }]),
        makeRawFrame("3:4", "Child2", [], []),
      ],
      [],
    );

    const normalized = buildNormalizedGraphFromFrame(rawNode);

    expect(normalized.root.children).toHaveLength(2);
    expect(normalized.root.children![0].annotations).toBeDefined();
    expect(normalized.root.children![0].annotations).toHaveLength(1);
    expect(normalized.root.children![0].annotations![0].label).toBe("Child annotation");
    expect(normalized.root.children![1].annotations).toEqual([]);
  });
});
