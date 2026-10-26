import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildUniqueStems, externalizeComponentSets } from "~/figma/mcp/componentSetFiles";
import type { ComponentSet, DesignTokens, MCPResponse } from "~/figma/types";

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
const TOKENS: DesignTokens = {
  colors: { primary: "#9747FF", white: "#FFFFFF" },
  radius: { md: 8 },
};
const SPLIT_THRESHOLD_FOR_TESTS = 100;

function responseWith(
  componentSets: Record<string, ComponentSet>,
  tokens?: MCPResponse["tokens"],
): MCPResponse {
  return { schema: "v3", root: { type: "FRAME" }, componentSets, tokens };
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
        "1:1": { props: { size: "sm" }, file: "1-1.json" },
        "1:2": { props: { size: "lg" }, file: "1-2.json" },
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

  it("leaves a response without component sets unchanged", async () => {
    const result = await externalizeComponentSets(responseWith({}), outputDir);

    expect(result).not.toHaveProperty("componentSets");
    expect(result).not.toHaveProperty("componentSetsFolder");
  });
});

describe("buildUniqueStems", () => {
  it("gives every name a distinct, filesystem-safe stem", () => {
    expect(
      buildUniqueStems(
        ["Button", "button", "Icon / Search", "Icon - Search", "!!!"],
        "component-set",
      ),
    ).toEqual({
      Button: "Button",
      button: "button-2",
      "Icon / Search": "Icon-Search",
      "Icon - Search": "Icon-Search-2",
      "!!!": "component-set",
    });
  });

  it("keeps variant stems distinct when node ids sanitize to the same stem", () => {
    expect(buildUniqueStems(["1:1", "1-1"], "variant")).toEqual({
      "1:1": "1-1",
      "1-1": "1-1-2",
    });
  });
});
