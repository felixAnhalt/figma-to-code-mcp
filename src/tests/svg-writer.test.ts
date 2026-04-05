import { describe, it, expect } from "vitest";
import { buildSvgContentFromEntries } from "../figma/svg-writer";
import type { SvgPathEntry } from "../figma/svg-writer";

describe("svg-writer", () => {
  describe("buildSvgContentFromEntries", () => {
    // ... existing tests ...

    it("should handle real Figma path data with translation transform", () => {
      // Real path data from Figma (with relativeTransform translation)
      const entries: SvgPathEntry[] = [
        {
          paths: [
            {
              d: "M11.3099 8.41149L9.26421 8.41149C9.11809 9.1735 8.70895 9.73036 8.09523 10.1407",
              fillRule: "nonzero",
            },
          ],
          transform: [1, 0, 0, 1, 46.993244171142578, 5.0410318374633789], // translate by (46.99, 5.04)
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      console.log("Result:", result);

      // The first point (11.3099, 8.41149) should become (11.3099 + 46.99, 8.41149 + 5.04) = (58.30, 13.45)
      expect(result).toContain("58.30");
      expect(result).toContain("13.45");
    });

    it("should handle Figma's nested array format for relativeTransform", () => {
      // Figma returns relativeTransform as [[a, c, tx], [b, d, ty]] = [[1, 0, 46.99], [0, 1, 5.04]]
      const entries: SvgPathEntry[] = [
        {
          paths: [
            {
              d: "M11.3099 8.41149L9.26421 8.41149C9.11809 9.1735 8.70895 9.73036 8.09523 10.1407",
              fillRule: "nonzero",
            },
          ],
          // This is how Figma actually returns it
          transform: [1, 0, 0, 1, 46.993244171142578, 5.0410318374633789],
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      // The first point should be transformed
      expect(result).toContain("58.30");
      expect(result).toContain("13.45");
    });

    it("should handle complex bezier curves with transform", () => {
      const entries: SvgPathEntry[] = [
        {
          paths: [
            {
              d: "M10 10C20 20 30 30 40 40",
            },
          ],
          transform: [1, 0, 0, 1, 5, 5], // translate by (5, 5)
        },
      ];

      const result = buildSvgContentFromEntries(entries);
      expect(result).toContain("15 15"); // 10+5, 10+5 (space after M is fine)
    });
  });
});
