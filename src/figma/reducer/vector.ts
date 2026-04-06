import type { FigmaVectorNetwork, FigmaGeometry, FigmaRawNode } from "./types";
import { roundTo } from "./utils";

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
