import type { AddressInfo } from "node:net";
import { setImmediate } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { InitializeRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { vi } from "vitest";
import { createServer } from "~/mcp";
import { startHttpServer, stopHttpServer } from "~/server";
import type { FigmaAuthOptions } from "~/services/figmaConnector";

const DUMMY_AUTH: FigmaAuthOptions = {
  figmaApiKey: "test-key-not-used",
  figmaOAuthToken: "",
  useOAuth: false,
};
const INITIALIZE = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "raw-test", version: "1.0.0" },
  },
};
const JSON_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
};

let baseUrl: string;
let running = false;
let clients: Client[] = [];

async function listen(source: Parameters<typeof startHttpServer>[2]) {
  const server = await startHttpServer("127.0.0.1", 0, source);
  running = true;
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return server;
}

function streamableClient(sessionId?: string) {
  const client = new Client({ name: "streamable-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), { sessionId });
  clients.push(client);
  return { client, transport };
}

function sseClient() {
  const client = new Client({ name: "sse-test", version: "1.0.0" });
  const transport = new SSEClientTransport(new URL(`${baseUrl}/sse`));
  clients.push(client);
  return { client, transport };
}

async function initialize(headers = JSON_HEADERS) {
  return fetch(`${baseUrl}/mcp`, {
    method: "POST",
    headers,
    body: JSON.stringify(INITIALIZE),
  });
}

afterEach(async () => {
  await Promise.allSettled(clients.map((client) => client.close()));
  clients = [];
  if (running) await stopHttpServer();
  running = false;
  vi.restoreAllMocks();
});

describe("HTTP session isolation", () => {
  beforeEach(async () => {
    await listen(await createServer(DUMMY_AUTH, { isHTTP: true }));
  });

  it("supports concurrent Streamable HTTP clients using the existing instance API", async () => {
    const first = streamableClient();
    const second = streamableClient();
    await Promise.all([
      first.client.connect(first.transport),
      second.client.connect(second.transport),
    ]);
    expect(first.transport.sessionId).not.toBe(second.transport.sessionId);
    const results = await Promise.all([first.client.listTools(), second.client.listTools()]);
    expect(results.map(({ tools }) => tools.map(({ name }) => name))).toEqual([
      ["get_figma_design", "get_image_fills", "render_node_images"],
      ["get_figma_design", "get_image_fills", "render_node_images"],
    ]);
  });

  it("supports mixed Streamable HTTP and multiple SSE clients", async () => {
    const streamable = streamableClient();
    const first = sseClient();
    const second = sseClient();
    await Promise.all([
      streamable.client.connect(streamable.transport),
      first.client.connect(first.transport),
      second.client.connect(second.transport),
    ]);
    await first.client.close();
    await Promise.all([streamable.client.listTools(), second.client.listTools()]);
    const replacement = sseClient();
    await replacement.client.connect(replacement.transport);
    expect((await replacement.client.listTools()).tools).toHaveLength(3);
  });

  it("deletes only the terminated session and permits a new session", async () => {
    const first = streamableClient();
    const second = streamableClient();
    await first.client.connect(first.transport);
    await second.client.connect(second.transport);
    const terminatedId = first.transport.sessionId!;
    await first.transport.terminateSession();
    await first.client.close();
    const stale = await fetch(`${baseUrl}/mcp`, { headers: { "mcp-session-id": terminatedId } });
    expect(stale.status).toBe(400);
    await second.client.listTools();
    const replacement = streamableClient();
    await replacement.client.connect(replacement.transport);
    expect(replacement.transport.sessionId).not.toBe(terminatedId);
  });

  it("reconnects to a live Streamable HTTP session after a client disconnect", async () => {
    const first = streamableClient();
    await first.client.connect(first.transport);
    const sessionId = first.transport.sessionId;
    await first.client.close();
    const replacement = streamableClient(sessionId);
    await replacement.client.connect(replacement.transport);
    expect((await replacement.client.listTools()).tools).toHaveLength(3);
    await replacement.transport.terminateSession();
  });

  it.each(["GET", "DELETE"])("rejects %s with an unknown session", async (method) => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method,
      headers: { "mcp-session-id": "missing" },
    });
    expect(response.status).toBe(400);
  });

  it("rejects a non-initialize POST without a session", async () => {
    const response = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(response.status).toBe(400);
  });

  it("rejects messages for an unknown legacy SSE session", async () => {
    const response = await fetch(`${baseUrl}/messages?sessionId=missing`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    expect(response.status).toBe(400);
  });
});

