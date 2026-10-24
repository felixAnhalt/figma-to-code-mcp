import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { vi } from "vitest";
import * as mcp from "~/mcp";
import * as figmaFetch from "~/figma/fetch";

const AUTH = { figmaApiKey: "unused", figmaOAuthToken: "", useOAuth: false };

async function listToolNames(server: McpServer) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "tool-discovery", version: "1" });
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    return (await client.listTools()).tools.map(({ name }) => name).sort();
  } finally {
    await client.close();
    await server.close();
  }
}

afterEach(() => vi.restoreAllMocks());

describe("runtime MCP tool discovery", () => {
  it("exposes exactly the three supported tools, without obsolete vector registration", async () => {
    expect(await listToolNames(await mcp.createServer(AUTH))).toEqual([
      "get_figma_design",
      "get_image_fills",
      "render_node_images",
    ]);
  });

  it("exposes only the design tool when image downloads are skipped", async () => {
    expect(await listToolNames(await mcp.createServer(AUTH, { skipImageDownloads: true }))).toEqual(
      ["get_figma_design"],
    );
  });

  it("prepares library configuration once and creates independently configured siblings", async () => {
    const fetchVariables = vi.spyOn(figmaFetch, "fetchVariables").mockResolvedValue(null);
    const factory = await mcp.createServerFactory(AUTH, {
      skipImageDownloads: true,
      libraryFileKeys: ["library"],
    });
    const first = await factory();
    const second = await factory();
    expect(first).not.toBe(second);
    expect(await Promise.all([listToolNames(first), listToolNames(second)])).toEqual([
      ["get_figma_design"],
      ["get_figma_design"],
    ]);
    expect(fetchVariables).toHaveBeenCalledTimes(1);
  });
});

describe("node stdio runtime tool discovery", () => {
  it.each([
    { flags: [], names: ["get_figma_design", "get_image_fills", "render_node_images"] },
    { flags: ["--skip-image-downloads"], names: ["get_figma_design"] },
  ])("lists exactly the supported tools with flags $flags", async ({ flags, names }) => {
    const client = new Client({ name: "node-stdio-discovery", version: "1" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "src/bin.ts", "--stdio", "--figma-api-key=unused", ...flags],
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
      expect((await client.listTools()).tools.map(({ name }) => name).sort()).toEqual(names);
    } finally {
      await client.close();
    }
  });
});
