import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { vi } from "vitest";
import { startHttpServer, stopHttpServer } from "~/server";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

let started: ReturnType<typeof deferred>;
let completed: ReturnType<typeof deferred>;
let server: McpServer;
let client: Client;
let running: boolean;
let schedule: ReturnType<typeof vi.spyOn<typeof globalThis, "setInterval">>;
let clear: ReturnType<typeof vi.spyOn<typeof globalThis, "clearInterval">>;

beforeEach(async () => {
  started = deferred();
  completed = deferred();
  server = new McpServer({ name: "progress-test", version: "1" });
  server.registerTool("wait", { inputSchema: {} }, async (_params, extra) => {
    started.resolve();
    extra.signal.addEventListener("abort", completed.resolve, { once: true });
    await completed.promise;
    return { content: [{ type: "text", text: "done" }] };
  });
  const http = await startHttpServer("127.0.0.1", 0, server);
  running = true;
  const url = new URL(`http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`);
  client = new Client({ name: "progress-client", version: "1" });
  await client.connect(new StreamableHTTPClientTransport(url));
  schedule = vi.spyOn(globalThis, "setInterval");
  clear = vi.spyOn(globalThis, "clearInterval");
});

afterEach(async () => {
  completed.resolve();
  await client.close();
  if (running) await stopHttpServer();
  vi.restoreAllMocks();
});

function callWaitingTool(progressToken: string | number = 0) {
  const pending = client.callTool({ name: "wait", arguments: {}, _meta: { progressToken } });
  void pending.catch(() => undefined);
  return pending;
}

function progressTimer() {
  const index = schedule.mock.calls.findIndex(([, delay]) => delay === 1000);
  expect(index).toBeGreaterThanOrEqual(0);
  return { callback: schedule.mock.calls[index][0], timer: schedule.mock.results[index].value };
}

describe("HTTP request progress lifecycle", () => {
  it("accepts progressToken zero and clears its timer when the request finishes", async () => {
    const notification = vi.spyOn(server.server, "notification").mockResolvedValue();
    const pending = callWaitingTool();
    await started.promise;
    const { callback, timer } = progressTimer();
    if (typeof callback === "function") await callback();
    expect(notification).toHaveBeenCalledWith({
      method: "notifications/progress",
      params: { progress: 0, progressToken: 0 },
    });
    completed.resolve();
    await pending;
    await vi.waitFor(() => expect(clear).toHaveBeenCalledWith(timer));
  });

  it("handles notification rejection and stops retrying on the failed transport", async () => {
    const notification = vi
      .spyOn(server.server, "notification")
      .mockRejectedValue(new Error("closed"));
    const pending = callWaitingTool("token");
    await started.promise;
    const { callback, timer } = progressTimer();
    if (typeof callback === "function") await callback();
    await vi.waitFor(() => expect(clear).toHaveBeenCalledWith(timer));
    expect(notification).toHaveBeenCalledTimes(1);
    completed.resolve();
    await pending;
  });

  it("clears timers in the request-error path", async () => {
    const original = StreamableHTTPServerTransport.prototype.handleRequest;
    vi.spyOn(StreamableHTTPServerTransport.prototype, "handleRequest").mockImplementation(function (
      this: StreamableHTTPServerTransport,
      req,
      res,
      body,
    ) {
      if (req.method === "POST" && body?.method === "tools/call")
        return Promise.reject(new Error("request failed"));
      return original.call(this, req, res, body);
    });
    await expect(callWaitingTool("error-token")).rejects.toThrow();
    const { timer } = progressTimer();
    expect(clear).toHaveBeenCalledWith(timer);
    await client.ping();
  });

  it("clears a pending request's timer when the HTTP response disconnects", async () => {
    const pending = callWaitingTool("disconnect-token").catch(() => undefined);
    await started.promise;
    const { timer } = progressTimer();
    await client.close();
    await pending;
    await vi.waitFor(() => expect(clear).toHaveBeenCalledWith(timer));
  });

  it("clears timers and preserves SDK shutdown callbacks for active requests", async () => {
    const onclose = vi.fn();
    server.server.onclose = onclose;
    const pending = callWaitingTool("shutdown-token").catch(() => undefined);
    await started.promise;
    const { timer } = progressTimer();
    await stopHttpServer();
    running = false;
    await client.close();
    await pending;
    expect(clear).toHaveBeenCalledWith(timer);
    expect(onclose).toHaveBeenCalledTimes(1);
  });
});
