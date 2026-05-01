import { execFile } from "child_process";
import { promisify } from "util";
import { Logger } from "./logger";

const execFileAsync = promisify(execFile);

type QueueItem = {
  fn: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
const MIN_INTERVAL_MS = 100; // 100ms between requests (max 10 req/sec for Tier 2)

class RateLimiter {
  private queue: QueueItem[] = [];
  private processing = false;
  private lastRequest = 0;

  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve: resolve as (value: unknown) => void, reject });
      if (!this.processing) {
        this.process();
      }
    });
  }

  private async process(): Promise<void> {
    if (this.queue.length === 0) {
      this.processing = false;
      return;
    }

    this.processing = true;
    const item = this.queue.shift()!;

    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequest;
    if (timeSinceLastRequest < MIN_INTERVAL_MS) {
      await new Promise((resolve) => setTimeout(resolve, MIN_INTERVAL_MS - timeSinceLastRequest));
    }

    this.lastRequest = Date.now();

    try {
      const result = await item.fn();
      item.resolve(result);
    } catch (error) {
      item.reject(error);
    }

    this.process();
  }
}

const rateLimiter = new RateLimiter();

export type HttpClientOptions = RequestInit & {
  headers?: Record<string, string>;
  /** Skip curl fallback on fetch failure. Defaults to false. */
  skipCurlFallback?: boolean;
  /** Skip rate limiting. Defaults to false. */
  skipRateLimit?: boolean;
  /** Skip 429 retry logic. Defaults to false. */
  skip429Retry?: boolean;
};

async function fetchWithCurl<T>(
  url: string,
  headers: Record<string, string> | undefined,
): Promise<T> {
  const curlHeaders = formatHeadersForCurl(headers);
  const curlArgs = ["-s", "-S", "--fail-with-body", "-L", ...curlHeaders, url];

  try {
    const { stdout, stderr } = await execFileAsync("curl", curlArgs, {
      timeout: 30000,
    });

    if (stderr) {
      if (
        !stdout ||
        stderr.toLowerCase().includes("error") ||
        stderr.toLowerCase().includes("fail")
      ) {
        throw new Error(`Curl command failed with stderr: ${stderr}`);
      }
    }

    if (!stdout) {
      throw new Error("Curl command returned empty stdout.");
    }

    return JSON.parse(stdout) as T;
  } catch (curlError: unknown) {
    const curlMessage = curlError instanceof Error ? curlError.message : String(curlError);
    Logger.error(`[httpClient] Curl fallback also failed for ${url}: ${curlMessage}`);
    throw curlError;
  }
}

function formatHeadersForCurl(headers: Record<string, string> | undefined): string[] {
  if (!headers) {
    return [];
  }

  const headerArgs: string[] = [];
  for (const [key, value] of Object.entries(headers)) {
    headerArgs.push("-H", `${key}: ${value}`);
  }
  return headerArgs;
}

/**
 * Unified HTTP client for Figma API requests.
 *
 * Features:
 * - Rate limiting (100ms between requests)
 * - 429 retry with exponential backoff
 * - Curl fallback for corporate proxies
 * - Returns parsed JSON
 *
 * @param url - The URL to fetch
 * @param options - Request options
 * @returns Parsed JSON response
 */
export async function httpClient<T>(url: string, options: HttpClientOptions = {}): Promise<T> {
  const {
    skipCurlFallback = false,
    skipRateLimit = false,
    skip429Retry = false,
    ...fetchOptions
  } = options;

  const makeRequest = async (): Promise<T> => {
    try {
      const response = await fetch(url, fetchOptions);

      // Handle 429 rate limit
      if (response.status === 429 && !skip429Retry) {
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
          if (attempt === MAX_RETRIES) {
            throw new Error(`httpClient: max retries (${MAX_RETRIES}) exceeded for 429`);
          }

          const retryAfter = response.headers.get("Retry-After");
          const delayMs = retryAfter
            ? parseFloat(retryAfter) * 1000
            : RETRY_BASE_DELAY_MS * 2 ** attempt;

          Logger.log(
            `[httpClient] 429 received, retrying in ${delayMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`,
          );
          await new Promise((resolve) => setTimeout(resolve, delayMs));

          const retryResponse = await fetch(url, fetchOptions);
          if (retryResponse.status !== 429) {
            if (!retryResponse.ok) {
              throw new Error(
                `Fetch failed with status ${retryResponse.status}: ${retryResponse.statusText}`,
              );
            }
            return retryResponse.json() as Promise<T>;
          }
        }
      }

      if (!response.ok) {
        throw new Error(`Fetch failed with status ${response.status}: ${response.statusText}`);
      }

      return response.json() as Promise<T>;
    } catch (fetchError: unknown) {
      // If fetch fails and curl fallback is enabled, try curl
      if (!skipCurlFallback) {
        const fetchMessage = fetchError instanceof Error ? fetchError.message : String(fetchError);

        Logger.log(
          `[httpClient] Initial fetch failed for ${url}: ${fetchMessage}. Attempting curl fallback.`,
        );

        try {
          return await fetchWithCurl<T>(url, fetchOptions.headers);
        } catch {
          // Curl failed too, re-throw original fetch error
          throw fetchError;
        }
      }

      throw fetchError;
    }
  };

  if (skipRateLimit) {
    return makeRequest();
  }

  return rateLimiter.enqueue(makeRequest);
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
  return rateLimiter.enqueue(async () => {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetch(url, options);

      if (response.status !== 429 || attempt === MAX_RETRIES) {
        return response;
      }

      const retryAfter = response.headers.get("Retry-After");
      const delayMs = retryAfter
        ? parseFloat(retryAfter) * 1000
        : RETRY_BASE_DELAY_MS * 2 ** attempt;

      Logger.log(`[httpClientRaw] 429 received, waiting ${delayMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw new Error("httpClientRaw: exhausted retries");
  });
}
