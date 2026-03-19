type QueueItem = {
  fn: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

class RateLimiter {
  private queue: QueueItem[] = [];
  private processing = false;
  private lastRequest = 0;
  private readonly minInterval = 100; // 100ms between requests (max 10 req/sec for Tier 2)

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
    if (timeSinceLastRequest < this.minInterval) {
      await new Promise((resolve) => setTimeout(resolve, this.minInterval - timeSinceLastRequest));
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

const limiter = new RateLimiter();

/**
 * Wraps fetch with rate limiting and 429 retry logic.
 *
 * Retries up to MAX_RETRIES times on 429 responses using exponential backoff,
 * respecting the Retry-After header when present. All requests are serialized
 * through the rate limiter to stay within Figma API tier limits.
 */
export async function safeFetch(url: string, options?: RequestInit): Promise<Response> {
  return limiter.enqueue(async () => {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const response = await fetch(url, options);

      if (response.status !== 429 || attempt === MAX_RETRIES) {
        return response;
      }

      // Respect Retry-After if provided, otherwise use exponential backoff
      const retryAfter = response.headers.get("Retry-After");
      const delayMs = retryAfter
        ? parseFloat(retryAfter) * 1000
        : RETRY_BASE_DELAY_MS * 2 ** attempt;

      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    // Unreachable — loop always returns, but satisfies TypeScript
    throw new Error("safeFetch: exhausted retries");
  });
}
