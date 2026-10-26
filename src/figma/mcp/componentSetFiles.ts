import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseVariantProps } from "../reducer";
import type { ComponentSet, DesignTokens, MCPResponse, V3Node } from "../types";
import { buildPropValues } from "./enrich";

export const COMPONENT_SET_FOLDER = "component-sets";
export const SET_SPLIT_THRESHOLD_BYTES = 228 * 1024;
const COMPONENT_SET_TYPE = "COMPONENT_SET";
const COMPONENT_TYPE = "COMPONENT";
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

/** The root keeps its container fields. When its variants are split, `file` points at their index. */
export type ExternalizedRoot = Omit<V3Node, "children"> & {
  children?: V3Node[];
  file?: string;
  propKeys?: string[];
  propValues?: Record<string, string[]>;
};

export type ExternalizedComponentSets = Omit<MCPResponse, "componentSets" | "root"> & {
  root: ExternalizedRoot;
  componentSets?: Record<string, ComponentSetReference>;
  componentSetsFolder?: string;
};

/**
 * Writes each component set, and the variants of a COMPONENT_SET root, into
 * `<outputDir>/component-sets`. Anything whose file would exceed the threshold becomes a folder
 * holding an index.json and one file per variant.
 */
export async function externalizeComponentSets(
  response: MCPResponse,
  outputDir: string,
  splitThresholdBytes = SET_SPLIT_THRESHOLD_BYTES,
): Promise<ExternalizedComponentSets> {
  const { schema, componentSets = {}, root, ...rest } = response;
  const setNames = Object.keys(componentSets);
  const rootVariants = componentSetRootVariants(root);
  const splitRoot =
    rootVariants !== undefined &&
    Buffer.byteLength(
      serializeWithTokens({ name: root.name, variants: rootVariants }, response.tokens),
    ) > splitThresholdBytes;
  if (setNames.length === 0 && !splitRoot) return { schema, root, ...rest };
  const folder = join(outputDir, COMPONENT_SET_FOLDER);
  const stems = reserveStems(
    [...setNames, ...(splitRoot ? [root.name ?? ""] : [])],
    DEFAULT_SET_STEM,
  );
  await mkdir(folder, { recursive: true });
  const setRefs = await Promise.all(
    setNames.map(
      async (name, index) =>
        [
          name,
          await writeComponentSet(
            folder,
            stems[index],
            componentSets[name],
            response.tokens,
            splitThresholdBytes,
          ),
        ] as const,
    ),
  );
  const externalRoot =
    rootVariants && splitRoot
      ? await writeRootVariants(folder, stems[setNames.length], root, rootVariants, response.tokens)
      : root;
  return {
    schema,
    root: externalRoot,
    ...rest,
    ...(setNames.length > 0 ? { componentSets: Object.fromEntries(setRefs) } : {}),
    componentSetsFolder: folder,
  };
}

/** Unique, filesystem-safe stems in the order of the given names. */
export function reserveStems(names: string[], fallbackStem: string): string[] {
  const takenStems = new Set<string>();
  return names.map((name) => reserveStem(sanitizeStem(name, fallbackStem), takenStems));
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
    const file = withJsonExtension(stem);
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
  const variantIds = Object.keys(set.variants);
  const variantFiles = toVariantFiles(variantIds);
  await mkdir(setFolder, { recursive: true });
  await Promise.all(
    variantIds.map((id) =>
      writeFile(
        join(setFolder, variantFiles[id]),
        serializeWithTokens(set.variants[id], tokens),
        "utf-8",
      ),
    ),
  );
  await writeFile(
    join(setFolder, INDEX_FILE),
    serializeWithTokens(buildSetIndex(set, relativeToComponentSets(stem, variantFiles)), tokens),
    "utf-8",
  );
  return toComponentSetReference(set, `${stem}/${INDEX_FILE}`);
}

async function writeRootVariants(
  folder: string,
  stem: string,
  root: V3Node,
  variants: V3Node[],
  tokens: DesignTokens | undefined,
): Promise<ExternalizedRoot> {
  const setFolder = join(folder, stem);
  const names = variants.map((variant) => variant.name ?? "");
  const variantFiles = toVariantFiles(names);
  const variantRefs = relativeToComponentSets(stem, variantFiles);
  const propValues = buildPropValues(names.map((name) => parseVariantProps(name)));
  const propKeys = Object.keys(propValues);
  await mkdir(setFolder, { recursive: true });
  await Promise.all(
    variants.map((variant, index) =>
      writeFile(
        join(setFolder, variantFiles[names[index]]),
        serializeWithTokens({ props: parseVariantProps(names[index]), ...variant }, tokens),
        "utf-8",
      ),
    ),
  );
  const index = {
    name: root.name,
    propKeys,
    ...(propKeys.length > 0 ? { propValues } : {}),
    variants: Object.fromEntries(
      names.map((name) => [name, { props: parseVariantProps(name), file: variantRefs[name] }]),
    ),
  };
  await writeFile(join(setFolder, INDEX_FILE), serializeWithTokens(index, tokens), "utf-8");
  const container: ExternalizedRoot = { ...root };
  delete container.children;
  return {
    ...container,
    file: `${stem}/${INDEX_FILE}`,
    propKeys,
    ...(propKeys.length > 0 ? { propValues } : {}),
  };
}

function componentSetRootVariants(root: V3Node): V3Node[] | undefined {
  const children = root.children ?? [];
  if (root.type !== COMPONENT_SET_TYPE || children.length === 0) return undefined;
  return children.every((child) => child.type === COMPONENT_TYPE) ? children : undefined;
}

function toVariantFiles(keys: string[]): Record<string, string> {
  const stems = reserveStems(keys, DEFAULT_VARIANT_STEM);
  return Object.fromEntries(keys.map((key, index) => [key, withJsonExtension(stems[index])]));
}

/** References are relative to the component-sets folder, so each variant carries its set folder. */
function relativeToComponentSets(setStem: string, variantFiles: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(variantFiles).map(([key, file]) => [key, `${setStem}/${file}`]),
  );
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

function withJsonExtension(stem: string): string {
  return `${stem}${JSON_EXTENSION}`;
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
