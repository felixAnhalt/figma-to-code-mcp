import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  isInitializeRequest,
  isJSONRPCErrorResponse,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
} from "@modelcontextprotocol/sdk/types.js";
import express, { type Request, type Response } from "express";
import { getServerConfig } from "~/config";
import { createServerFactory, getSiblingServerFactory, type McpServerFactory } from "~/mcp";
import { Logger } from "~/utils/logger";

const PROGRESS_INTERVAL_MS = 1000;
const TRANSPORT_ERROR_CODE = -32000;
type HttpTransport = StreamableHTTPServerTransport | SSEServerTransport;
type HttpServerSource = McpServer | McpServerFactory;

type HttpSession = {
  server: McpServer;
  transport: HttpTransport;
  stopProgress: Set<() => void>;
  disposed: boolean;
  transportClosed: boolean;
};

type HttpRuntime = {
  factory: McpServerFactory;
  server?: Server;
  stopping: boolean;
  stopPromise?: Promise<void>;
  sessions: Set<HttpSession>;
  leasedServers: Set<McpServer>;
  pending: Set<Promise<HttpSession>>;
  streamable: Map<string, HttpSession>;
  sse: Map<string, HttpSession>;
};

let httpRuntime: HttpRuntime | null = null;

/** Start the MCP server in either stdio or HTTP mode. */
export async function startServer(): Promise<void> {
  const isStdioMode = process.env.NODE_ENV === "cli" || process.argv.includes("--stdio");
  const config = getServerConfig(isStdioMode);
  const factory = await createServerFactory(config.auth, {
    isHTTP: !isStdioMode,
    outputFormat: config.outputFormat,
    skipImageDownloads: config.skipImageDownloads,
    svgOutputDir: config.svgOutputDir,
    libraryFileKeys: config.libraryFileKeys,
    libraryCacheOptions:
      config.libraryFileKeys.length > 0
        ? {
            cachePath: config.libraryCachePath,
            ttlMs: config.libraryCacheTtlMs,
            forceRefresh: config.forceRefreshLibraryCache,
          }
        : undefined,
  });
  if (isStdioMode) {
    await (await factory()).connect(new StdioServerTransport());
    return;
  }
  await startHttpServer(config.host, config.port, factory);
  process.on("SIGINT", async () => {
    Logger.log("Shutting down server...");
    await stopHttpServer();
    process.exit(0);
  });
}

function resolveServerFactory(source: HttpServerSource): McpServerFactory {
  if (typeof source === "function") return source;
  const siblingFactory = getSiblingServerFactory(source);
  let initial: McpServer | undefined = source;
  return () => {
    if (!initial) return siblingFactory ? siblingFactory() : source;
    const server = initial;
    initial = undefined;
    return server;
  };
}

function createRuntime(source: HttpServerSource): HttpRuntime {
  return {
    factory: resolveServerFactory(source),
    stopping: false,
    sessions: new Set(),
    leasedServers: new Set(),
    pending: new Set(),
    streamable: new Map(),
    sse: new Map(),
  };
}

/** Instances created by createServer carry a prepared sibling factory for concurrent clients. */
export async function startHttpServer(
  host: string,
  port: number,
  source: HttpServerSource,
): Promise<Server> {
  if (httpRuntime) throw new Error("HTTP server is already running");
  const runtime = createRuntime(source);
  const app = createHttpApp(runtime);
  httpRuntime = runtime;
  return new Promise<Server>((resolve, reject) => {
    const server = app.listen(port, host, () => {
      Logger.log(`HTTP server listening on ${host}:${port}`);
      resolve(server);
    });
    runtime.server = server;
    server.once("error", reject);
  }).catch((error: unknown) => {
    if (httpRuntime === runtime) httpRuntime = null;
    throw error;
  });
}

function createHttpApp(runtime: HttpRuntime) {
  const app = express();
  // The legacy SSE transport consumes the raw message body itself.
  app.use("/mcp", express.json());
  app.post("/mcp", (req, res) => void handleStreamablePost(runtime, req, res));
  app.get("/mcp", (req, res) => void handleSessionRequest(runtime, req, res));
  app.delete("/mcp", (req, res) => void handleSessionRequest(runtime, req, res));
  app.get("/sse", (req, res) => void handleSseConnection(runtime, req, res));
  app.post("/messages", (req, res) => void handleSseMessage(runtime, req, res));
  return app;
}

