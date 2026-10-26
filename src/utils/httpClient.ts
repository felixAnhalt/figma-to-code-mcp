import { Logger } from "./logger";
import { figmaRateLimiter } from "./figmaRateLimiter";

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
const SECONDS_TO_MS = 1000;

export type HttpClientOptions = RequestInit & {
  headers?: Record<string, string>;
};

function delayBeforeRetryMs(response: Response, attempt: number): number {
  const retryAfterSeconds = Number.parseFloat(response.headers.get("Retry-After") ?? "");
  return Number.isFinite(retryAfterSeconds)
    ? retryAfterSeconds * SECONDS_TO_MS
    : RETRY_BASE_DELAY_MS * 2 ** attempt;
}

/**
 * Sends one Figma request, paced by its tier's budget. A 429 pauses only that tier
 * for the Retry-After time, then retries, up to MAX_RETRIES times.
 */
async function sendFigmaRequest(url: string, options: RequestInit): Promise<Response> {
  let response = await figmaRateLimiter.run(url, () => fetch(url, options));
  for (let attempt = 0; response.status === 429 && attempt < MAX_RETRIES; attempt++) {
    const delayMs = delayBeforeRetryMs(response, attempt);
    Logger.warn(
      `[httpClient] Figma rate limit hit on ${new URL(url).pathname}; retry ${attempt + 1}/${MAX_RETRIES} in ${Math.ceil(delayMs / SECONDS_TO_MS)}s`,
    );
    figmaRateLimiter.pause(url, delayMs);
    response = await figmaRateLimiter.run(url, () => fetch(url, options));
  }
  return response;
}

/**
 * Unified HTTP client for Figma API requests.
 *
 * Features:
 * - Per-tier request budgets (see figmaRateLimiter)
 * - 429 retry that pauses only the affected tier
 * - Returns parsed JSON; throws on HTTP errors and network failures
 *
 * @param url - The URL to fetch
 * @param options - Request options
 * @returns Parsed JSON response
 */
export async function httpClient<T>(url: string, options: HttpClientOptions = {}): Promise<T> {
  const response = await sendFigmaRequest(url, options);
  if (!response.ok) {
    throw new Error(`Fetch failed with status ${response.status}: ${response.statusText}`);
  }
  return (await response.json()) as T;
}

/**
 * HTTP client that returns raw Response object (for endpoints that return
 * data in non-standard formats or need access to response headers).
 *
 * @param url - The URL to fetch
 * @param options - Request options
 * @returns Raw Response object
 */
export async function httpClientRaw(url: string, options: RequestInit = {}): Promise<Response> {
  return sendFigmaRequest(url, options);
}
