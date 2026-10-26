import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { externalizeComponentSets, reserveStems } from "~/figma/mcp/componentSetFiles";
import type { ComponentSet, DesignTokens, MCPResponse, V3Node } from "~/figma/types";

const BUTTON_SET: ComponentSet = {
  name: "Button",
  propKeys: ["size"],
  propValues: { size: ["lg", "sm"] },
  base: { style: { background: "colors.primary" } },
  variants: {
    "1:1": { props: { size: "sm" } },
    "1:2": { props: { size: "lg" } },
  },
};
const ICON_SET: ComponentSet = { name: "Icon / Search", propKeys: [], variants: {} };
const CARD_SET: ComponentSet = {
  name: "Card",
  propKeys: ["size"],
  propValues: { size: ["lg", "sm"] },
  base: { style: { background: "colors.primary" } },
  variants: {
    "1:1": { props: { size: "sm" }, style: { radius: "radius.md" } },
    "1:2": { props: { size: "lg" }, style: { background: "colors.white" } },
  },
};
const CHAT_ROOT: V3Node = {
  type: "COMPONENT_SET",
  name: "Chat",
  layout: { direction: "column" },
  children: [
    { type: "COMPONENT", name: "Size=sm", style: { background: "colors.primary" } },
    { type: "COMPONENT", name: "Size=lg", style: { background: "colors.white" } },
  ],
};
const TOKENS: DesignTokens = {
  colors: { primary: "#9747FF", white: "#FFFFFF" },
  radius: { md: 8 },
};
const SPLIT_THRESHOLD_FOR_TESTS = 100;

function responseWith(
  componentSets: Record<string, ComponentSet>,
  tokens?: MCPResponse["tokens"],
  root: V3Node = { type: "FRAME" },
): MCPResponse {
  return { schema: "v3", root, componentSets, tokens };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf-8"));
}

let outputDir: string;

beforeEach(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "component-set-files-"));
});

afterEach(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

describe("externalizeComponentSets", () => {
  it("writes each set to its own JSON file and indexes it by name without its variants", async () => {
    const result = await externalizeComponentSets(
      responseWith({ Button: BUTTON_SET, "Icon / Search": ICON_SET }),
      outputDir,
    );
    const folder = join(outputDir, "component-sets");

    expect(result.componentSetsFolder).toBe(folder);
    expect(result.componentSets).toEqual({
      Button: { file: "Button.json", propKeys: ["size"], propValues: { size: ["lg", "sm"] } },
      "Icon / Search": { file: "Icon-Search.json", propKeys: [] },
    });
    expect(await readJson(join(folder, "Button.json"))).toEqual(BUTTON_SET);
  });

  it("keeps only the token entries each set refers to, so its file reads on its own", async () => {
    await externalizeComponentSets(responseWith({ Button: BUTTON_SET }, TOKENS), outputDir);

    const written = await readJson(join(outputDir, "component-sets", "Button.json"));
    expect(written.tokens).toEqual({ colors: { primary: "#9747FF" } });
  });

  it("splits a set above the threshold into an index and one file per variant", async () => {
    const result = await externalizeComponentSets(
      responseWith({ Card: CARD_SET }, TOKENS),
      outputDir,
      SPLIT_THRESHOLD_FOR_TESTS,
    );
    const setFolder = join(outputDir, "component-sets", "Card");

    expect(result.componentSets!.Card).toEqual({
      file: "Card/index.json",
      propKeys: ["size"],
      propValues: { size: ["lg", "sm"] },
    });
    expect(await readJson(join(setFolder, "index.json"))).toEqual({
      name: "Card",
      propKeys: ["size"],
      propValues: { size: ["lg", "sm"] },
      base: CARD_SET.base,
      tokens: { colors: { primary: "#9747FF" } },
      variants: {
        "1:1": { props: { size: "sm" }, file: "Card/1-1.json" },
        "1:2": { props: { size: "lg" }, file: "Card/1-2.json" },
      },
    });
    expect(await readJson(join(setFolder, "1-1.json"))).toEqual({
      props: { size: "sm" },
      style: { radius: "radius.md" },
      tokens: { radius: { md: 8 } },
    });
    expect(await readJson(join(setFolder, "1-2.json"))).toEqual({
      props: { size: "lg" },
      style: { background: "colors.white" },
      tokens: { colors: { white: "#FFFFFF" } },
    });
  });

  it("leaves a response without component sets or split root variants unchanged", async () => {
    const result = await externalizeComponentSets(responseWith({}), outputDir);

    expect(result).not.toHaveProperty("componentSets");
    expect(result).not.toHaveProperty("componentSetsFolder");
  });

  it("splits a COMPONENT_SET root above the threshold into an index and one file per variant", async () => {
    const result = await externalizeComponentSets(
      responseWith({}, TOKENS, CHAT_ROOT),
      outputDir,
      SPLIT_THRESHOLD_FOR_TESTS,
    );
    const setFolder = join(outputDir, "component-sets", "Chat");

    expect(result.root).toEqual({
      type: "COMPONENT_SET",
      name: "Chat",
      layout: { direction: "column" },
      file: "Chat/index.json",
      propKeys: ["size"],
      propValues: { size: ["lg", "sm"] },
    });
    expect(await readJson(join(setFolder, "index.json"))).toEqual({
      name: "Chat",
      propKeys: ["size"],
      propValues: { size: ["lg", "sm"] },
      variants: {
        "Size=sm": { props: { size: "sm" }, file: "Chat/Size-sm.json" },
        "Size=lg": { props: { size: "lg" }, file: "Chat/Size-lg.json" },
      },
    });
    expect(await readJson(join(setFolder, "Size-sm.json"))).toEqual({
      props: { size: "sm" },
      type: "COMPONENT",
      name: "Size=sm",
      style: { background: "colors.primary" },
      tokens: { colors: { primary: "#9747FF" } },
    });
  });

  it("keeps a COMPONENT_SET root's variants inline below the threshold", async () => {
    const result = await externalizeComponentSets(
      responseWith({}, undefined, CHAT_ROOT),
      outputDir,
    );

    expect(result.root.children).toEqual(CHAT_ROOT.children);
    expect(result.root).not.toHaveProperty("file");
    expect(result).not.toHaveProperty("componentSetsFolder");
  });

  it("gives a set and a split root with the same name separate folders", async () => {
    const result = await externalizeComponentSets(
      responseWith({ Chat: { ...BUTTON_SET, name: "Chat" } }, TOKENS, CHAT_ROOT),
      outputDir,
      SPLIT_THRESHOLD_FOR_TESTS,
    );

    expect(result.componentSets!.Chat.file).toBe("Chat/index.json");
    expect(result.root.file).toBe("Chat-2/index.json");
  });
});

describe("reserveStems", () => {
  it("gives every name a distinct, filesystem-safe stem", () => {
    expect(
      reserveStems(["Button", "button", "Icon / Search", "Icon - Search", "!!!"], "component-set"),
    ).toEqual(["Button", "button-2", "Icon-Search", "Icon-Search-2", "component-set"]);
  });

  it("keeps variant stems distinct when node ids sanitize to the same stem", () => {
    expect(reserveStems(["1:1", "1-1"], "variant")).toEqual(["1-1", "1-1-2"]);
  });
});
