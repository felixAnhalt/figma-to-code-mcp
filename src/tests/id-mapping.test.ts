import { describe, it, expect, beforeEach } from "vitest";
import { IdMapper } from "~/figma/idMapper.js";

describe("IdMapper", () => {
  let mapper: IdMapper;

  beforeEach(() => {
    mapper = new IdMapper();
  });

  describe("Root IDs (no semicolons)", () => {
    it("should keep root IDs unchanged", () => {
      expect(mapper.map("4014:2428")).toBe("4014:2428");
      expect(mapper.map("123:456")).toBe("123:456");
      expect(mapper.map("0:1")).toBe("0:1");
    });

    it("should not increment counter for root IDs", () => {
      mapper.map("4014:2428");
      mapper.map("123:456");
      expect(mapper.getCounter()).toBe(0);
    });
  });

  describe("Nested IDs (with semicolons)", () => {
    it("should map nested IDs keeping first segment", () => {
      const result = mapper.map("I4014:2428;27011:30191");
      expect(result).toBe("I4014:2428;0");
    });

    it("should map deeply nested IDs keeping only first segment", () => {
      const result = mapper.map("I4014:2428;27011:30191;3614:74");
      expect(result).toBe("I4014:2428;0");
    });

    it("should use global counter across different parents", () => {
      expect(mapper.map("I4014:2428;27011:30191")).toBe("I4014:2428;0");
      expect(mapper.map("I4014:2428;27011:30192")).toBe("I4014:2428;1");
      expect(mapper.map("I4014:2429;27011:30191")).toBe("I4014:2429;2");
      expect(mapper.map("I4014:2429;27011:30192")).toBe("I4014:2429;3");
    });

    it("should cache and reuse mappings", () => {
      const id = "I4014:2428;27011:30191;3614:74";

      const first = mapper.map(id);
      const second = mapper.map(id);

      expect(first).toBe(second);
      expect(first).toBe("I4014:2428;0");
      expect(mapper.getCounter()).toBe(1); // Only incremented once
    });

    it("should increment counter for each unique nested ID", () => {
      mapper.map("I4014:2428;27011:30191");
      mapper.map("I4014:2428;27011:30192");
      mapper.map("I4014:2429;27011:30193");

      expect(mapper.getCounter()).toBe(3);
    });
  });

  describe("Mixed IDs", () => {
    it("should handle mix of root and nested IDs correctly", () => {
      expect(mapper.map("4014:2428")).toBe("4014:2428");
      expect(mapper.map("I4014:2428;27011:30191")).toBe("I4014:2428;0");
      expect(mapper.map("123:456")).toBe("123:456");
      expect(mapper.map("I123:456;789:012")).toBe("I123:456;1");

      expect(mapper.getCounter()).toBe(2);
    });
  });

  describe("Reset", () => {
    it("should reset counter and cache", () => {
      mapper.map("I4014:2428;27011:30191");
      mapper.map("I4014:2428;27011:30192");
      expect(mapper.getCounter()).toBe(2);

      mapper.reset();

      expect(mapper.getCounter()).toBe(0);
      expect(mapper.map("I4014:2428;27011:30191")).toBe("I4014:2428;0");
    });
  });

  describe("Edge cases", () => {
    it("should handle IDs with 'I' prefix without semicolon", () => {
      // These are treated as root IDs
      expect(mapper.map("I4014:2428")).toBe("I4014:2428");
      expect(mapper.getCounter()).toBe(0);
    });

    it("should handle multiple semicolons correctly", () => {
      const id = "I4014:2428;27011:30191;3614:74;999:888";
      expect(mapper.map(id)).toBe("I4014:2428;0");
    });

    it("should handle different first segments", () => {
      expect(mapper.map("I1:1;2:2")).toBe("I1:1;0");
      expect(mapper.map("I99:99;2:2")).toBe("I99:99;1");
      expect(mapper.map("I1000:2000;3:3")).toBe("I1000:2000;2");
    });
  });
});
