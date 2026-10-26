import type { Style } from "~/figma/types";
import type { FigmaRawNode } from "./types";

type StrokeWidths = Pick<Style, "borderWidth" | "borderWidths">;

function isValidStrokeWidth(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseIndividualStrokeWeights(value: unknown): Style["borderWidths"] {
  if (!value || typeof value !== "object") return undefined;
  const { top, right, bottom, left } = value as Record<string, unknown>;
  if (
    !isValidStrokeWidth(top) ||
    !isValidStrokeWidth(right) ||
    !isValidStrokeWidth(bottom) ||
    !isValidStrokeWidth(left)
  ) {
    return undefined;
  }
  return { top, right, bottom, left };
}

export function extractStrokeWidths(node: FigmaRawNode): StrokeWidths {
  if (node.individualStrokeWeights !== undefined) {
    const edges = parseIndividualStrokeWeights(node.individualStrokeWeights);
    // Invalid or incomplete edge sets must not create a misleading uniform border.
    if (!edges) return {};
    if (Object.values(edges).some((width) => width !== edges.top)) {
      return { borderWidths: edges };
    }
    return edges.top === 0 ? {} : { borderWidth: edges.top };
  }

  return isValidStrokeWidth(node.strokeWeight) && node.strokeWeight !== 0
    ? { borderWidth: node.strokeWeight }
    : {};
}
