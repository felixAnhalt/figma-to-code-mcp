import type {
  ComponentDefinition,
  Layout,
  MCPResponse,
  PendingVectorWrite,
  Style,
  V3Node,
} from "./types";
import type { VariableResolutionContext } from "./variableResolver";
import {
  buildSvgContentFromEntries,
  getSvgContentFromCache,
  svgContentCache,
  writeMergedVectorSvgToDisk,
  writeVectorSvg,
  writeVectorSvgToDisk,
} from "./svg-writer";
import { formatColor, mapAlignItems, mapJustifyContent, roundTo } from "./reducer/utils";
import { parseVariantProps, resolveChildren } from "./reducer/node";
import { extractInteractions } from "./reducer/interaction";
import { extractVectorPaths } from "./reducer/vector";
import {
  countVectorsInGroupDeep,
  extractVectorEntriesFromChildren,
  extractVectorEntriesFromDeepGroup,
  extractVectorEntriesFromGroupChildren,
} from "./reducer/group";
import { processPaint } from "./reducer/paint";
import { FigmaRawNode, FigmaRawPaint, FigmaEffect } from "~/figma/reducer/types";

export { parseVariantProps };

const globalPendingVectorWrites: PendingVectorWrite[] = [];

export function buildNormalizedGraph(
  rootNode: Record<string, unknown>,
  styleMap: Record<string, unknown>,
  variableContext?: VariableResolutionContext | null,
  componentMap: Record<string, unknown> = {},
  fileKey = "",
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

    // ── Layout sub-object ──────────────────────────────────────────────────
    const layout: Layout = {};

    if (node.layoutMode) {
      layout.direction = node.layoutMode === "HORIZONTAL" ? "row" : "column";

      // Suppress "stretch" (align-items default) and "flex-start" (justify-content default)
      const align = mapAlignItems(
        typeof node.counterAxisAlignItems === "string" ? node.counterAxisAlignItems : undefined,
      );
      if (align !== "stretch") layout.align = align;

      const justify = mapJustifyContent(
        typeof node.primaryAxisAlignItems === "string" ? node.primaryAxisAlignItems : undefined,
      );
      if (justify !== "flex-start") layout.justify = justify;

      const gap =
        node.itemSpacing !== undefined && node.itemSpacing !== 0
          ? (node.itemSpacing as number)
          : undefined;
      if (gap !== undefined) layout.gap = gap;

      const paddingLeft = (node.paddingLeft as number | undefined) ?? 0;
      const paddingRight = (node.paddingRight as number | undefined) ?? 0;
      const paddingTop = (node.paddingTop as number | undefined) ?? 0;
      const paddingBottom = (node.paddingBottom as number | undefined) ?? 0;
      if (paddingLeft || paddingRight || paddingTop || paddingBottom) {
        // CSS shorthand: single value if all equal, [v, h] for two-axis symmetry, full object otherwise
        if (
          paddingTop === paddingRight &&
          paddingRight === paddingBottom &&
          paddingBottom === paddingLeft
        ) {
          layout.padding = paddingTop;
        } else if (paddingTop === paddingBottom && paddingLeft === paddingRight) {
          layout.padding = [paddingTop, paddingRight];
        } else {
          layout.padding = {
            top: paddingTop,
            right: paddingRight,
            bottom: paddingBottom,
            left: paddingLeft,
          };
        }
      }

      if (node.layoutWrap === "WRAP") layout.wrap = true;
    }

    if (node.clipsContent === true) layout.overflow = "hidden";

    const size = node.size as { x?: number; y?: number } | undefined;
    if (size?.x !== undefined && node.layoutSizingHorizontal === "FIXED") {
      layout.width = `${roundTo(size.x, 2)}px`;
    }
    if (size?.y !== undefined && node.layoutSizingVertical === "FIXED") {
      layout.height = `${roundTo(size.y, 2)}px`;
    }
    if (node.minWidth !== undefined && node.minWidth !== null) {
      layout.minWidth = `${roundTo(node.minWidth as number, 2)}px`;
    }
    if (node.maxWidth !== undefined && node.maxWidth !== null) {
      layout.maxWidth = `${roundTo(node.maxWidth as number, 2)}px`;
    }
    if (node.minHeight !== undefined && node.minHeight !== null) {
      layout.minHeight = `${roundTo(node.minHeight as number, 2)}px`;
    }
    if (node.maxHeight !== undefined && node.maxHeight !== null) {
      layout.maxHeight = `${roundTo(node.maxHeight as number, 2)}px`;
    }

    // Sizing mode: emit CSS values so LLMs can directly use them
    // FILL → "100%", HUG → "fit-content", FIXED → explicit width/height above
    if (node.layoutSizingHorizontal === "FILL") layout.width = "100%";
    else if (node.layoutSizingHorizontal === "HUG") layout.width = "fit-content";
    if (node.layoutSizingVertical === "FILL") layout.height = "100%";
    else if (node.layoutSizingVertical === "HUG") layout.height = "fit-content";

    // layoutGrow: 1 means the node stretches along the parent's main axis (flex-grow: 1)
    if (node.layoutGrow === 1) layout.grow = true;

    if (Object.keys(layout).length > 0) v3.layout = layout;

    // ── Style sub-object ───────────────────────────────────────────────────
    const style: Style = {};

    const fills = node.fills as FigmaRawPaint[] | undefined;
    if (fills && fills.length > 0) {
      const processed = processPaint(fills[0], variableContext);
      if (node.type === "TEXT") {
        // Text fill → color only, never background
        if (typeof processed === "string") style.color = processed;
      } else {
        if (typeof processed === "string") style.background = processed;
        else if (processed) style.background = [processed];
      }
    }

    const strokes = node.strokes as FigmaRawPaint[] | undefined;
    if (strokes && strokes.length > 0) {
      const processed = processPaint(strokes[0], variableContext);
      if (typeof processed === "string") style.border = processed;
      if (node.strokeWeight !== undefined && node.strokeWeight !== 0) {
        style.borderWidth = node.strokeWeight as number;
      }
    }

    // Border radius
    const rectangleCornerRadii = node.rectangleCornerRadii as number[] | undefined;
    if (rectangleCornerRadii) {
      const allSame = rectangleCornerRadii.every((r) => r === rectangleCornerRadii[0]);
      if (allSame && rectangleCornerRadii[0] !== 0) {
        style.radius = rectangleCornerRadii[0];
      } else if (!allSame) {
        style.radius = rectangleCornerRadii;
      }
    } else if (node.cornerRadius !== undefined && node.cornerRadius !== 0) {
      style.radius = node.cornerRadius as number;
    }

    // Effects
    const effects = node.effects as FigmaEffect[] | undefined;
    if (effects && effects.length > 0) {
      const shadows = effects
        .filter(
          (e) => (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") && e.visible !== false,
        )
        .map((e) => {
          const color = formatColor(e.color);
          const x = e.offset?.x ?? 0;
          const y = e.offset?.y ?? 0;
          const blur = e.radius ?? 0;
          const spread = e.spread ?? 0;
          const inset = e.type === "INNER_SHADOW" ? " inset" : "";
          return `${x}px ${y}px ${blur}px ${spread}px ${color}${inset}`;
        });
      if (shadows.length > 0) style.shadow = shadows.join(", ");

      const layerBlur = effects.find((e) => e.type === "LAYER_BLUR" && e.visible !== false);
      if (layerBlur) style.blur = `blur(${layerBlur.radius ?? 0}px)`;
    }

    if (node.opacity !== undefined && node.opacity !== 1) {
      style.opacity = roundTo(node.opacity as number, 3);
    }

    // Rotation — suppressed when zero after conversion to degrees
    if (node.rotation !== undefined && node.rotation !== 0) {
      const degrees = roundTo(((node.rotation as number) * 180) / Math.PI, 2);
      if (degrees !== 0) {
        style.transform = `rotate(${degrees}deg)`;
      }
    }

    if (node.blendMode && node.blendMode !== "NORMAL" && node.blendMode !== "PASS_THROUGH") {
      style.blend = node.blendMode as string;
    }

    // ── Text properties (TEXT nodes only) ──────────────────────────────────
    if (node.type === "TEXT") {
      const s = (node.style ?? {}) as Record<string, unknown>;
      const fontName = node.fontName as { family?: string; style?: string } | undefined;

      if (s.fontFamily || fontName?.family) {
        style.font = (s.fontFamily ?? fontName?.family) as string;
      }
      if (s.fontSize || node.fontSize) {
        style.fontSize = (s.fontSize ?? node.fontSize) as number;
      }
      if (s.fontWeight || node.fontWeight) {
        style.fontWeight = (s.fontWeight ?? node.fontWeight) as number;
      }
      const fontStyleStr = (s.fontStyle ?? fontName?.style) as string | undefined;
      if (fontStyleStr?.toLowerCase().includes("italic")) {
        style.fontStyle = "italic";
      }
      if (s.lineHeightPx) {
        style.lineHeight = roundTo(s.lineHeightPx as number, 2);
      } else if (s.lineHeightPercent) {
        style.lineHeight = `${roundTo(s.lineHeightPercent as number, 0)}%`;
      }
      if (s.letterSpacing) {
        style.letterSpacing = roundTo(s.letterSpacing as number, 2);
      }
      if (s.textAlignHorizontal) {
        style.textAlign = (s.textAlignHorizontal as string).toLowerCase();
      }
      if (s.textDecoration && s.textDecoration !== "NONE") {
        style.textDecoration = (s.textDecoration as string).toLowerCase().replace("_", "-");
      }
      if (s.textCase && s.textCase !== "ORIGINAL") {
        const caseMap: Record<string, string> = {
          UPPER: "uppercase",
          LOWER: "lowercase",
          TITLE: "capitalize",
        };
        style.textTransform = caseMap[s.textCase as string] ?? (s.textCase as string).toLowerCase();
      }

      if (node.characters) v3.text = node.characters as string;
    }

    if (Object.keys(style).length > 0) v3.style = style;

    // ── Vector paths (VECTOR nodes only) ───────────────────────────────────
    const vectorPaths = extractVectorPaths(node);
    if (vectorPaths) {
      // Bounds are now computed from path data in svg-writer.ts (not absolute canvas position)
      globalPendingVectorWrites.push({ fileKey, nodeId: node.id, paths: vectorPaths, target: v3 });
    }

    // ── Interactions ───────────────────────────────────────────────────────
    const extracted = extractInteractions(node as { interactions?: unknown });
    if (extracted) v3.interactions = extracted;

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
      const thisFill = typeof style.background === "string" ? style.background : undefined;

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
            globalPendingVectorWrites.push({
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
            globalPendingVectorWrites.push({
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
            globalPendingVectorWrites.push({
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

// ── Module-level flush for all accumulated vectors ────────────────────────────

/**
 * Flushes all accumulated VECTOR SVG writes to disk and assigns svgPathInAssetFolder
 * on each target node. Call this once at the end of buildNormalizedDesignTree,
 * after Pass 1 + Pass 2 enrichment is complete.
 *
 * Each write's target is a V3Node from either Pass 1 or Pass 2. By deferring
 * the flush until after all graph construction is done, we ensure all
 * svgPathInAssetFolder assignments persist in the final response.
 *
 * @param outputDir - Absolute path to the directory where SVG files should be saved.
 *                    If empty, only writes to in-memory cache (no disk write).
 */
export async function flushAllPendingVectorSvgs(outputDir: string): Promise<void> {
  await Promise.all(
    globalPendingVectorWrites.map(async ({ fileKey, nodeId, paths, target, entries, bounds }) => {
      const safeNodeId = nodeId.replace(/[:/\\]/g, "_");

      // Handle merged SVG (vector groups) - when entries is provided
      if (entries && entries.length > 0) {
        // Write merged SVG to in-memory cache
        const mergedContent = buildSvgContentFromEntries(entries, bounds);
        const cacheKey = `${fileKey}_${safeNodeId}`;
        svgContentCache.set(cacheKey, mergedContent);

        // Set the relative path on target (single child)
        const fileName = `${fileKey}_${safeNodeId}.svg`;
        target.svgPathInAssetFolder = fileName;

        // Write to disk if outputDir is provided
        if (outputDir) {
          await writeMergedVectorSvgToDisk(outputDir, fileKey, nodeId, entries, bounds);
        }

        return;
      }

      // Regular vector write (individual vectors)
      // First write to in-memory cache (needed for MCP resource resolution)
      const uri = await writeVectorSvg(fileKey, nodeId, paths);
      if (!uri) return;

      // Always set the relative path (even if outputDir is empty, for backwards compatibility)
      const fileName = `${fileKey}_${safeNodeId}.svg`;
      target.svgPathInAssetFolder = fileName;

      // If outputDir is provided, also write to disk
      if (outputDir) {
        // Get the content from cache
        const cacheKey = `${fileKey}_${safeNodeId}`;
        const content = getSvgContentFromCache(cacheKey);
        if (!content) return;

        // Write to disk
        await writeVectorSvgToDisk(outputDir, fileKey, nodeId, content);
      }
    }),
  );
  // Clear the global accumulator after flushing so subsequent calls don't re-flush.
  globalPendingVectorWrites.length = 0;
}
