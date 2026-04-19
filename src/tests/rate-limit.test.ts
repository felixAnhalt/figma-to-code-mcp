import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { safeFetch } from "../figma/rateLimit";

describe("rateLimit", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("rate limiting", () => {
    it("serializes requests with 100ms minimum interval", async () => {
      const timestamps: number[] = [];

      fetchMock.mockImplementation(async () => {
        timestamps.push(Date.now());
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      const promises = Array.from({ length: 3 }, () => safeFetch("https://api.figma.com/v1/test"));

      await Promise.all(promises);

      for (let i = 1; i < timestamps.length; i++) {
        const diff = timestamps[i] - timestamps[i - 1];
        expect(diff).toBeGreaterThanOrEqual(90);
      }
    });

    it("does not wait before first request", async () => {
      const start = Date.now();

      fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      await safeFetch("https://api.figma.com/v1/test");
      const elapsed = Date.now() - start;

      expect(elapsed).toBeLessThan(150);
    });
  });

  describe("429 retry logic", () => {
    it("retries on 429 status", async () => {
      let attempt = 0;
      fetchMock.mockImplementation(async () => {
        attempt++;
        if (attempt < 3) {
          return new Response(null, { status: 429, headers: { "Retry-After": "0" } });
        }
        return new Response(JSON.stringify({ success: true }), { status: 200 });
      });

      const result = await safeFetch("https://api.figma.com/v1/test");
      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("respects Retry-After header", async () => {
      let attempt = 0;
      fetchMock.mockImplementation(async () => {
        attempt++;
        if (attempt < 2) {
          return new Response(null, { status: 429, headers: { "Retry-After": "0.05" } });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      const start = Date.now();
      await safeFetch("https://api.figma.com/v1/test");
      const elapsed = Date.now() - start;

      expect(elapsed).toBeGreaterThanOrEqual(45);
    });

    it("uses exponential backoff when no Retry-After header", async () => {
      let attempt = 0;
      const attemptTimes: number[] = [];

      fetchMock.mockImplementation(async () => {
        attemptTimes.push(Date.now());
        attempt++;
        if (attempt < 4) {
          return new Response(null, { status: 429 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      });

      await safeFetch("https://api.figma.com/v1/test");

      const delays = [attemptTimes[1] - attemptTimes[0], attemptTimes[2] - attemptTimes[1]];

      expect(delays[0]).toBeGreaterThanOrEqual(900);
      expect(delays[1]).toBeGreaterThanOrEqual(delays[0]);
    });

    it("returns response after MAX_RETRIES exhausted", async () => {
      fetchMock.mockResolvedValue(
        new Response(null, { status: 429, headers: { "Retry-After": "0" } }),
      );

      const result = await safeFetch("https://api.figma.com/v1/test");
      expect(result.status).toBe(429);
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });
  });

  describe("successful responses", () => {
    it("returns response on first success", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: "test" }), { status: 200 }));

      const result = await safeFetch("https://api.figma.com/v1/test");
      expect(result.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("passes headers to fetch", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      await safeFetch("https://api.figma.com/v1/test", {
        headers: { "X-Custom": "header" },
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.figma.com/v1/test",
        expect.objectContaining({
          headers: { "X-Custom": "header" },
        }),
      );
    });

    it("passes body to fetch", async () => {
      fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      await safeFetch("https://api.figma.com/v1/test", {
        method: "POST",
        body: JSON.stringify({ key: "value" }),
      });

      expect(fetchMock).toHaveBeenCalledWith(
        "https://api.figma.com/v1/test",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ key: "value" }),
        }),
      );
    });
  });

  describe("non-429 errors", () => {
    it("returns response on 404", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 404 }));

      const result = await safeFetch("https://api.figma.com/v1/test");
      expect(result.status).toBe(404);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("returns response on 500", async () => {
      fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

      const result = await safeFetch("https://api.figma.com/v1/test");
      expect(result.status).toBe(500);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });
});
