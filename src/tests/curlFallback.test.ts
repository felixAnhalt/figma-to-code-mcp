import { describe, it, expect, vi } from "vitest";
import { fetchViaCurl } from "~/utils/curlFallback";

const FILE_URL = "https://api.figma.com/v1/files/abc";
const STATUS_FORMAT_ARG = "\\n%{http_code}";

describe("fetchViaCurl", () => {
  it("reads the URL and headers from a stdin config so the token stays out of the arguments", async () => {
    const runner = vi.fn(async () => '{"ok":true}\n200');

    await fetchViaCurl(FILE_URL, { headers: { "X-Figma-Token": "secret" } }, runner);

    const [args, config] = runner.mock.calls[0];
    expect(args).toEqual(["-s", "-S", "-L", "-K", "-", "-w", STATUS_FORMAT_ARG]);
    expect(args.join(" ")).not.toContain("secret");
    expect(config).toBe(`url = "${FILE_URL}"\nheader = "X-Figma-Token: secret"\n`);
  });

  it("returns the body and the HTTP status curl reports", async () => {
    const response = await fetchViaCurl(FILE_URL, {}, async () => '{"error":"nope"}\n404');

    expect(response.status).toBe(404);
    expect(response.ok).toBe(false);
    expect(await response.text()).toBe('{"error":"nope"}');
  });

  it("keeps newlines inside the body", async () => {
    const response = await fetchViaCurl(FILE_URL, {}, async () => "line1\nline2\n200");

    expect(await response.text()).toBe("line1\nline2");
  });

  it("throws when curl output has no HTTP status", async () => {
    await expect(fetchViaCurl(FILE_URL, {}, async () => '{"ok":true}')).rejects.toThrow(
      "curl returned no HTTP status",
    );
  });

  it("escapes quotes and backslashes in header values", async () => {
    const runner = vi.fn(async () => "{}\n200");

    await fetchViaCurl(FILE_URL, { headers: { "X-Note": 'a"b\\c' } }, runner);

    expect(runner.mock.calls[0][1]).toContain('header = "X-Note: a\\"b\\\\c"');
  });

  it("does not run curl for non-GET requests", async () => {
    const runner = vi.fn(async () => "{}\n200");

    await expect(fetchViaCurl(FILE_URL, { method: "POST" }, runner)).rejects.toThrow(
      "only supports GET",
    );
    expect(runner).not.toHaveBeenCalled();
  });
});