function sendTransportError(res: Response, status: number, message: string) {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  res.status(status).json({
    jsonrpc: "2.0",
    error: { code: TRANSPORT_ERROR_CODE, message },
    id: null,
  });
}

function releaseSession(runtime: HttpRuntime, session: HttpSession) {
  if (session.disposed) return;
  session.disposed = true;
  for (const stop of session.stopProgress) stop();
  const sessionId = session.transport.sessionId;
  if (sessionId) {
    if (runtime.streamable.get(sessionId) === session) runtime.streamable.delete(sessionId);
    if (runtime.sse.get(sessionId) === session) runtime.sse.delete(sessionId);
  }
  runtime.sessions.delete(session);
  runtime.leasedServers.delete(session.server);
}

async function closeSession(runtime: HttpRuntime, session: HttpSession) {
  if (session.disposed) return;
  releaseSession(runtime, session);
  const ownsTransport = session.server.server.transport === session.transport;
  try {
    await session.server.close();
  } catch (error) {
    Logger.warn(
      "Error closing MCP server:",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (!ownsTransport && !session.transportClosed) await closeUnusedTransport(session.transport);
  }
}

async function closeUnusedTransport(transport: HttpTransport) {
  try {
    await transport.close();
  } catch (error) {
    Logger.warn("Error closing transport:", error instanceof Error ? error.message : String(error));
  }
}

async function reserveSession(runtime: HttpRuntime, transport: HttpTransport, res: Response) {
  const server = await runtime.factory();
  if (runtime.leasedServers.has(server) || server.server.transport) {
    throw new Error("Server transport conflict: provide a factory for concurrent clients");
  }
  const session: HttpSession = {
    server,
    transport,
    stopProgress: new Set(),
    disposed: false,
    transportClosed: false,
  };
  runtime.sessions.add(session);
  runtime.leasedServers.add(server);
  transport.onclose = () => {
    session.transportClosed = true;
    releaseSession(runtime, session);
  };
  res.once("close", () => {
    if (transport instanceof SSEServerTransport || !res.writableFinished)
      void closeSession(runtime, session);
  });
  return session;
}

function preserveCloseCallback(session: HttpSession) {
  // Compose with the SDK callback, including its request cancellation and Protocol cleanup.
  const onclose = session.transport.onclose;
  session.transport.onclose = () => {
    if (session.transportClosed) return;
    session.transportClosed = true;
    onclose?.();
  };
}

async function connectSessionServer(session: HttpSession) {
  try {
    await session.server.connect(session.transport);
  } finally {
    // connect can fail after the SDK has installed callbacks and opened an SSE response.
    preserveCloseCallback(session);
  }
}

async function acquireSession(runtime: HttpRuntime, transport: HttpTransport, res: Response) {
  let session: HttpSession | undefined;
  try {
    session = await reserveSession(runtime, transport, res);
    if (runtime.stopping || res.destroyed) throw new Error("HTTP connection closed");
    await connectSessionServer(session);
    if (session.disposed || runtime.stopping || res.destroyed)
      throw new Error("HTTP connection closed");
    return session;
  } catch (error) {
    if (session) await closeSession(runtime, session);
    else await closeUnusedTransport(transport);
    throw error;
  }
}

async function connectSession(runtime: HttpRuntime, transport: HttpTransport, res: Response) {
  if (runtime.stopping) throw new Error("HTTP server is shutting down");
  const pending = acquireSession(runtime, transport, res);
  runtime.pending.add(pending);
  try {
    return await pending;
  } finally {
    runtime.pending.delete(pending);
  }
}

async function initializeStreamableSession(
  runtime: HttpRuntime,
  res: Response,
  requestId: string | number,
) {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID });
  const session = await connectSession(runtime, transport, res);
  const send = transport.send.bind(transport);
  // A transport gets its ID before the protocol accepts initialize. Publish only a successful reply.
  transport.send = async (message, options) => {
    const isResponse = isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message);
    if (!isResponse || message.id !== requestId) return send(message, options);
    transport.send = send;
    await send(message, options);
    if (isJSONRPCResultResponse(message) && transport.sessionId && !session.disposed) {
      runtime.streamable.set(transport.sessionId, session);
    }
  };
  return session;
}

async function resolvePostSession(runtime: HttpRuntime, req: Request, res: Response) {
  if (runtime.stopping) {
    sendTransportError(res, 503, "HTTP server is shutting down");
    return;
  }
  const sessionId = req.get("mcp-session-id");
  if (sessionId && runtime.streamable.has(sessionId)) return runtime.streamable.get(sessionId);
  if (!sessionId && isInitializeRequest(req.body) && isJSONRPCRequest(req.body)) {
    return initializeStreamableSession(runtime, res, req.body.id);
  }
  sendTransportError(res, 400, "Bad Request: No valid session ID provided");
}

