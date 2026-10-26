import type { Style, StyleVarRefs } from "~/figma/types";
import type { VariableResolutionContext } from "~/figma/variableResolver";
import type { FigmaRawNode, FigmaRawPaint, FigmaEffect } from "./types";
import { formatColor, roundTo } from "./utils";
import { processPaint, resolveVariableName } from "./paint";
import { extractStrokeWidths } from "./stroke-widths";

function extractBorderFromNode(
  node: FigmaRawNode,
  variableContext: VariableResolutionContext | null | undefined,
  varRefs: StyleVarRefs,
) {
  const stroke = (node.strokes as FigmaRawPaint[] | undefined)?.find((s) => s.visible !== false);
  if (!stroke) return undefined;
  const border = processPaint(stroke, variableContext, (name) => {
    varRefs.border = name;
  });
  const widths = extractStrokeWidths(node);
  if (widths.borderWidth !== undefined) {
    const boundVars = node.boundVariables as Record<string, unknown> | undefined;
    const name = resolveVariableName(boundVars?.strokeWeight, variableContext);
    if (name) varRefs.borderWidth = name;
  }
  return { ...(typeof border === "string" ? { border } : {}), ...widths };
}

export function extractStyleFromNode(
  node: FigmaRawNode,
  variableContext: VariableResolutionContext | null | undefined,
): Style | undefined {
  const style: Style = {};
  const varRefs: StyleVarRefs = {};

  const fills = (node.fills as FigmaRawPaint[] | undefined)?.filter((f) => f.visible !== false);
  if (fills && fills.length > 0) {
    const processed = processPaint(fills[0], variableContext, (name) => {
      if (node.type === "TEXT") {
        varRefs.color = name;
      } else {
        varRefs.background = name;
      }
    });
    if (node.type === "TEXT") {
      if (typeof processed === "string") style.color = processed;
    } else {
      if (typeof processed === "string") style.background = processed;
      else if (processed) style.background = [processed];
    }
  }

  Object.assign(style, extractBorderFromNode(node, variableContext, varRefs));

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
    // Check for boundVariables on cornerRadius
    const boundVars = node.boundVariables as Record<string, unknown> | undefined;
    const boundCornerRadius = boundVars?.cornerRadius;
    if (boundCornerRadius) {
      const name = resolveVariableName(boundCornerRadius, variableContext);
      if (name) varRefs.radius = name;
    }
  }

  const effects = node.effects as FigmaEffect[] | undefined;
  if (effects && effects.length > 0) {
    const shadows = effects
      .filter((e) => (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") && e.visible !== false)
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

  if (node.rotation !== undefined && node.rotation !== 0) {
    const degrees = roundTo(((node.rotation as number) * 180) / Math.PI, 2);
    if (degrees !== 0) {
      style.transform = `rotate(${degrees}deg)`;
    }
  }

  if (node.blendMode && node.blendMode !== "NORMAL" && node.blendMode !== "PASS_THROUGH") {
    style.blend = node.blendMode as string;
  }

  if (Object.keys(varRefs).length > 0) {
    style._varRefs = varRefs;
  }

  return Object.keys(style).length > 0 ? style : undefined;
}
