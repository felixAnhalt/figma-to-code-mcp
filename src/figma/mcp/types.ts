import type { VariableResolutionContext } from "../variableResolver";

export type RichComponentMeta = {
  key: string;
  file_key: string;
  node_id: string;
  componentSetId?: string;
  name: string;
  description?: string;
};

export type ComponentSetMetadata = {
  name: string;
  /** Variant names of every member the library listing or this file reports, e.g. "Size=md, Type=primary". */
  memberNames?: string[];
};

export type MCPOptions = {
  fileKey: string;
  authHeaders: Record<string, string>;
  rootNodeId: string;
  styleMap?: Record<string, unknown>;
  cacheTTL?: number;
  resolveVariables?: boolean;
  /** Also return every other variant of each component the design uses. Default false. */
  includeComponentVariants?: boolean;
  svgOutputDir?: string;
  componentMap?: Record<string, RichComponentMeta>;
  componentSetMap?: Record<string, ComponentSetMetadata>;
  preloadedVariableContext?: VariableResolutionContext | null;
};
