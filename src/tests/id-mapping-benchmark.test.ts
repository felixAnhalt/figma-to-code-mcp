import { describe, it, expect } from "vitest";
import { buildNormalizedGraph } from "~/figma/reducer.js";

/**
 * In v3, INSTANCE node IDs are preserved verbatim (no IdMapper compression).
 * IDs only appear on INSTANCE nodes, so the volume of IDs in the output is
 * naturally minimized by the tree structure itself.
 */
describe.skipIf(process.env.RUN_BENCHMARK_TESTS !== "1")("INSTANCE ID preservation (v3)", () => {
  // This test requires testfigmaresult.json fixture
  // Run locally only: RUN_BENCHMARK_TESTS=1 pnpm test -- id-mapping-benchmark
  it("INSTANCE node IDs are preserved verbatim in the output", async () => {
    // Dynamically import fixture only when test runs
    const { default: testData } = await import("./resources/testfigmaresult.json", {
      with: { type: "json" },
    });
    const nodeId = Object.keys(testData.nodes as any)[0];
    const rawNode = (testData.nodes as any)[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});
    const output = JSON.stringify(normalized);

    function findInstances(node: any): any[] {
      const results: any[] = [];
      if (node.type === "INSTANCE") results.push(node);
      for (const child of node.children ?? []) {
        results.push(...findInstances(child));
      }
      return results;
    }

    const instances = findInstances(normalized.root);

    console.log("\n=== V3 INSTANCE ID Statistics ===");
    console.log(`Total INSTANCE nodes: ${instances.length}`);

    for (const inst of instances) {
      expect(inst.id).toBeDefined();
      // ID must appear verbatim in the output JSON
      expect(output).toContain(inst.id);
    }
  });

  it("non-INSTANCE nodes do not have an id field", async () => {
    // Dynamically import fixture only when test runs
    const { default: testData } = await import("./resources/testfigmaresult.json", {
      with: { type: "json" },
    });
    const nodeId = Object.keys(testData.nodes as any)[0];
    const rawNode = (testData.nodes as any)[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});

    function checkNoIdOnNonInstance(node: any) {
      if (node.type !== "INSTANCE") {
        expect(node).not.toHaveProperty("id");
      }
      for (const child of node.children ?? []) {
        checkNoIdOnNonInstance(child);
      }
    }

    checkNoIdOnNonInstance(normalized.root);
  });

  it("output does not contain _idMap", async () => {
    // Dynamically import fixture only when test runs
    const { default: testData } = await import("./resources/testfigmaresult.json", {
      with: { type: "json" },
    });
    const nodeId = Object.keys(testData.nodes as any)[0];
    const rawNode = (testData.nodes as any)[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});
    expect(normalized).not.toHaveProperty("_idMap");
    expect(JSON.stringify(normalized)).not.toContain("_idMap");
  });
});
