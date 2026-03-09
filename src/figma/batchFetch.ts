import { safeFetch } from "./rateLimit.js";

/**
 * Fetches multiple nodes from a Figma file in a single batched request.
 * Respects Figma API limits (max 50 nodes per request for Tier 2).
 */
export async function fetchNodesBatch(
  fileKey: string,
  nodeIds: string[],
  token: string,
): Promise<Record<string, any>> {
  if (nodeIds.length === 0) return {};

  // Batch in chunks of 50 to respect API limits
  const chunks: string[][] = [];
  for (let i = 0; i < nodeIds.length; i += 50) {
    chunks.push(nodeIds.slice(i, i + 50));
  }

  const results: Record<string, any> = {};

  for (const chunk of chunks) {
    const ids = chunk.join(",");
    const url = `https://api.figma.com/v1/files/${fileKey}/nodes?ids=${ids}&depth=100`;

    const response = await safeFetch(url, {
      headers: { "X-Figma-Token": token },
    });

    if (!response.ok) {
      throw new Error(`Figma API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Merge results
    if (data.nodes) {
      Object.assign(results, data.nodes);
    }
  }

  return results;
}

/**
 * Fetches the entire file structure (used to get root node and discover all node IDs).
 */
export async function fetchFile(fileKey: string, token: string): Promise<any> {
  const url = `https://api.figma.com/v1/files/${fileKey}`;

  const response = await safeFetch(url, {
    headers: { "X-Figma-Token": token },
  });

  if (!response.ok) {
    throw new Error(`Figma API error: ${response.status} ${response.statusText}`);
  }

  return response.json();
}
