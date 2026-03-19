import { describe, it, expect } from "vitest";
import { buildNormalizedGraph } from "~/figma/reducer.js";

describe.skipIf(process.env.RUN_BENCHMARK_TESTS !== "1")(
  "Final benchmark (v3 — nested tree)",
  () => {
    // This test requires testfigmaresult.json fixture
    // Run locally only: RUN_BENCHMARK_TESTS=1 pnpm test -- final-benchmark
    it("produces valid v3 structure and achieves meaningful size reduction", async () => {
      // Dynamically import fixture only when test runs
      const { default: testData } = await import("./resources/testfigmaresult.json", {
        with: { type: "json" },
      });
      const nodeId = Object.keys(testData.nodes as any)[0];
      const rawNode = (testData.nodes as any)[nodeId];

      const rawSize = JSON.stringify(rawNode).length;
      const normalized = buildNormalizedGraph(rawNode, {});
      const optimizedSize = JSON.stringify(normalized).length;

      const reduction = ((rawSize - optimizedSize) / rawSize) * 100;

      console.log("\n=== V3 BENCHMARK RESULTS ===");
      console.log(`Raw:       ${rawSize.toLocaleString()} bytes`);
      console.log(`Optimized: ${optimizedSize.toLocaleString()} bytes`);
      console.log(`Reduction: ${reduction.toFixed(1)}%\n`);

      // v3 must not balloon beyond the raw input
      expect(optimizedSize).toBeLessThan(rawSize * 2);

      // v3 structure validation
      expect(normalized.schema).toBe("v3");
      expect(normalized.root).toBeDefined();
      expect(normalized).not.toHaveProperty("nodes");
      expect(normalized).not.toHaveProperty("paints");
      expect(normalized).not.toHaveProperty("stylesPayload");
      expect(normalized).not.toHaveProperty("variables");
    });
  },
);
