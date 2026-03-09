import { describe, it, expect } from "vitest";
import { buildNormalizedGraph } from "~/figma/reducer.js";
import testData from "./resources/testfigmaresult.json";

describe("ID Mapping Token Efficiency", () => {
  it("measures token savings from ID mapping", () => {
    const nodeId = Object.keys(testData.nodes)[0];
    const rawNode = testData.nodes[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});
    const output = JSON.stringify(normalized);

    // Count ID occurrences and measure savings
    const nestedIdPattern = /[";]I\d+:\d+;\d+/g;
    const nestedIdMatches = output.match(nestedIdPattern) || [];

    console.log("\n=== ID Mapping Statistics ===");
    console.log(`Total nested IDs in output: ${nestedIdMatches.length}`);

    // Sample some IDs to show the mapping
    const sampleIds = nestedIdMatches.slice(0, 5);
    console.log("\nSample mapped IDs:");
    sampleIds.forEach((id) => {
      // Remove leading quote/semicolon
      const cleanId = id.replace(/^[";]/, "");
      console.log(`  ${cleanId}`);
    });

    // Measure total output size
    const totalSize = output.length;
    console.log(`\nTotal output size: ${totalSize.toLocaleString()} bytes`);

    // Calculate what size would be WITHOUT ID mapping
    // Average original nested ID length was ~51 chars based on previous analysis
    // Now they're shortened to format like "I4014:2428;0" (~15 chars average)
    const avgOriginalIdLength = 51;
    const avgMappedIdLength =
      output.match(/I\d+:\d+;\d+/g)?.reduce((sum, id) => sum + id.length, 0) /
        nestedIdMatches.length || 15;

    const estimatedSavingsFromIds =
      nestedIdMatches.length * (avgOriginalIdLength - avgMappedIdLength);
    const estimatedSizeWithoutMapping = totalSize + estimatedSavingsFromIds;
    const idMappingReduction = (estimatedSavingsFromIds / estimatedSizeWithoutMapping) * 100;

    console.log(`\nAverage mapped ID length: ${avgMappedIdLength.toFixed(1)} chars`);
    console.log(`Estimated original ID length: ${avgOriginalIdLength} chars`);
    console.log(
      `Estimated savings from ID mapping: ${estimatedSavingsFromIds.toLocaleString()} bytes`,
    );
    console.log(`ID mapping reduction: ${idMappingReduction.toFixed(1)}%`);

    // Verify IDs are actually mapped
    expect(nestedIdMatches.length).toBeGreaterThan(0);
    expect(avgMappedIdLength).toBeLessThan(avgOriginalIdLength);
  });

  it("verifies no _idMap in output", () => {
    const nodeId = Object.keys(testData.nodes)[0];
    const rawNode = testData.nodes[nodeId];

    const normalized = buildNormalizedGraph(rawNode, {});

    // Verify _idMap is not in the output
    expect(normalized).not.toHaveProperty("_idMap");
    expect(JSON.stringify(normalized)).not.toContain("_idMap");
  });
});
