import { describe, it, expect, beforeEach } from "vitest";
import { buildNormalizedGraph, flushAllPendingVectorSvgs } from "~/figma/reducer.js";
import { svgContentCache } from "~/figma/svg-writer.js";
import fs from "fs";
import path from "path";

describe("live Figma vector merging with real data", () => {
  beforeEach(() => {
    svgContentCache.clear();
  });

  it("should produce correct SVG for text with two rows of letters", async () => {
    const targetNode = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "src/tests/resources/target-node.json"), "utf-8"),
    );

    buildNormalizedGraph(targetNode, {});
    await flushAllPendingVectorSvgs("");

    const cacheKeys = Array.from(svgContentCache.keys());
    expect(cacheKeys.length).toBeGreaterThan(0);

    const svgContent = svgContentCache.get(cacheKeys[0]);
    expect(svgContent).toBeDefined();

    console.log("Generated SVG:");
    console.log(svgContent);

    expect(svgContent).toContain('width="147"');
    expect(svgContent).toContain('height="50"');
    expect(svgContent).toContain('viewBox="0 0 147 50"');

    expect(svgContent).toContain('fill="#6d7ca2"');
    expect(svgContent).toContain('fill="#0a2463"');

    const firstPathMatch = svgContent.match(/M\s+([\d.]+)\s+([\d.]+)/);
    if (firstPathMatch) {
      console.log("First path coordinate:", firstPathMatch[1], firstPathMatch[2]);
    }

    expect(svgContent).toMatch(/M\s+5[5-9]\.\d+/);
    expect(svgContent).toMatch(/M\s+6[0-9]\.\d+/);
    expect(svgContent).toMatch(/M\s+8[0-9]\.\d+/);
  });
});
