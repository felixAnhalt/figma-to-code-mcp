/**
 * Downloads a rendered image. Not routed through httpClient: the image host is not a Figma API
 * path, so the per-tier rate limiter would pace this download as tier 1.
 */
export async function downloadBytes(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}: ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}