describe("HTTP server ownership", () => {
  it("accepts an asynchronous per-session factory", async () => {
    const factory = vi.fn(async () => createServer(DUMMY_AUTH));
    await listen(factory);
    const first = streamableClient();
    const second = sseClient();
    await Promise.all([
      first.client.connect(first.transport),
      second.client.connect(second.transport),
    ]);
    await Promise.all([first.client.listTools(), second.client.listTools()]);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("rejects concurrent reuse of an external instance without disrupting its owner", async () => {
    const server = new McpServer({ name: "external", version: "1" });
    await listen(server);
    const first = streamableClient();
    await first.client.connect(first.transport);
    const rejected = await initialize();
    expect(rejected.status).toBe(500);
    await rejected.text();
    await first.client.ping();
    await first.transport.terminateSession();
    const replacement = streamableClient();
    await replacement.client.connect(replacement.transport);
    await replacement.client.ping();
  });

  it("cleans a failed initialization before reusing an external server", async () => {
    const server = new McpServer({ name: "external", version: "1" });
    const onclose = vi.fn();
    server.server.onclose = onclose;
    await listen(server);
    const rejected = await initialize({ ...JSON_HEADERS, Accept: "application/json" });
    expect(rejected.status).toBe(406);
    await rejected.text();
    await vi.waitFor(() => expect(onclose).toHaveBeenCalledTimes(1));
    const next = streamableClient();
    await next.client.connect(next.transport);
    await next.client.ping();
  });

  it("cleans a rejected MCP initialize response, not just HTTP initialization errors", async () => {
    const server = new McpServer({ name: "reject-initialize", version: "1" });
    const onclose = vi.fn();
    server.server.onclose = onclose;
    server.server.setRequestHandler(InitializeRequestSchema, async () => {
      throw new Error("initialization rejected");
    });
    await listen(server);
    const response = await initialize();
    expect(await response.text()).toContain("initialization rejected");
    await vi.waitFor(() => expect(onclose).toHaveBeenCalledTimes(1));
    expect(server.server.transport).toBeUndefined();
  });

  it("keeps a deferred successful initialization alive until its response is sent", async () => {
    const server = new McpServer({ name: "deferred-initialize", version: "1" });
    const onclose = vi.fn();
    server.server.onclose = onclose;
    let release!: () => void;
    let signalStarted!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve;
    });
    server.server.setRequestHandler(InitializeRequestSchema, async (request) => {
      signalStarted();
      await ready;
      return {
        protocolVersion: request.params.protocolVersion,
        capabilities: {},
        serverInfo: { name: "deferred-initialize", version: "1" },
      };
    });
    await listen(server);
    const first = streamableClient();
    const connecting = first.client.connect(first.transport);
    void connecting.catch(() => undefined);
    await started;
    try {
      await setImmediate();
      expect(onclose).not.toHaveBeenCalled();
    } finally {
      release();
    }
    await connecting;
    await first.client.ping();
    await first.transport.terminateSession();
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it("cleans up a connection failure and allows the next initialization", async () => {
    const server = new McpServer({ name: "external", version: "1" });
    const connect = vi.spyOn(server, "connect").mockRejectedValueOnce(new Error("connect failed"));
    const close = vi.spyOn(server, "close");
    await listen(server);
    const rejected = await initialize();
    expect(rejected.status).toBe(500);
    await rejected.text();
    expect(close).toHaveBeenCalledTimes(1);
    const next = streamableClient();
    await next.client.connect(next.transport);
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("preserves SDK close callbacks and closes a session only once", async () => {
    const server = new McpServer({ name: "external", version: "1" });
    const onclose = vi.fn();
    server.server.onclose = onclose;
    await listen(server);
    const first = streamableClient();
    await first.client.connect(first.transport);
    const closeServer = vi.spyOn(server, "close");
    await first.transport.terminateSession();
    await stopHttpServer();
    running = false;
    expect(onclose).toHaveBeenCalledTimes(1);
    // DELETE closes the SDK's inner transport; shutdown must not close it a second time.
    expect(closeServer).not.toHaveBeenCalled();
    expect(server.server.transport).toBeUndefined();
  });

  it("shuts down active sessions and can be restarted", async () => {
    await listen(await createServer(DUMMY_AUTH));
    const first = streamableClient();
    const second = sseClient();
    await Promise.all([
      first.client.connect(first.transport),
      second.client.connect(second.transport),
    ]);
    await stopHttpServer();
    running = false;
    await listen(await createServer(DUMMY_AUTH));
    const next = streamableClient();
    await next.client.connect(next.transport);
    expect((await next.client.listTools()).tools).toHaveLength(3);
  });

  it("preserves a legacy SSE SDK close callback exactly once on shutdown", async () => {
    const server = new McpServer({ name: "sse-lifecycle", version: "1" });
    const onclose = vi.fn();
    server.server.onclose = onclose;
    await listen(server);
    const first = sseClient();
    await first.client.connect(first.transport);
    await Promise.all([stopHttpServer(), stopHttpServer()]);
    running = false;
    await stopHttpServer();
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(server.server.transport).toBeUndefined();
  });

  it("cleans a partial legacy SSE startup failure without duplicate SDK callbacks", async () => {
    const server = new McpServer({ name: "partial-sse-start", version: "1" });
    const onclose = vi.fn();
    server.server.onclose = onclose;
    const start = SSEServerTransport.prototype.start;
    vi.spyOn(SSEServerTransport.prototype, "start").mockImplementationOnce(async function (
      this: SSEServerTransport,
    ) {
      await start.call(this);
      throw new Error("SSE startup failed after opening the response");
    });
    await listen(server);
    const response = await fetch(`${baseUrl}/sse`);
    await response.text();
    expect(onclose).toHaveBeenCalledTimes(1);
    expect(server.server.transport).toBeUndefined();
    const next = streamableClient();
    await next.client.connect(next.transport);
    await next.client.ping();
  });

  it("closes a server whose asynchronous factory resolves during shutdown", async () => {
    const server = new McpServer({ name: "delayed-factory", version: "1" });
    const close = vi.spyOn(server, "close");
    let release!: (server: McpServer) => void;
    const ready = new Promise<McpServer>((resolve) => {
      release = resolve;
    });
    const factory = vi.fn(() => ready);
    await listen(factory);
    const response = initialize().catch(() => undefined);
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1));
    const stopped = stopHttpServer();
    release(server);
    await stopped;
    running = false;
    const result = await response;
    if (result) await result.text();
    expect(close).toHaveBeenCalledTimes(1);
    expect(server.server.transport).toBeUndefined();
  });
});
