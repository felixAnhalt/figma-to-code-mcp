import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { externalizeRootFrames } from "~/figma/mcp/frameFiles";
import type { DesignTokens, V3Node } from "~/figma/types";

const HOME_FRAME: V3Node = {
  type: "FRAME",
  name: "Home",
  style: { background: "colors.primary" },
  children: [{ type: "TEXT", text: "Hello", style: { color: "colors.white" } }],
};
const SETTINGS_FRAME: V3Node = { type: "FRAME", name: "Settings", layout: { gap: 8 } };
const SECTION: V3Node = {
  type: "SECTION",
  name: "Screens",
  layout: { direction: "column" },
  children: [HOME_FRAME, SETTINGS_FRAME],
};
const TOKENS: DesignTokens = {
  colors: { primary: "#9747FF", white: "#FFFFFF" },
  spacing: { gap: 8 },
};
const SPLIT_THRESHOLD_FOR_TESTS = 100;

function responseWith(root: V3Node, tokens: DesignTokens | undefined = TOKENS) {
  return { root, tokens };
}

async function readJson(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, "utf-8"));
}

async function readYaml(path: string): Promise<Record<string, unknown>> {
  return yaml.load(await readFile(path, "utf-8")) as Record<string, unknown>;
}

let outputDir: string;

beforeEach(async () => {
  outputDir = await mkdtemp(join(tmpdir(), "frame-files-"));
});

afterEach(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

describe("externalizeRootFrames", () => {
  it("writes each frame of a SECTION above the threshold to its own JSON file", async () => {
    const result = await externalizeRootFrames(
      responseWith(SECTION),
      outputDir,
      "json",
      SPLIT_THRESHOLD_FOR_TESTS,
    );
    const folder = join(outputDir, "frames");

    expect(result.framesFolder).toBe(folder);
    expect(result.root).toEqual({
      type: "SECTION",
      name: "Screens",
      layout: { direction: "column" },
      children: [
        { type: "FRAME", name: "Home", file: "Home.json" },
        { type: "FRAME", name: "Settings", file: "Settings.json" },
      ],
    });
    expect(await readJson(join(folder, "Home.json"))).toEqual({
      ...HOME_FRAME,
      tokens: { colors: { primary: "#9747FF", white: "#FFFFFF" } },
    });
  });

  it("keeps only the token entries each frame refers to, so its file reads on its own", async () => {
    await externalizeRootFrames(
      responseWith(SECTION),
      outputDir,
      "json",
      SPLIT_THRESHOLD_FOR_TESTS,
    );

    expect(await readJson(join(outputDir, "frames", "Home.json"))).toMatchObject({
      tokens: { colors: { primary: "#9747FF", white: "#FFFFFF" } },
    });
    expect(await readJson(join(outputDir, "frames", "Settings.json"))).not.toHaveProperty("tokens");
  });

  it("writes YAML frame files and YAML stubs when the output format is yaml", async () => {
    const result = await externalizeRootFrames(
      responseWith(SECTION),
      outputDir,
      "yaml",
      SPLIT_THRESHOLD_FOR_TESTS,
    );

    expect(result.root.children).toEqual([
      { type: "FRAME", name: "Home", file: "Home.yaml" },
      { type: "FRAME", name: "Settings", file: "Settings.yaml" },
    ]);
    expect(await readYaml(join(outputDir, "frames", "Home.yaml"))).toEqual({
      ...HOME_FRAME,
      tokens: { colors: { primary: "#9747FF", white: "#FFFFFF" } },
    });
  });

  it("gives frames with the same name distinct files", async () => {
    const twins = { ...SECTION, children: [HOME_FRAME, { ...HOME_FRAME }] };
    const result = await externalizeRootFrames(
      responseWith(twins),
      outputDir,
      "json",
      SPLIT_THRESHOLD_FOR_TESTS,
    );

    expect(result.root.children).toEqual([
      { type: "FRAME", name: "Home", file: "Home.json" },
      { type: "FRAME", name: "Home", file: "Home-2.json" },
    ]);
  });

  it("keeps a SECTION inline when its frames stay below the threshold", async () => {
    const result = await externalizeRootFrames(responseWith(SECTION), outputDir, "json");

    expect(result.root).toEqual(SECTION);
    expect(result).not.toHaveProperty("framesFolder");
  });

  it("keeps a SECTION inline when it holds anything other than frames", async () => {
    const mixed = { ...SECTION, children: [HOME_FRAME, { type: "TEXT", text: "Note" }] };
    const result = await externalizeRootFrames(
      responseWith(mixed),
      outputDir,
      "json",
      SPLIT_THRESHOLD_FOR_TESTS,
    );

    expect(result.root).toEqual(mixed);
    expect(result).not.toHaveProperty("framesFolder");
  });

  it("keeps the children of a non-SECTION root inline", async () => {
    const frame = { ...SECTION, type: "FRAME" };
    const result = await externalizeRootFrames(
      responseWith(frame),
      outputDir,
      "json",
      SPLIT_THRESHOLD_FOR_TESTS,
    );

    expect(result.root).toEqual(frame);
    expect(result).not.toHaveProperty("framesFolder");
  });
});
