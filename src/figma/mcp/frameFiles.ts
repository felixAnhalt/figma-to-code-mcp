import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DesignTokens, V3Node } from "../types";
import {
  SPLIT_THRESHOLD_BYTES,
  createFileCodec,
  reserveStems,
  withExtension,
} from "./externalFiles";
import type { FileCodec, OutputFormat } from "./externalFiles";

export const FRAME_FOLDER = "frames";
const SECTION_TYPE = "SECTION";
const FRAME_TYPE = "FRAME";
const DEFAULT_FRAME_STEM = "frame";

export type ExternalizableRoot = Omit<V3Node, "children"> & { children?: V3Node[] };

export type FrameSourceResponse = { root: ExternalizableRoot; tokens?: DesignTokens };

/** A frame left in its root: its name and type, and the file in framesFolder that holds it. */
export type ExternalizedFrameStub = Pick<V3Node, "type" | "name"> & { file: string };

export type FramesExternalizedResponse<T extends FrameSourceResponse> = Omit<T, "root"> & {
  root: ExternalizableRoot;
  framesFolder?: string;
};

/**
 * Writes each frame of a SECTION root into `<outputDir>/frames` when the frames together exceed
 * the threshold, the same rule a COMPONENT_SET root follows for its variants.
 */
export async function externalizeRootFrames<T extends FrameSourceResponse>(
  response: T,
  outputDir: string,
  outputFormat: OutputFormat,
  splitThresholdBytes = SPLIT_THRESHOLD_BYTES,
): Promise<FramesExternalizedResponse<T>> {
  const { root } = response;
  const frames = collectSectionFrameChildren(root);
  if (frames === undefined) return response;
  const codec = createFileCodec(outputFormat, response.tokens);
  if (
    Buffer.byteLength(codec.serialize({ name: root.name, children: frames })) <= splitThresholdBytes
  ) {
    return response;
  }
  const folder = join(outputDir, FRAME_FOLDER);
  const stems = reserveStems(
    frames.map((frame) => frame.name ?? ""),
    DEFAULT_FRAME_STEM,
  );
  await mkdir(folder, { recursive: true });
  const stubs = await Promise.all(
    frames.map((frame, index) => writeFrameFile(folder, stems[index], frame, codec)),
  );
  return { ...response, root: { ...root, children: stubs }, framesFolder: folder };
}

function collectSectionFrameChildren(root: ExternalizableRoot): V3Node[] | undefined {
  const children = root.children ?? [];
  if (root.type !== SECTION_TYPE || children.length === 0) return undefined;
  return children.every((child) => child.type === FRAME_TYPE) ? children : undefined;
}

async function writeFrameFile(
  folder: string,
  stem: string,
  frame: V3Node,
  codec: FileCodec,
): Promise<ExternalizedFrameStub> {
  const file = withExtension(stem, codec);
  await writeFile(join(folder, file), codec.serialize(frame), "utf-8");
  return { type: frame.type, ...(frame.name !== undefined ? { name: frame.name } : {}), file };
}
