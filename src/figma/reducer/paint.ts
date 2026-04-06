import type { FigmaRawPaint } from "./types";
import type { Paint } from "~/figma";
import type { VariableAlias } from "@figma/rest-api-spec";
import type { VariableResolutionContext as VRC } from "../variableResolver";
import { formatColor, roundTo } from "./utils";

export function isVariableAlias(value: unknown): value is VariableAlias {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    (value as Record<string, unknown>).type === "VARIABLE_ALIAS" &&
    "id" in value &&
    typeof (value as Record<string, unknown>).id === "string"
  );
}

export function resolveValue(value: unknown, variableContext: VRC | null | undefined): unknown {
  if (!isVariableAlias(value)) return value;
  if (!variableContext) return undefined;

  const resolved = resolveVariable(value, variableContext);
  if (isVariableAlias(resolved)) return undefined;
  return resolved;
}

import { resolveVariable } from "../variableResolver";

export function processPaint(
  paint: FigmaRawPaint,
  variableContext: VRC | null | undefined,
): string | Paint | undefined {
  if (!paint?.type) return undefined;

  if (paint.type === "SOLID") {
    const boundColor = (paint.boundVariables as Record<string, unknown> | undefined)?.color;
    if (boundColor) {
      const resolved = resolveValue(boundColor, variableContext);
      if (resolved && typeof resolved === "object" && "r" in resolved) {
        return formatColor(resolved);
      }
    }
    return formatColor(paint.color);
  }

  if (paint.type === "GRADIENT_LINEAR" || paint.type === "GRADIENT_RADIAL") {
    return {
      type: paint.type,
      gradientStops: paint.gradientStops?.map((stop) => ({
        position: roundTo(stop.position, 3),
        color: formatColor(stop.color) ?? "rgba(0, 0, 0, 1)",
      })),
    };
  }

  if (paint.type === "IMAGE") {
    return {
      type: "IMAGE",
      imageRef: paint.imageRef,
      scaleMode: paint.scaleMode,
    };
  }

  return undefined;
}
