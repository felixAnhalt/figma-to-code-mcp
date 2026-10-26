import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { httpClient } from "~/utils/httpClient";
import { figmaRateLimiter } from "~/utils/figmaRateLimiter";
import { fetchViaCurl } from "~/utils/curlFallback";

vi.mock("~/utils/curlFallback", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/utils/curlFallback")>()),
  fetchViaCurl: vi.fn(),
}));

const FILE_URL = "https://api.figma.com/v1/files/abc";

describe("httpClient curl fallback", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    figmaRateLimiter.reset();
    vi.mocked(fetchViaCurl).mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("retries a GET through curl when fetch fails at the network level", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    vi.mocked(fetchViaCurl).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    const result = await httpClient<{ ok: boolean }>(FILE_URL);

    expect(result).toEqual({ ok: true });
    expect(fetchViaCurl).toHaveBeenCalledTimes(1);
  });

  it("throws the original fetch error when curl fails too", async () => {
    const fetchError = new TypeError("fetch failed");
    fetchMock.mockRejectedValue(fetchError);
    vi.mocked(fetchViaCurl).mockRejectedValue(new Error("curl: (6) Could not resolve host"));

    await expect(httpClient(FILE_URL)).rejects.toBe(fetchError);
  });

  it("does not use curl when fetch gets an HTTP response", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    await httpClient(FILE_URL);

    expect(fetchViaCurl).not.toHaveBeenCalled();
  });

  it("does not use curl for non-GET requests", async () => {
    const fetchError = new TypeError("fetch failed");
    fetchMock.mockRejectedValue(fetchError);

    await expect(httpClient(FILE_URL, { method: "POST" })).rejects.toBe(fetchError);
    expect(fetchViaCurl).not.toHaveBeenCalled();
  });
});
