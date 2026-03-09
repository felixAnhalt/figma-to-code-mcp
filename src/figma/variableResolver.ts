/**
 * Variable Resolution
 *
 * Resolves Figma variable references (VariableAlias) to their actual values.
 *
 * Figma's API returns variable references as:
 * { type: "VARIABLE_ALIAS", id: "VariableID:123:456" }
 *
 * This module:
 * 1. Fetches all variables from the file
 * 2. Extracts the active mode for each variable collection
 * 3. Resolves variable IDs to their actual values
 * 4. Handles nested variable aliases (variables referencing other variables)
 */

import type { GetLocalVariablesResponse, VariableAlias, RGBA } from "@figma/rest-api-spec";
import type { FigmaService } from "~/services/figma.js";

export type VariableValue = boolean | number | string | RGBA;

export interface VariableResolutionContext {
  /** Map of variable ID to resolved value */
  variableValues: Map<string, VariableValue>;
  /** Map of variable collection ID to active mode ID */
  activeModes: Map<string, string>;
}

/**
 * Builds a resolution context from Figma's variable response.
 *
 * The context maps variable IDs to their resolved values, using the first mode
 * of each variable collection as the active mode.
 *
 * Why first mode? Figma files can have multiple modes (light/dark, mobile/desktop, etc.)
 * but the API doesn't tell us which mode is currently active. We default to the first
 * mode defined, which is typically the "default" or "base" mode.
 *
 * @param variablesResponse - Response from GET /v1/files/{file_key}/variables/local
 * @returns Resolution context for looking up variable values
 */
export function buildResolutionContext(
  variablesResponse: GetLocalVariablesResponse,
): VariableResolutionContext {
  const variableValues = new Map<string, VariableValue>();
  const activeModes = new Map<string, string>();

  // Extract active mode for each collection (use first mode as default)
  for (const [collectionId, collection] of Object.entries(
    variablesResponse.meta.variableCollections,
  )) {
    if (collection.modes && collection.modes.length > 0) {
      activeModes.set(collectionId, collection.modes[0].modeId);
    }
  }

  // Build variable value map
  for (const [variableId, variable] of Object.entries(variablesResponse.meta.variables)) {
    const modeId = activeModes.get(variable.variableCollectionId);
    if (!modeId) continue;

    const value = variable.valuesByMode[modeId];
    if (value === undefined) continue;

    // Resolve nested aliases
    if (isVariableAlias(value)) {
      // Will be resolved in second pass
      continue;
    }

    variableValues.set(variableId, value);
  }

  // Second pass: resolve nested aliases
  for (const [variableId, variable] of Object.entries(variablesResponse.meta.variables)) {
    const modeId = activeModes.get(variable.variableCollectionId);
    if (!modeId) continue;

    const value = variable.valuesByMode[modeId];
    if (!isVariableAlias(value)) continue;

    const resolvedValue = resolveVariableAlias(value, variablesResponse, activeModes, new Set());
    if (resolvedValue !== undefined) {
      variableValues.set(variableId, resolvedValue);
    }
  }

  return { variableValues, activeModes };
}

/**
 * Resolves a variable alias to its actual value, following chains of aliases.
 *
 * Handles cases where variables reference other variables:
 * primaryColor -> brandColor -> #FF0000
 *
 * @param alias - The variable alias to resolve
 * @param variablesResponse - Full variables response
 * @param activeModes - Map of collection ID to active mode
 * @param visited - Set of visited IDs to prevent infinite loops
 * @returns The resolved value, or undefined if it can't be resolved
 */
function resolveVariableAlias(
  alias: VariableAlias,
  variablesResponse: GetLocalVariablesResponse,
  activeModes: Map<string, string>,
  visited: Set<string>,
): VariableValue | undefined {
  // Prevent infinite loops
  if (visited.has(alias.id)) {
    return undefined;
  }
  visited.add(alias.id);

  const variable = variablesResponse.meta.variables[alias.id];
  if (!variable) return undefined;

  const modeId = activeModes.get(variable.variableCollectionId);
  if (!modeId) return undefined;

  const value = variable.valuesByMode[modeId];
  if (value === undefined) return undefined;

  // If value is another alias, recurse
  if (isVariableAlias(value)) {
    return resolveVariableAlias(value, variablesResponse, activeModes, visited);
  }

  return value;
}

/**
 * Type guard for VariableAlias
 */
function isVariableAlias(value: unknown): value is VariableAlias {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "VARIABLE_ALIAS" &&
    "id" in value &&
    typeof value.id === "string"
  );
}

/**
 * Resolves a single variable reference to its value.
 *
 * @param alias - The variable alias to resolve
 * @param context - Resolution context with variable values
 * @returns The resolved value, or the original alias if it can't be resolved
 */
export function resolveVariable(
  alias: VariableAlias,
  context: VariableResolutionContext,
): VariableValue | VariableAlias {
  const value = context.variableValues.get(alias.id);
  return value ?? alias;
}

/**
 * Fetches variables from Figma and builds a resolution context.
 *
 * @param figmaService - FigmaService instance
 * @param fileKey - Figma file key
 * @returns Resolution context, or null if no variables exist
 */
export async function fetchVariableContext(
  figmaService: FigmaService,
  fileKey: string,
): Promise<VariableResolutionContext | null> {
  try {
    const variablesResponse = await figmaService.getLocalVariables(fileKey);

    // If no variables exist, return null
    if (
      !variablesResponse.meta.variables ||
      Object.keys(variablesResponse.meta.variables).length === 0
    ) {
      return null;
    }

    return buildResolutionContext(variablesResponse);
  } catch (error) {
    // If variables endpoint fails (e.g., permissions), log and continue without resolution
    console.warn(`Failed to fetch variables for ${fileKey}:`, error);
    return null;
  }
}