async function handleStreamablePost(runtime: HttpRuntime, req: Request, res: Response) {
  let session: HttpSession | undefined;
  const initializing = !req.get("mcp-session-id");
  try {
    session = await resolvePostSession(runtime, req, res);
    if (!session) return;
    await handleStreamableRequest(session, req, res);
  } catch (error) {
    Logger.warn(
      "Streamable HTTP request failed:",
      error instanceof Error ? error.message : String(error),
    );
    sendTransportError(res, 500, "Server transport conflict or request failure");
  } finally {
    if (initializing && session && !runtime.streamable.has(session.transport.sessionId ?? ""))
      await closeSession(runtime, session);
  }
}

async function handleStreamableRequest(session: HttpSession, req: Request, res: Response) {
  const stop = startRequestProgress(session, req, res);
  try {
    await (session.transport as StreamableHTTPServerTransport).handleRequest(req, res, req.body);
  } finally {
    stop();
  }
}

async function sendRequestProgress(
  session: HttpSession,
  progressToken: string | number,
  progress: number,
  stop: () => void,
) {
  try {
    await session.server.server.notification({
      method: "notifications/progress",
      params: { progress, progressToken },
    });
  } catch (error) {
    Logger.warn(
      "Progress notification failed:",
      error instanceof Error ? error.message : String(error),
    );
    stop();
  }
}

function startRequestProgress(session: HttpSession, req: Request, res: Response) {
  const progressToken: unknown = req.body?.params?._meta?.progressToken;
  if (typeof progressToken !== "string" && typeof progressToken !== "number") return () => {};
  let stopped = false;
  let progress = 0;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    session.stopProgress.delete(stop);
    res.off("close", stop);
    req.off("aborted", stop);
  };
  const timer = setInterval(
    () => sendRequestProgress(session, progressToken, progress++, stop),
    PROGRESS_INTERVAL_MS,
  );
  session.stopProgress.add(stop);
  res.once("close", stop);
  req.once("aborted", stop);
  return stop;
}

async function handleSessionRequest(runtime: HttpRuntime, req: Request, res: Response) {
  const session = runtime.streamable.get(req.get("mcp-session-id") ?? "");
  if (!session) {
    res.status(400).send("Invalid or missing session ID");
    return;
  }
  try {
    await (session.transport as StreamableHTTPServerTransport).handleRequest(req, res);
  } catch (error) {
    Logger.warn("Session request failed:", error instanceof Error ? error.message : String(error));
    sendTransportError(res, 500, "Error processing session request");
  }
}

async function handleSseConnection(runtime: HttpRuntime, _req: Request, res: Response) {
  try {
    const session = await connectSession(runtime, new SSEServerTransport("/messages", res), res);
    if (!session.disposed) runtime.sse.set(session.transport.sessionId!, session);
  } catch (error) {
    Logger.warn("SSE connection failed:", error instanceof Error ? error.message : String(error));
    sendTransportError(res, 500, "Failed to establish SSE connection");
  }
}

async function handleSseMessage(runtime: HttpRuntime, req: Request, res: Response) {
  const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : "";
  const session = runtime.sse.get(sessionId);
  if (!session) {
    res.status(400).send(`No transport found for sessionId ${sessionId}`);
    return;
  }
  try {
    await (session.transport as SSEServerTransport).handlePostMessage(req, res);
  } catch (error) {
    Logger.warn("SSE message failed:", error instanceof Error ? error.message : String(error));
    sendTransportError(res, 500, "Error processing SSE message");
  }
}

async function shutdownRuntime(runtime: HttpRuntime) {
  runtime.stopping = true;
  const closed = new Promise<void>((resolve, reject) => {
    runtime.server!.close((error) => (error ? reject(error) : resolve()));
  });
  try {
    await Promise.allSettled([...runtime.pending]);
    await Promise.all([...runtime.sessions].map((session) => closeSession(runtime, session)));
    runtime.server!.closeAllConnections?.();
    await closed;
  } finally {
    if (httpRuntime === runtime) httpRuntime = null;
  }
}

export async function stopHttpServer(): Promise<void> {
  const runtime = httpRuntime;
  if (!runtime) return;
  runtime.stopPromise ??= shutdownRuntime(runtime);
  return runtime.stopPromise;
}
