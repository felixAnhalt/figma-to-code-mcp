import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseVariantProps } from "../reducer";
import type { ComponentSet, MCPResponse, V3Node } from "../types";
import { buildPropValues } from "./enrich";
import {
  SPLIT_THRESHOLD_BYTES,
  createFileCodec,
  reserveStems,
  withExtension,
} from "./externalFiles";
import type { FileCodec, OutputFormat } from "./externalFiles";

export const COMPONENT_SET_FOLDER = "component-sets";
const COMPONENT_SET_TYPE = "COMPONENT_SET";
const COMPONENT_TYPE = "COMPONENT";
const INDEX_STEM = "index";
const DEFAULT_SET_STEM = "component-set";
const DEFAULT_VARIANT_STEM = "variant";

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
 * holding an index file and one file per variant.
 */
export async function externalizeComponentSets(
  response: MCPResponse,
  outputDir: string,
  outputFormat: OutputFormat,
  splitThresholdBytes = SPLIT_THRESHOLD_BYTES,
): Promise<ExternalizedComponentSets> {
  const { schema, componentSets = {}, root, ...rest } = response;
  const setNames = Object.keys(componentSets);
  const rootVariants = componentSetRootVariants(root);
  const codec = createFileCodec(outputFormat, response.tokens);
  const splitRoot =
    rootVariants !== undefined &&
    Buffer.byteLength(codec.serialize({ name: root.name, variants: rootVariants })) >
      splitThresholdBytes;
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
            codec,
            splitThresholdBytes,
          ),
        ] as const,
    ),
  );
  const externalRoot =
    rootVariants && splitRoot
      ? await writeRootVariants(folder, stems[setNames.length], root, rootVariants, codec)
      : root;
  return {
    schema,
    root: externalRoot,
    ...rest,
    ...(setNames.length > 0 ? { componentSets: Object.fromEntries(setRefs) } : {}),
    componentSetsFolder: folder,
  };
}

async function writeComponentSet(
  folder: string,
  stem: string,
  set: ComponentSet,
  codec: FileCodec,
  splitThresholdBytes: number,
): Promise<ComponentSetReference> {
  const content = codec.serialize(set);
  if (Buffer.byteLength(content) <= splitThresholdBytes) {
    const file = withExtension(stem, codec);
    await writeFile(join(folder, file), content, "utf-8");
    return toComponentSetReference(set, file);
  }
  return writeSplitComponentSet(folder, stem, set, codec);
}

async function writeSplitComponentSet(
  folder: string,
  stem: string,
  set: ComponentSet,
  codec: FileCodec,
): Promise<ComponentSetReference> {
  const setFolder = join(folder, stem);
  const variantIds = Object.keys(set.variants);
  const variantFiles = toVariantFiles(variantIds, codec);
  const indexFile = withExtension(INDEX_STEM, codec);
  await mkdir(setFolder, { recursive: true });
  await Promise.all(
    variantIds.map((id) =>
      writeFile(join(setFolder, variantFiles[id]), codec.serialize(set.variants[id]), "utf-8"),
    ),
  );
  await writeFile(
    join(setFolder, indexFile),
    codec.serialize(buildSetIndex(set, relativeToComponentSets(stem, variantFiles))),
    "utf-8",
  );
  return toComponentSetReference(set, `${stem}/${indexFile}`);
}

async function writeRootVariants(
  folder: string,
  stem: string,
  root: V3Node,
  variants: V3Node[],
  codec: FileCodec,
): Promise<ExternalizedRoot> {
  const setFolder = join(folder, stem);
  const names = variants.map((variant) => variant.name ?? "");
  const variantFiles = toVariantFiles(names, codec);
  const variantRefs = relativeToComponentSets(stem, variantFiles);
  const propValues = buildPropValues(names.map((name) => parseVariantProps(name)));
  const propKeys = Object.keys(propValues);
  const indexFile = withExtension(INDEX_STEM, codec);
  await mkdir(setFolder, { recursive: true });
  await Promise.all(
    variants.map((variant, index) =>
      writeFile(
        join(setFolder, variantFiles[names[index]]),
        codec.serialize({ props: parseVariantProps(names[index]), ...variant }),
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
  await writeFile(join(setFolder, indexFile), codec.serialize(index), "utf-8");
  const container: ExternalizedRoot = { ...root };
  delete container.children;
  return {
    ...container,
    file: `${stem}/${indexFile}`,
    propKeys,
    ...(propKeys.length > 0 ? { propValues } : {}),
  };
}

function componentSetRootVariants(root: V3Node): V3Node[] | undefined {
  const children = root.children ?? [];
  if (root.type !== COMPONENT_SET_TYPE || children.length === 0) return undefined;
  return children.every((child) => child.type === COMPONENT_TYPE) ? children : undefined;
}

function toVariantFiles(keys: string[], codec: FileCodec): Record<string, string> {
  const stems = reserveStems(keys, DEFAULT_VARIANT_STEM);
  return Object.fromEntries(keys.map((key, index) => [key, withExtension(stems[index], codec)]));
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
