import { mapInteractionTrigger, mapInteractionAction } from "./utils";
import { Interaction } from "~/figma/reducer/types";

export function extractInteractions(node: { interactions?: unknown }): Interaction[] | undefined {
  const rawInteractions = node.interactions as
    | Array<{
        trigger?: { type?: string };
        actions?: Array<{
          type?: string;
          destinationId?: string;
          navigation?: string;
          transition?: {
            type?: string;
            easing?: { type?: string };
            duration?: number;
          } | null;
        } | null>;
      }>
    | undefined;
  if (!rawInteractions || rawInteractions.length === 0) return undefined;

  const mapped: Interaction[] = rawInteractions.flatMap((interaction) => {
    if (!interaction.actions) return [];
    return interaction.actions
      .filter((action): action is NonNullable<typeof action> => action !== null)
      .map((action) => {
        const result: Interaction = {
          trigger: mapInteractionTrigger(interaction.trigger?.type),
          action: mapInteractionAction(action.type, action.navigation),
        };
        if (action.destinationId) result.destination = action.destinationId;
        if (action.transition) {
          if (action.transition.duration !== undefined) {
            result.transitionDuration = Math.round(action.transition.duration * 1000);
          }
          if (action.transition.easing?.type) {
            result.transitionEasing = mapTransitionEasing(action.transition.easing.type);
          }
        }
        return result;
      });
  });
  return mapped.length > 0 ? mapped : undefined;
}

function mapTransitionEasing(raw: string): string {
  const mapping: Record<string, string> = {
    EASE_IN: "ease-in",
    EASE_OUT: "ease-out",
    EASE_IN_AND_OUT: "ease-in-out",
    LINEAR: "linear",
  };
  return mapping[raw] ?? raw;
}
