import type { GetFileNodesResponse } from "@figma/rest-api-spec";
import { httpClient } from "~/utils/http-client";

/**
 * Fetches multiple nodes from a Figma file in a single batched request.
 * Respects Figma API limits (max 50 nodes per request for Tier 2).
 */
export async function fetchNodesBatch(
  fileKey: string,
  nodeIds: string[],
  authHeaders: Record<string, string>,
): Promise<GetFileNodesResponse["nodes"]> {
  if (nodeIds.length === 0) return {};

  // Batch in chunks of 50 to respect API limits
  const chunks: string[][] = [];
  for (let i = 0; i < nodeIds.length; i += 50) {
    chunks.push(nodeIds.slice(i, i + 50));
  }

  const results: GetFileNodesResponse["nodes"] = {};

  for (const chunk of chunks) {
    const ids = chunk.join(",");
    const url = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${ids}&depth=100&geometry=paths`;

    try {
      const data = await httpClient<GetFileNodesResponse>(url, {
        headers: authHeaders,
        skipCurlFallback: true,
      });

      if (data.nodes) {
        Object.assign(results, data.nodes);
      }
    } catch (error) {
      console.error(`Promblems fetching node ${fileKey} ${ids}:`, error);
      throw error;
    }
  }

  return results;
}
