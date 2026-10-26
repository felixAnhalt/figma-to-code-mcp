import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "~/mcp";

it("documents exactly the tools a default MCP client discovers", async () => {
  const readme = await readFile(new URL("../../README.md", import.meta.url), "utf8");
  const toolSection = readme.split("## Available Tools")[1].split("## Required Scopes")[0];
  const documentedNames = [...toolSection.matchAll(/^\|\s*`([a-z_]+)`\s*\|/gm)]
    .map(([, name]) => name)
    .sort();
  const server = await createServer({
    figmaApiKey: "documentation-test",
    figmaOAuthToken: "",
    useOAuth: false,
  });
  const client = new Client({ name: "documentation-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const { tools } = await client.listTools();
    expect(documentedNames).toEqual(tools.map(({ name }) => name).sort());
    const design = tools.find(({ name }) => name === "get_figma_design");
    for (const field of [
      "textRuns",
      "typography",
      "position",
      "borderWidths",
      "gradientHandlePositions",
      "svgViewport",
    ])
      expect(design?.description).toContain(field);
    expect(design?.inputSchema.properties?.includeComponentVariants).toMatchObject({
      type: "boolean",
      default: false,
    });
  } finally {
    await client.close();
    await server.close();
  }
});
