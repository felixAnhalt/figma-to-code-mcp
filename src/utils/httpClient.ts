import { Logger } from "./logger";
import { figmaRateLimiter } from "./figmaRateLimiter";
import { fetchViaCurl, supportsCurlFallback } from "./curlFallback";

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
 * Sends a request with fetch. A network-level failure of a GET request is retried once through
 * curl, which handles corporate proxies. If curl fails too, the original fetch error is thrown.
 */
async function fetchWithCurlFallback(url: string, options: RequestInit): Promise<Response> {
  try {
    return await fetch(url, options);
  } catch (fetchError) {
    if (!supportsCurlFallback(options)) throw fetchError;
    const path = new URL(url).pathname;
    const message = fetchError instanceof Error ? fetchError.message : String(fetchError);
    Logger.warn(`[httpClient] fetch failed for ${path}: ${message}. Trying curl.`);
    try {
      return await fetchViaCurl(url, options);
    } catch (curlError) {
      const curlMessage = curlError instanceof Error ? curlError.message : String(curlError);
      Logger.error(`[httpClient] curl fallback also failed for ${path}: ${curlMessage}`);
      throw fetchError;
    }
  }
}

/**
 * Sends one Figma request, paced by its tier's budget. A 429 pauses only that tier
 * for the Retry-After time, then retries, up to MAX_RETRIES times.
 */
async function sendFigmaRequest(url: string, options: RequestInit): Promise<Response> {
  let response = await figmaRateLimiter.run(url, () => fetchWithCurlFallback(url, options));
  for (let attempt = 0; response.status === 429 && attempt < MAX_RETRIES; attempt++) {
    const delayMs = delayBeforeRetryMs(response, attempt);
    Logger.warn(
      `[httpClient] Figma rate limit hit on ${new URL(url).pathname}; retry ${attempt + 1}/${MAX_RETRIES} in ${Math.ceil(delayMs / SECONDS_TO_MS)}s`,
    );
    figmaRateLimiter.pause(url, delayMs);
    response = await figmaRateLimiter.run(url, () => fetchWithCurlFallback(url, options));
  }
  return response;
}

/**
 * Unified HTTP client for Figma API requests.
 *
 * Features:
 * - Per-tier request budgets (see figmaRateLimiter)
 * - 429 retry that pauses only the affected tier
 * - One curl retry for GET requests that fail at the network level
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
