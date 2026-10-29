import yaml from "js-yaml";
import type { DesignTokens } from "../types";

export type OutputFormat = "yaml" | "json";

/** How an externalized file is named and serialized. Matches the format of the response. */
export type FileCodec = {
  extension: string;
  serialize: (content: object) => string;
};

export const SPLIT_THRESHOLD_BYTES = 228 * 1024;
const EXTENSION_BY_FORMAT = { yaml: ".yaml", json: ".json" } as const;
/** skipInvalid matches JSON.stringify, which drops undefined values instead of failing. */
const YAML_DUMP_OPTIONS = { skipInvalid: true } as const;
const UNSAFE_STEM_CHARS = /[^A-Za-z0-9_]+/g;
const EDGE_DASHES = /^-+|-+$/g;

/** Unique, filesystem-safe stems in the order of the given names. */
export function reserveStems(names: string[], fallbackStem: string): string[] {
  const takenStems = new Set<string>();
  return names.map((name) => reserveStem(sanitizeStem(name, fallbackStem), takenStems));
}

/** Each file keeps only the token entries it refers to, so it reads on its own. */
export function createFileCodec(
  outputFormat: OutputFormat,
  tokens: DesignTokens | undefined,
): FileCodec {
  return {
    extension: EXTENSION_BY_FORMAT[outputFormat],
    serialize: (content) => serializeInFormat(withReferencedTokens(content, tokens), outputFormat),
  };
}

export function withExtension(stem: string, codec: FileCodec): string {
  return `${stem}${codec.extension}`;
}

function serializeInFormat(content: object, outputFormat: OutputFormat): string {
  return outputFormat === "json" ? JSON.stringify(content) : yaml.dump(content, YAML_DUMP_OPTIONS);
}

function withReferencedTokens(content: object, tokens: DesignTokens | undefined): object {
  const referencedTokens = pickReferencedTokens(content, tokens);
  return Object.keys(referencedTokens).length > 0
    ? { ...content, tokens: referencedTokens }
    : content;
}

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
