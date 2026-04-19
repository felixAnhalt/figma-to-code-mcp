import { describe, it, expect, beforeEach, vi } from "vitest";
import { getCache, setCache } from "../figma/cache";

describe("cache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns null for missing key", () => {
    expect(getCache("nonexistent")).toBeNull();
  });

  it("returns stored data before TTL expires", () => {
    setCache("key1", { foo: "bar" }, 1000);
    expect(getCache<{ foo: string }>("key1")).toEqual({ foo: "bar" });
  });

  it("returns null after TTL expires and deletes entry", () => {
    setCache("key1", { foo: "bar" }, 1000);

    vi.advanceTimersByTime(999);
    expect(getCache<{ foo: string }>("key1")).toEqual({ foo: "bar" });

    vi.advanceTimersByTime(2);
    expect(getCache("key1")).toBeNull();
  });

  it("stores data with correct timestamp", () => {
    const now = Date.now();
    vi.setSystemTime(now);

    setCache("key1", "value", 5000);

    vi.setSystemTime(now + 3000);
    expect(getCache("key1")).toBe("value");

    vi.setSystemTime(now + 6000);
    expect(getCache("key1")).toBeNull();
  });

  it("handles different TTL values", () => {
    setCache("short", "shortValue", 100);
    setCache("long", "longValue", 10000);

    vi.advanceTimersByTime(50);
    expect(getCache("short")).toBe("shortValue");
    expect(getCache("long")).toBe("longValue");

    vi.advanceTimersByTime(60);
    expect(getCache("short")).toBeNull();
    expect(getCache("long")).toBe("longValue");
  });

  it("stores and retrieves various data types", () => {
    setCache("string", "hello", 1000);
    setCache("number", 42, 1000);
    setCache("array", [1, 2, 3], 1000);
    setCache("object", { nested: { deep: true } }, 1000);
    setCache("null", null, 1000);

    expect(getCache<string>("string")).toBe("hello");
    expect(getCache<number>("number")).toBe(42);
    expect(getCache<number[]>("array")).toEqual([1, 2, 3]);
    expect(getCache<{ nested: { deep: boolean } }>("object")).toEqual({ nested: { deep: true } });
    expect(getCache<null>("null")).toBe(null);
  });
});
