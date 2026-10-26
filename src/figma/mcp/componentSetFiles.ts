import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ComponentSet, DesignTokens, MCPResponse } from "../types";

export const COMPONENT_SET_FOLDER = "component-sets";
export const SET_SPLIT_THRESHOLD_BYTES = 228 * 1024;
const INDEX_FILE = "index.json";
const JSON_EXTENSION = ".json";
const DEFAULT_SET_STEM = "component-set";
const DEFAULT_VARIANT_STEM = "variant";
const UNSAFE_STEM_CHARS = /[^A-Za-z0-9_]+/g;
const EDGE_DASHES = /^-+|-+$/g;

type VariantEntry = ComponentSet["variants"][string];

export type ComponentSetReference = Pick<ComponentSet, "propKeys" | "propValues"> & {
  file: string;
};

export type ExternalizedComponentSets = Omit<MCPResponse, "componentSets"> & {
  componentSets?: Record<string, ComponentSetReference>;
  componentSetsFolder?: string;
};

/**
 * Writes each component set into `<outputDir>/component-sets` and replaces the inline sets with
 * references to those files. A set whose file would exceed the threshold becomes a folder holding
 * an index.json and one file per variant.
 */
export async function externalizeComponentSets(
  response: MCPResponse,
  outputDir: string,
  splitThresholdBytes = SET_SPLIT_THRESHOLD_BYTES,
): Promise<ExternalizedComponentSets> {
  const { componentSets, ...rest } = response;
  if (!componentSets || Object.keys(componentSets).length === 0) return rest;
  const folder = join(outputDir, COMPONENT_SET_FOLDER);
  const stems = buildUniqueStems(Object.keys(componentSets), DEFAULT_SET_STEM);
  await mkdir(folder, { recursive: true });
  const references = await Promise.all(
    Object.entries(componentSets).map(
      async ([name, set]) =>
        [
          name,
          await writeComponentSet(folder, stems[name], set, response.tokens, splitThresholdBytes),
        ] as const,
    ),
  );
  return {
    ...rest,
    componentSets: Object.fromEntries(references),
    componentSetsFolder: folder,
  };
}

export function buildUniqueStems(names: string[], fallbackStem: string): Record<string, string> {
  const takenStems = new Set<string>();
  return Object.fromEntries(
    names.map((name) => [name, reserveStem(sanitizeStem(name, fallbackStem), takenStems)]),
  );
}

async function writeComponentSet(
  folder: string,
  stem: string,
  set: ComponentSet,
  tokens: DesignTokens | undefined,
  splitThresholdBytes: number,
): Promise<ComponentSetReference> {
  const content = serializeWithTokens(set, tokens);
  if (Buffer.byteLength(content) <= splitThresholdBytes) {
    const file = `${stem}${JSON_EXTENSION}`;
    await writeFile(join(folder, file), content, "utf-8");
    return toComponentSetReference(set, file);
  }
  return writeSplitComponentSet(folder, stem, set, tokens);
}

async function writeSplitComponentSet(
  folder: string,
  stem: string,
  set: ComponentSet,
  tokens: DesignTokens | undefined,
): Promise<ComponentSetReference> {
  const setFolder = join(folder, stem);
  const variantFiles = withJsonExtension(
    buildUniqueStems(Object.keys(set.variants), DEFAULT_VARIANT_STEM),
  );
  await mkdir(setFolder, { recursive: true });
  await Promise.all(
    Object.entries(set.variants).map(([id, variant]) =>
      writeFile(join(setFolder, variantFiles[id]), serializeWithTokens(variant, tokens), "utf-8"),
    ),
  );
  const index = buildSetIndex(set, variantFiles);
  await writeFile(join(setFolder, INDEX_FILE), serializeWithTokens(index, tokens), "utf-8");
  return toComponentSetReference(set, `${stem}/${INDEX_FILE}`);
}

function buildSetIndex(set: ComponentSet, variantFiles: Record<string, string>) {
  return {
    name: set.name,
    propKeys: set.propKeys,
    ...(set.propValues ? { propValues: set.propValues } : {}),
    ...(set.base ? { base: set.base } : {}),
    variants: Object.fromEntries(
      Object.entries(set.variants).map(([id, variant]) => [
        id,
        toVariantPointer(variant, variantFiles[id]),
      ]),
    ),
  };
}

function toVariantPointer(variant: VariantEntry, file: string) {
  return { ...(variant.props ? { props: variant.props } : {}), file };
}

function toComponentSetReference(set: ComponentSet, file: string): ComponentSetReference {
  return {
    file,
    propKeys: set.propKeys,
    ...(set.propValues ? { propValues: set.propValues } : {}),
  };
}

function reserveStem(stem: string, takenStems: Set<string>): string {
  let candidate = stem;
  for (let suffix = 2; takenStems.has(candidate.toLowerCase()); suffix += 1) {
    candidate = `${stem}-${suffix}`;
  }
  takenStems.add(candidate.toLowerCase());
  return candidate;
}

function sanitizeStem(name: string, fallbackStem: string): string {
  return name.replace(UNSAFE_STEM_CHARS, "-").replace(EDGE_DASHES, "") || fallbackStem;
}

function withJsonExtension(stems: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(stems).map(([key, stem]) => [key, `${stem}${JSON_EXTENSION}`]),
  );
}

function serializeWithTokens(content: object, tokens: DesignTokens | undefined): string {
  const referencedTokens = pickReferencedTokens(content, tokens);
  const withTokens =
    Object.keys(referencedTokens).length > 0 ? { ...content, tokens: referencedTokens } : content;
  return JSON.stringify(withTokens);
}

/** Keeps only the token entries this content refers to, so its file reads on its own. */
function pickReferencedTokens(
  content: unknown,
  tokens: DesignTokens = {},
): Record<string, Record<string, unknown>> {
  const refs = collectStringValues(content);
  const tokenTables: Record<string, Record<string, unknown> | undefined> = tokens;
  const picked: Record<string, Record<string, unknown>> = {};
  for (const [category, table] of Object.entries(tokenTables)) {
    const entries = Object.entries(table ?? {}).filter(([name]) => refs.has(`${category}.${name}`));
    if (entries.length > 0) picked[category] = Object.fromEntries(entries);
  }
  return picked;
}

function collectStringValues(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === "string") found.add(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStringValues(item, found));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectStringValues(item, found));
  }
  return found;
}
