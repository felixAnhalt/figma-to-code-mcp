import type { VariableAlias } from "@figma/rest-api-spec";
import type { Paint } from "~/figma/types";
import { resolveVariable } from "~/figma/variableResolver";
import type { VariableResolutionContext as VRC } from "~/figma/variableResolver";
import type { FigmaRawPaint } from "./types";
import { formatColor, roundTo } from "./utils";

const GRADIENT_HANDLE_COUNT = 3;
type GradientHandlePositions = NonNullable<Paint["gradientHandlePositions"]>;

function isFiniteGradientPoint(point: unknown): point is GradientHandlePositions[number] {
  return (
    typeof point === "object" &&
    point !== null &&
    "x" in point &&
    "y" in point &&
    typeof point.x === "number" &&
    typeof point.y === "number" &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
}

function extractGradientHandlePositions(handles: unknown): GradientHandlePositions | undefined {
  if (!Array.isArray(handles) || handles.length !== GRADIENT_HANDLE_COUNT) return undefined;
  const [start, end, width] = handles;
  if (
    !isFiniteGradientPoint(start) ||
    !isFiniteGradientPoint(end) ||
    !isFiniteGradientPoint(width)
  ) {
    return undefined;
  }
  return [
    { x: start.x, y: start.y },
    { x: end.x, y: end.y },
    { x: width.x, y: width.y },
  ];
}

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

/**
 * Looks up the Figma variable name for a VariableAlias, if available.
 * Returns dot-notation name (e.g. "ref.color.secondary.800") or undefined.
 */
export function resolveVariableName(
  value: unknown,
  variableContext: VRC | null | undefined,
): string | undefined {
  if (!isVariableAlias(value)) return undefined;
  if (!variableContext) return undefined;
  return variableContext.variableNames.get((value as VariableAlias).id);
}

function processSolidPaint(
  paint: FigmaRawPaint,
  variableContext: VRC | null | undefined,
  varNameSetter?: (name: string) => void,
): string | undefined {
  const boundColor = (paint.boundVariables as Record<string, unknown> | undefined)?.color;
  if (boundColor) {
    const name = resolveVariableName(boundColor, variableContext);
    if (name) varNameSetter?.(name);
    const resolved = resolveValue(boundColor, variableContext);
    if (resolved && typeof resolved === "object" && "r" in resolved) {
      return formatColor(resolved);
    }
  }
  return formatColor(paint.color);
}

function processGradientPaint(paint: FigmaRawPaint, type: string): Paint {
  const gradientHandlePositions = extractGradientHandlePositions(paint.gradientHandlePositions);
  return {
    type,
    gradientStops: paint.gradientStops?.map((stop) => ({
      position: roundTo(stop.position, 3),
      color: formatColor(stop.color) ?? "#000000",
    })),
    ...(gradientHandlePositions ? { gradientHandlePositions } : {}),
  };
}

export function processPaint(
  paint: FigmaRawPaint,
  variableContext: VRC | null | undefined,
  varNameSetter?: (name: string) => void,
): string | Paint | undefined {
  if (!paint?.type) return undefined;
  if (paint.type === "SOLID") return processSolidPaint(paint, variableContext, varNameSetter);
  if (paint.type === "GRADIENT_LINEAR" || paint.type === "GRADIENT_RADIAL") {
    return processGradientPaint(paint, paint.type);
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
