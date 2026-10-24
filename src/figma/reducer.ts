import type { ComponentDefinition, MCPResponse, V3Node, FigmaAnnotation } from "./types";
import type { VariableResolutionContext } from "./variableResolver";
import { parseVariantProps, resolveChildren, extractComponentProperties } from "./reducer/node";
import { extractInteractions } from "./reducer/interaction";
import { extractVectorPaths } from "./reducer/vector";
import { getVectorMerge } from "./reducer/group";
import { extractLayoutFromNode } from "./reducer/layout";
import { extractStyleFromNode } from "./reducer/style";
import { extractTextStyleFromNode } from "./reducer/text";
import { processPaint } from "./reducer/paint";
import {
  addPendingVectorWrite,
  flushAllPendingVectorSvgs,
  type PendingVectorWriteInput,
} from "./reducer/flush";
import type { FigmaRawNode, FigmaRawPaint } from "~/figma/reducer/types";
import type { NodeCommentsMap } from "./transform/comments";

export { parseVariantProps, flushAllPendingVectorSvgs };

export function buildNormalizedGraph(
  rootNode: Record<string, unknown>,
  styleMap: Record<string, unknown>,
  variableContext?: VariableResolutionContext | null,
  componentMap: Record<string, unknown> = {},
  fileKey = "",
  commentsMap: NodeCommentsMap = {},
  pendingVectors: PendingVectorWriteInput[] = [],
): MCPResponse & { flushVectorSvgs: (outputDir?: string) => Promise<void> } {
  const definitions: Record<string, ComponentDefinition> = {};

  // styleMap is accepted for API compatibility but styles come directly from node properties.
  void styleMap;

  /**
   * Builds a V3Node from a raw Figma node.
   * Children are processed recursively; hidden nodes and their subtrees are skipped.
   * Mutates `definitions` to register component metadata when INSTANCE nodes are encountered.
   */
  function processNode(node: FigmaRawNode): V3Node {
    const v3: V3Node = {
      type: node.type,
      name: node.name,
    };

    // TEXT nodes: drop name when it equals the text content — pure noise
    if (node.type === "TEXT" && node.name === node.characters) {
      delete v3.name;
    }

    // INSTANCE nodes carry their id so the LLM can correlate with definitions
    if (node.type === "INSTANCE") {
      v3.id = node.id;
    }

    // ── Component properties (INSTANCE nodes) ────────────────────────────────
    const componentProps = extractComponentProperties(node);
    if (componentProps) v3.props = componentProps;

    // ── Layout ───────────────────────────────────────────────────────────────
    const layout = extractLayoutFromNode(node, variableContext);
    if (layout) v3.layout = layout;

    // ── Style ────────────────────────────────────────────────────────────────
    const style = extractStyleFromNode(node, variableContext) ?? {};

    // ── Text properties (TEXT nodes only) ──────────────────────────────────
    if (node.type === "TEXT") {
      const textStyle = extractTextStyleFromNode(node);
      if (textStyle) {
        Object.assign(style, textStyle);
      }

      if (node.characters) v3.text = node.characters as string;
    }

    if (style && Object.keys(style).length > 0) v3.style = style;

    // ── Vector paths (VECTOR nodes only) ───────────────────────────────────
    const vectorPaths = extractVectorPaths(node);
    if (vectorPaths) {
      // Bounds are now computed from path data in svg-writer.ts (not absolute canvas position)
      addPendingVectorWrite(
        { fileKey, nodeId: node.id, paths: vectorPaths, target: v3 },
        pendingVectors,
      );
    }

    // ── Interactions ───────────────────────────────────────────────────────
    const extracted = extractInteractions(node as { interactions?: unknown });
    if (extracted) v3.interactions = extracted;

    // ── Comments ───────────────────────────────────────────────────────────────
    const nodeId = node.id;
    if (nodeId && commentsMap[nodeId]) {
      v3.comments = commentsMap[nodeId];
    }

    // ── Annotations ─────────────────────────────────────────────────────────────
    const rawAnnotations = (node as Record<string, unknown>).annotations;
    if (Array.isArray(rawAnnotations)) {
      if (rawAnnotations.length > 0) {
        const safeAnnotations: FigmaAnnotation[] = rawAnnotations.map((annotation) => {
          // Preserve all annotation fields, including any future extensions
          const safe: FigmaAnnotation = {};
          if (typeof annotation.label !== "undefined") safe.label = annotation.label as string;
          if (typeof annotation.labelMarkdown !== "undefined")
            safe.labelMarkdown = annotation.labelMarkdown as string;
          if (typeof annotation.categoryId !== "undefined")
            safe.categoryId = annotation.categoryId as string;
          if (Array.isArray(annotation.properties)) {
            safe.properties = (annotation.properties as Array<{ type: string }>).map((prop) => ({
              type: prop.type as string,
            }));
          }
          return safe;
        });
        v3.annotations = safeAnnotations;
      } else {
        // Preserve empty annotation array
        v3.annotations = [];
      }
    }

    // ── Component reference (INSTANCE nodes) ───────────────────────────────
    if (node.type === "INSTANCE" && node.componentId) {
      const componentId = node.componentId as string;
      v3.component = componentId;

      if (!definitions[componentId]) {
        const meta = componentMap[componentId] as
          | { key?: string; name?: string; description?: string }
          | undefined;
        const def: ComponentDefinition = {
          name: meta?.name ?? node.name ?? "Unknown Component",
        };
        if (meta?.description) def.description = meta.description;
        definitions[componentId] = def;
      }
    }

    // ── Children ───────────────────────────────────────────────────────────
    if (node.children && node.children.length > 0) {
      const resolved = resolveChildren(node.children);

      // Compute this node's fill string for RECTANGLE suppression in children
      const thisFill = style && typeof style.background === "string" ? style.background : undefined;

      const visible = resolved.filter((child): child is FigmaRawNode => {
        // Suppress RECTANGLE nodes whose fill is identical to this node's fill —
        // they are purely decorative background layers that carry no extra information.
        if (!child || child.type !== "RECTANGLE" || thisFill === undefined) return true;
        const childFills = child.fills as FigmaRawPaint[] | undefined;
        if (!childFills || childFills.length === 0) return true;
        const childFill = processPaint(childFills[0], variableContext);
        return childFill !== thisFill;
      });

      if (visible.length > 0) {
        const merged = getVectorMerge(node, visible);
        if (merged) {
          const target: V3Node = { type: "VECTOR", name: merged.name };
          v3.children = [target];
          addPendingVectorWrite(
            {
              fileKey,
              nodeId: node.id,
              paths: [],
              target,
              entries: merged.entries,
              bounds: merged.bounds,
            },
            pendingVectors,
          );
        } else {
          v3.children = visible.map((child) => processNode(child));
        }
      }
    }

    return v3;
  }

  // ── Entry point ───────────────────────────────────────────────────────────

  // The Figma nodes endpoint wraps the node under a `document` key.
  const rootDocument = rootNode.document as FigmaRawNode | undefined;
  const rootSelf = rootNode as FigmaRawNode;
  const root = processNode(rootDocument ?? rootSelf);

  const response: MCPResponse = {
    schema: "v3",
    root,
  };

  if (Object.keys(definitions).length > 0) {
    response.definitions = definitions;
  }

  async function flushVectorSvgs(outputDir = ""): Promise<void> {
    await flushAllPendingVectorSvgs(outputDir, pendingVectors);
  }

  return { ...response, flushVectorSvgs };
}
