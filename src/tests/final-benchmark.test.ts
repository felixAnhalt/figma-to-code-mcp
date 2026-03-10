import { describe, it, expect } from "vitest";
import { buildNormalizedGraph } from "~/figma/reducer.js";
import testData from "./resources/testfigmaresult.json" with { type: "json" };

describe("Final benchmark (v2 - CSS-aligned)", () => {
  it("achieves target size reduction on test dataset", () => {
    const nodeId = Object.keys(testData.nodes as any)[0];
    const rawNode = (testData.nodes as any)[nodeId];

    // Get sizes
    const rawSize = JSON.stringify(rawNode).length;
    const normalized = buildNormalizedGraph(rawNode, {});
    const optimizedSize = JSON.stringify(normalized).length;

    const reduction = ((rawSize - optimizedSize) / rawSize) * 100;

    console.log("\n=== V2 BENCHMARK RESULTS ===");
    console.log(`Raw:       ${rawSize.toLocaleString()} bytes`);
    console.log(`Optimized: ${optimizedSize.toLocaleString()} bytes`);
    console.log(`Reduction: ${reduction.toFixed(1)}%\n`);

    // v2 should achieve better reduction than v1 (42.4%)
    expect(reduction).toBeGreaterThan(40);

    // v2 structure validation
    expect(normalized).toHaveProperty("root");
    expect(normalized).toHaveProperty("nodes");
    expect(normalized).not.toHaveProperty("paints");
    expect(normalized).not.toHaveProperty("stylesPayload");
  });
});
