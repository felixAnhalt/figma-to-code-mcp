type QueueItem = {
  fn: () => Promise<any>;
  resolve: (value: any) => void;
  reject: (error: any) => void;
};

class RateLimiter {
  private queue: QueueItem[] = [];
  private processing = false;
  private lastRequest = 0;
  private readonly minInterval = 100; // 100ms between requests (max 10 req/sec for Tier 2)

  async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      this.queue.push({ fn, resolve, reject });
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

export async function safeFetch(url: string, options?: RequestInit): Promise<Response> {
  return limiter.enqueue(() => fetch(url, options));
}
