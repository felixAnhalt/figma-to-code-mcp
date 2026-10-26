import type { SvgBounds } from "~/figma/svg/cache";
import type { VariableResolutionContext } from "~/figma/variableResolver";
import { Logger } from "~/utils/logger";
import type { FigmaVectorNetwork, FigmaGeometry, FigmaRawNode, FigmaRawPaint } from "./types";
import { processPaint } from "./paint";
import { roundTo } from "./utils";

/** Figma geometry is node-local; absolute bounds can include rotation and translation. */
export function getVectorCanvasBounds(node: FigmaRawNode): SvgBounds | undefined {
  const width = node.size?.x;
  const height = node.size?.y;
  if (typeof width !== "number" || typeof height !== "number") return undefined;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 0 || height < 0) {
    return undefined;
  }
  return { x: 0, y: 0, width, height };
}

function hasVectorGeometry(geometry: unknown): boolean {
  return Array.isArray(geometry) && (geometry as FigmaGeometry[]).some((entry) => entry.path);
}

function getGeometryPaints(node: FigmaRawNode): FigmaRawPaint[] | undefined {
  if (hasVectorGeometry(node.fillGeometry)) return node.fills as FigmaRawPaint[] | undefined;
  if (hasVectorGeometry(node.strokeGeometry)) return node.strokes as FigmaRawPaint[] | undefined;
  return node.fills as FigmaRawPaint[] | undefined;
}

function applyPaintOpacity(color: string, opacity: number | undefined): string {
  if (opacity === undefined || opacity === 1 || !Number.isFinite(opacity)) return color;
  const alpha = parseInt(color.slice(7) || "FF", 16);
  const combined = Math.round(alpha * Math.max(0, Math.min(1, opacity)));
  return `${color.slice(0, 7)}${combined.toString(16).padStart(2, "0")}`.toUpperCase();
}

/** Match the paint to the geometry selected by extractVectorPaths; node opacity stays outside. */
export function getVectorPaintColor(
  node: FigmaRawNode,
  variableContext?: VariableResolutionContext | null,
): string | undefined {
  const paints = getGeometryPaints(node)?.filter((paint) => paint.visible !== false);
  if (!paints) return undefined;
  if (!paints.length) return "none";
  if (paints.length !== 1 || paints[0].type !== "SOLID") {
    Logger.warn(`SVG export has unsupported non-solid or stacked paints on node ${node.id}`);
    return undefined;
  }
  const color = processPaint(paints[0], variableContext);
  if (typeof color !== "string") {
    Logger.warn(`SVG export has unsupported unresolved paint on node ${node.id}`);
    return undefined;
  }
  return applyPaintOpacity(color, paints[0].opacity);
}

export function vectorNetworkToSvg(
  vectorNetwork: FigmaVectorNetwork,
): Array<{ d: string; fillRule?: string }> | undefined {
  const { vertices, segments, regions } = vectorNetwork;

  if (!vertices || !segments || !regions || regions.length === 0) {
    return undefined;
  }

  return regions.map((region) => {
    const pathParts: string[] = [];

    for (const loop of region.loops) {
      if (loop.length === 0) continue;

      const firstSegmentIdx = loop[0];
      const firstSegment = segments[firstSegmentIdx];
      if (!firstSegment) continue;

      const startVertex = vertices[firstSegment.start];
      if (!startVertex) continue;

      pathParts.push(
        `M ${roundTo(startVertex.position.x, 2)} ${roundTo(startVertex.position.y, 2)}`,
      );

      for (const segmentIdx of loop) {
        const segment = segments[segmentIdx];
        if (!segment) continue;

        const endVertex = vertices[segment.end];
        if (!endVertex) continue;

        const cp1x = roundTo(vertices[segment.start]!.position.x + segment.startTangent.x, 2);
        const cp1y = roundTo(vertices[segment.start]!.position.y + segment.startTangent.y, 2);
        const cp2x = roundTo(endVertex.position.x + segment.endTangent.x, 2);
        const cp2y = roundTo(endVertex.position.y + segment.endTangent.y, 2);
        const x = roundTo(endVertex.position.x, 2);
        const y = roundTo(endVertex.position.y, 2);

        pathParts.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${x} ${y}`);
      }

      pathParts.push("Z");
    }

    return {
      d: pathParts.join(" "),
      fillRule:
        region.windingRule && region.windingRule.toLowerCase() === "evenodd"
          ? "evenodd"
          : "nonzero",
    };
  });
}

export function extractVectorPaths(
  node: FigmaRawNode,
): Array<{ d: string; fillRule?: string }> | undefined {
  if (node.type !== "VECTOR") return undefined;

  const fillGeometry = node.fillGeometry as FigmaGeometry[] | undefined;
  const strokeGeometry = node.strokeGeometry as FigmaGeometry[] | undefined;
  const vectorNetwork = node.vectorNetwork as FigmaVectorNetwork | undefined;

  if (fillGeometry && fillGeometry.length > 0) {
    const paths = fillGeometry.map((geo) => ({
      d: geo.path,
      fillRule:
        geo.windingRule && geo.windingRule.toLowerCase() === "evenodd" ? "evenodd" : "nonzero",
    }));
    if (paths.length > 0 && paths.some((p) => p.d)) return paths;
  }

  if (strokeGeometry && strokeGeometry.length > 0) {
    const paths = strokeGeometry.map((geo) => ({
      d: geo.path,
      fillRule:
        geo.windingRule && geo.windingRule.toLowerCase() === "evenodd" ? "evenodd" : "nonzero",
    }));
    if (paths.length > 0 && paths.some((p) => p.d)) return paths;
  }

  if (vectorNetwork) {
    const paths = vectorNetworkToSvg(vectorNetwork);
    if (paths && paths.length > 0) return paths;
  }

  return undefined;
}
