import { describe, it } from "vitest";

describe.skipIf(process.env.RUN_BENCHMARK_TESTS !== "1")("Additional optimization analysis", () => {
  // This test requires testfigmaresultreduced.json fixture
  // Run locally only: RUN_BENCHMARK_TESTS=1 pnpm test -- additional-optimizations
  it("analyzes potential optimizations in reduced output", async () => {
    // Dynamically import fixture only when test runs
    const { default: testData } = await import("./resources/testfigmaresultreduced.json", {
      with: { type: "json" },
    });
    const output = JSON.stringify(testData);

    console.log("\n=== ADDITIONAL OPTIMIZATION OPPORTUNITIES ===\n");

    // 1. Analyze padding patterns
    const zeroPaddingPattern =
      /"padding":\s*\{\s*"top":\s*0,\s*"bottom":\s*0,\s*"left":\s*0,\s*"right":\s*0\s*\}/g;
    const zeroPaddingMatches = output.match(zeroPaddingPattern) || [];
    console.log("1. Zero Padding Objects:");
    console.log(`   Occurrences: ${zeroPaddingMatches.length}`);
    console.log(`   Could omit padding when all zeros`);
    console.log(`   Estimated savings: ~${zeroPaddingMatches.length * 60} bytes\n`);

    // 2. Analyze flex gap:0
    const zeroGapPattern = /"gap":\s*0,/g;
    const zeroGapMatches = output.match(zeroGapPattern) || [];
    console.log("2. Zero Gap Values:");
    console.log(`   Occurrences: ${zeroGapMatches.length}`);
    console.log(`   Could omit gap when 0`);
    console.log(`   Estimated savings: ~${zeroGapMatches.length * 8} bytes\n`);

    // 3. Analyze layoutGrow: 0
    const layoutGrowZeroPattern = /"layoutGrow":\s*0/g;
    const layoutGrowMatches = output.match(layoutGrowZeroPattern) || [];
    console.log("3. layoutGrow: 0:");
    console.log(`   Occurrences: ${layoutGrowMatches.length}`);
    console.log(`   Could omit when 0 (default)`);
    console.log(`   Estimated savings: ~${layoutGrowMatches.length * 16} bytes\n`);

    // 4. Analyze layoutWrap: "NO_WRAP"
    const noWrapPattern = /"layoutWrap":\s*"NO_WRAP"/g;
    const noWrapMatches = output.match(noWrapPattern) || [];
    console.log("4. layoutWrap: 'NO_WRAP':");
    console.log(`   Occurrences: ${noWrapMatches.length}`);
    console.log(`   Could omit when NO_WRAP (likely default)`);
    console.log(`   Estimated savings: ~${noWrapMatches.length * 24} bytes\n`);

    // 5. Check if layout and flex are duplicates
    const nodesWithBoth = Object.values(testData.nodes).filter(
      (node: any) => node.layout && node.flex,
    ).length;
    console.log("5. Layout vs Flex Duplication:");
    console.log(`   Nodes with both layout & flex: ${nodesWithBoth}`);
    console.log(`   Could remove 'layout' object entirely, keep only 'flex'`);
    console.log(`   Estimated savings: ~30-40% of layout data\n`);

    // 6. Analyze "children" arrays in flex
    const flexChildrenPattern = /"flex":\s*\{[^}]*"children":\s*\[[^\]]+\]/g;
    const flexChildrenMatches = output.match(flexChildrenPattern) || [];
    console.log("6. Children Arrays in Flex:");
    console.log(`   Occurrences: ${flexChildrenMatches.length}`);
    console.log(`   Redundant with node.children`);
    console.log(`   Estimated savings: ~10KB\n`);

    // 7. Analyze itemSpacing patterns
    const itemSpacingPattern = /"itemSpacing":\s*(\d+)/g;
    const itemSpacingMatches = [...output.matchAll(itemSpacingPattern)];
    const spacingValues = itemSpacingMatches.map((m) => parseInt(m[1]));
    const zeroSpacing = spacingValues.filter((v) => v === 0).length;
    console.log("7. ItemSpacing Analysis:");
    console.log(`   Total occurrences: ${spacingValues.length}`);
    console.log(
      `   Zero values: ${zeroSpacing} (${((zeroSpacing / spacingValues.length) * 100).toFixed(1)}%)`,
    );
    console.log(`   Could omit when 0\n`);

    // 8. Analyze boundVariables empty objects
    const emptyBoundVarsPattern = /"boundVariables":\s*\{\s*\}/g;
    const emptyBoundVarsMatches = output.match(emptyBoundVarsPattern) || [];
    console.log("8. Empty boundVariables:");
    console.log(`   Occurrences: ${emptyBoundVarsMatches.length}`);
    console.log(`   Always empty - could omit entirely`);
    console.log(`   Estimated savings: ~${emptyBoundVarsMatches.length * 22} bytes\n`);

    // Calculate total potential savings
    const totalPotential =
      zeroPaddingMatches.length * 60 +
      zeroGapMatches.length * 8 +
      layoutGrowMatches.length * 16 +
      noWrapMatches.length * 24 +
      emptyBoundVarsMatches.length * 22 +
      10000; // flex children + layout removal

    const currentSize = output.length;
    const additionalReduction = ((totalPotential / currentSize) * 100).toFixed(1);

    console.log("=== SUMMARY ===");
    console.log(`Current size: ${currentSize.toLocaleString()} bytes`);
    console.log(
      `Additional potential: ~${totalPotential.toLocaleString()} bytes (${additionalReduction}%)`,
    );
    console.log(`Final size estimate: ~${(currentSize - totalPotential).toLocaleString()} bytes\n`);
  });
});
