import type { ComponentDefinition, MCPResponse, V3Node } from "./types";
import type { VariableResolutionContext } from "./variableResolver";
import { parseVariantProps, resolveChildren } from "./reducer/node";
import { extractInteractions } from "./reducer/interaction";
import { extractVectorPaths } from "./reducer/vector";
import {
  countVectorsInGroupDeep,
  extractVectorEntriesFromChildren,
  extractVectorEntriesFromDeepGroup,
  extractVectorEntriesFromGroupChildren,
} from "./reducer/group";
import { extractLayoutFromNode } from "./reducer/layout";
import { extractStyleFromNode } from "./reducer/style";
import { extractTextStyleFromNode } from "./reducer/text";
import { processPaint } from "./reducer/paint";
import { addPendingVectorWrite, flushAllPendingVectorSvgs } from "./reducer/flush";
import { FigmaRawNode, FigmaRawPaint } from "~/figma/reducer/types";
import type { NodeCommentsMap } from "./transform/comments";

export { parseVariantProps, flushAllPendingVectorSvgs };

export function buildNormalizedGraph(
  rootNode: Record<string, unknown>,
  styleMap: Record<string, unknown>,
  variableContext?: VariableResolutionContext | null,
  componentMap: Record<string, unknown> = {},
  fileKey = "",
  commentsMap: NodeCommentsMap = {},
): MCPResponse & { flushVectorSvgs: () => Promise<void> } {
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

    // ── Layout ───────────────────────────────────────────────────────────────
    const layout = extractLayoutFromNode(node);
    if (layout) v3.layout = layout;

    // ── Style ────────────────────────────────────────────────────────────────
    const style = extractStyleFromNode(node, variableContext);

    // ── Text properties (TEXT nodes only) ──────────────────────────────────
    if (node.type === "TEXT") {
      const textStyle = extractTextStyleFromNode(node);
      if (textStyle && style) {
        Object.assign(style, textStyle);
      }

      if (node.characters) v3.text = node.characters as string;
    }

    if (style && Object.keys(style).length > 0) v3.style = style;

    // ── Vector paths (VECTOR nodes only) ───────────────────────────────────
    const vectorPaths = extractVectorPaths(node);
    if (vectorPaths) {
      // Bounds are now computed from path data in svg-writer.ts (not absolute canvas position)
      addPendingVectorWrite({ fileKey, nodeId: node.id, paths: vectorPaths, target: v3 });
    }

    // ── Interactions ───────────────────────────────────────────────────────
    const extracted = extractInteractions(node as { interactions?: unknown });
    if (extracted) v3.interactions = extracted;

    // ── Comments ───────────────────────────────────────────────────────────────
    const nodeId = node.id;
    if (nodeId && commentsMap[nodeId]) {
      v3.comments = commentsMap[nodeId];
    }

    // ── Annotations ───────────────────────────────────────────────────────────
    const rawAnnotations = node.annotations as Array<{ label: string }> | undefined;
    if (rawAnnotations && rawAnnotations.length > 0) {
      v3.annotations = rawAnnotations.map((a) => a.label);
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

      // Check if this is a vector-only group (all children are VECTOR)
      const isVectorOnlyGroup =
        node.type === "GROUP" && resolved.length > 0 && resolved.every((c) => c.type === "VECTOR");

      // Check if this is a GROUP with vectors at nested depth (not just direct children)
      // This handles groups like: GROUP -> GROUP -> GROUP -> VECTOR
      const isGroupWithNestedVectors =
        node.type === "GROUP" &&
        resolved.length > 0 &&
        !isVectorOnlyGroup &&
        countVectorsInGroupDeep(node) > 1;

      // Check if this is a frame with vector-friendly children
      // Pattern 1: all direct children are VECTORs
      // Pattern 2: all direct children are GROUPs, and each group's children are all VECTORs
      const isFrameWithVectors =
        node.type === "FRAME" && resolved.length > 0 && resolved.every((c) => c.type === "VECTOR");
      const isFrameWithGroups =
        node.type === "FRAME" &&
        resolved.length > 0 &&
        resolved.every((c) => c.type === "GROUP") &&
        resolved.every((g) => {
          const groupChildren = resolveChildren((g as FigmaRawNode).children ?? []);
          return groupChildren.length > 0 && groupChildren.every((c) => c.type === "VECTOR");
        });

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
        if (isVectorOnlyGroup && visible.length > 1) {
          const rawBounds = node.absoluteBoundingBox as
            | { width: number; height: number }
            | undefined;
          const groupBounds = rawBounds
            ? { x: 0, y: 0, width: rawBounds.width, height: rawBounds.height }
            : undefined;

          const entries = extractVectorEntriesFromChildren(visible);

          if (entries.length > 0) {
            v3.children = [{ type: "VECTOR" as const, name: visible[0].name }];
            addPendingVectorWrite({
              fileKey,
              nodeId: node.id,
              paths: [],
              target: v3.children[0],
              entries,
              bounds: groupBounds,
            });
          } else {
            v3.children = visible.map((child) => processNode(child));
          }
        } else if (isGroupWithNestedVectors) {
          const rawBounds = node.absoluteBoundingBox as
            | { x: number; y: number; width: number; height: number }
            | undefined;
          const groupBounds = rawBounds
            ? { x: 0, y: 0, width: rawBounds.width, height: rawBounds.height }
            : undefined;

          const entries = extractVectorEntriesFromDeepGroup(node);

          if (entries.length > 1) {
            v3.children = [{ type: "VECTOR" as const, name: node.name }];
            addPendingVectorWrite({
              fileKey,
              nodeId: node.id,
              paths: [],
              target: v3.children[0],
              entries,
              bounds: groupBounds,
            });
          } else if (entries.length === 1) {
            v3.children = visible.map((child) => processNode(child));
          } else {
            v3.children = visible.map((child) => processNode(child));
          }
        } else if ((isFrameWithVectors || isFrameWithGroups) && visible.length > 1) {
          const rawFrameBounds = node.absoluteBoundingBox as
            | { x: number; y: number; width: number; height: number }
            | undefined;
          const frameBounds = rawFrameBounds
            ? { x: 0, y: 0, width: rawFrameBounds.width, height: rawFrameBounds.height }
            : undefined;

          const entries = isFrameWithVectors
            ? extractVectorEntriesFromChildren(visible)
            : extractVectorEntriesFromGroupChildren(visible as FigmaRawNode[], {
                x: rawFrameBounds?.x ?? 0,
                y: rawFrameBounds?.y ?? 0,
                width: rawFrameBounds?.width ?? 0,
                height: rawFrameBounds?.height ?? 0,
              });

          if (entries.length > 0) {
            v3.children = [{ type: "VECTOR" as const, name: visible[0].name }];
            addPendingVectorWrite({
              fileKey,
              nodeId: node.id,
              paths: [],
              target: v3.children[0],
              entries,
              bounds: frameBounds,
            });
          } else {
            v3.children = visible.map((child) => processNode(child));
          }
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

  /**
   * Returns a flush function that performs a no-op. The actual flushing of all
   * accumulated vectors happens via flushAllPendingVectorSvgs() at the end of
   * buildNormalizedDesignTree, after all enrichment is complete.
   * This allows vectors collected across Pass 1 and Pass 2 to all accumulate
   * before any writes occur.
   */
  async function flushVectorSvgs(): Promise<void> {
    // No-op. Actual flushing happens at the end via flushAllPendingVectorSvgs().
  }

  return { ...response, flushVectorSvgs };
}
