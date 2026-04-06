export type RichComponentMeta = {
  key: string;
  file_key: string;
  node_id: string;
  componentSetId?: string;
  name: string;
  description?: string;
};

export type MCPOptions = {
  fileKey: string;
  authHeaders: Record<string, string>;
  rootNodeId: string;
  styleMap?: Record<string, unknown>;
  cacheTTL?: number;
  resolveVariables?: boolean;
  svgOutputDir?: string;
  componentMap?: Record<string, RichComponentMeta>;
  componentSetMap?: Record<string, { name: string }>;
};
