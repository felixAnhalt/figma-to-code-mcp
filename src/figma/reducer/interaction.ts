import { mapInteractionTrigger, mapInteractionAction } from "./utils";
import { Interaction } from "~/figma/reducer/types";

export function extractInteractions(node: { interactions?: unknown }): Interaction[] | undefined {
  const rawInteractions = node.interactions as
    | Array<{
        trigger?: { type?: string };
        actions?: Array<{ type?: string; destinationId?: string; navigation?: string } | null>;
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
        return result;
      });
  });
  return mapped.length > 0 ? mapped : undefined;
}
