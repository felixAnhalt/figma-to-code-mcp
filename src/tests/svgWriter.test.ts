import { describe, it, expect, beforeEach } from "vitest";
import {
  buildSvgContentFromEntries,
  type SvgPathEntry,
  svgContentCache,
  getSvgCacheSize,
} from "../figma/svg-writer";

describe("svg-writer", () => {
  beforeEach(() => {
    svgContentCache.clear();
  });

  describe("buildSvgContentFromEntries", () => {
    it("should build SVG with single path and no transform", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [{ d: "M0 0L10 0L10 10L0 10Z" }],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      expect(result).toContain("<path");
      expect(result).toContain('d="M0 0L10 0L10 10L0 10Z"');
      expect(result).toContain("<svg");
    });

    it("should apply translation transform", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [{ d: "M0 0L10 0" }],
          transform: [1, 0, 0, 1, 5, 10],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      expect(result).toContain("5");
      expect(result).toContain("10");
    });

    it("should apply scale transform", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [{ d: "M0 0L10 0" }],
          transform: [2, 0, 0, 2, 0, 0],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      expect(result).toContain("20");
    });

    it("should apply combined transform with rotation", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [{ d: "M10 0L20 0" }],
          transform: [0, 1, -1, 0, 0, 0],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      expect(result).toContain("0");
      expect(result).toContain("10");
    });

    it("should handle relative M command", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [{ d: "m0 0l10 0l0 10z" }],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      expect(result).toContain("<path");
    });

    it("should handle relative L command", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [{ d: "M0 0l5 5l5 -5z" }],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      expect(result).toContain("5");
      expect(result).toContain("5");
    });

    it("should handle H command", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [{ d: "M0 0H10V10H0Z" }],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      expect(result).toContain("10");
    });

    it("should handle V command", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [{ d: "M0 0V10H5V0Z" }],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      expect(result).toContain("10");
    });

    it("should handle C (cubic bezier) command", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [{ d: "M0 0C10 10 20 10 30 30" }],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      expect(result).toContain("C");
    });

    it("should handle S (smooth cubic bezier) command", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [{ d: "M0 0C10 10 20 10 30 30S40 40 50 50" }],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      expect(result).toContain("S");
    });

    it("should handle Q (quadratic bezier) command", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [{ d: "M0 0Q10 10 20 20" }],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      expect(result).toContain("Q");
    });

    it("should handle T (smooth quadratic bezier) command", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [{ d: "M0 0Q10 10 20 20T40 40" }],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      expect(result).toContain("T");
    });

    it("should handle A (arc) command", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [{ d: "M0 0A10 10 0 0 1 20 0" }],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      expect(result).toContain("A");
    });

    it("should handle Z (close path) command", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [{ d: "M0 0L10 0L10 10Z" }],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      expect(result).toContain("Z");
    });

    it("should handle real Figma path data with translation transform", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [
            {
              d: "M11.3099 8.41149L9.26421 8.41149C9.11809 9.1735 8.70895 9.73036 8.09523 10.1407",
              fillRule: "nonzero",
            },
          ],
          transform: [1, 0, 0, 1, 46.993244171142578, 5.0410318374633789],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      expect(result).toContain("58.30");
      expect(result).toContain("13.45");
    });

    it("should handle multiple entries with different transforms", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [{ d: "M0 0L10 0" }],
          transform: [1, 0, 0, 1, 0, 0],
        },
        {
          paths: [{ d: "M0 0L10 0" }],
          transform: [1, 0, 0, 1, 20, 0],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      const pathCount = (result.match(/<path/g) || []).length;
      expect(pathCount).toBe(2);
      expect(result).toContain("20");
    });

    it("should include fill colors when specified", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [
            { d: "M0 0L10 0", fillColor: "#FF0000" },
            { d: "M20 0L30 0", fillColor: "#00FF00" },
          ],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      expect(result).toContain('fill="#FF0000"');
      expect(result).toContain('fill="#00FF00"');
    });

    it("should handle bounds for viewBox and dimensions", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [{ d: "M0 0L100 0L100 100L0 100Z" }],
        },
      ];

      const result = buildSvgContentFromEntries(entries, { x: 0, y: 0, width: 100, height: 100 });
      expect(result).toContain('width="100"');
      expect(result).toContain('height="100"');
      expect(result).toContain('viewBox="0 0 100 100"');
    });

    it("should handle multiple paths in single entry", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [{ d: "M0 0L10 0" }, { d: "M20 0L30 0" }],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      const pathCount = (result.match(/<path/g) || []).length;
      expect(pathCount).toBe(2);
    });

    it("should handle empty entries array", () => {
      const result = buildSvgContentFromEntries([]);
      expect(result).toContain("<svg");
      expect(result).not.toContain("<path");
    });

    it("should skip entries with no paths", () => {
      const entries: SvgPathEntry[] = [{} as SvgPathEntry];

      const result = buildSvgContentFromEntries(entries);
      expect(result).toContain("<svg");
    });

    it("should handle paths with fillRule attribute", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [{ d: "M0 0L10 0L10 10L0 10Z", fillRule: "evenodd" }],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      expect(result).toContain('fill-rule="evenodd"');
    });

    it("should round coordinates to 4 decimal places", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [{ d: "M0.123456789 0.987654321L10.111111 10.999999" }],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      expect(result).not.toContain("0.123456789");
      expect(result).toContain("0.1235");
    });
  });

  describe("getSvgCacheSize", () => {
    it("should return 0 for empty cache", () => {
      expect(getSvgCacheSize()).toBe(0);
    });
  });
});
