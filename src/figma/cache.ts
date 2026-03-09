type CacheEntry = {
  data: any;
  timestamp: number;
  ttl: number;
};

const cache = new Map<string, CacheEntry>();

export function getCache(key: string): any | null {
  const entry = cache.get(key);
  if (!entry) return null;

  const now = Date.now();
  if (now - entry.timestamp > entry.ttl) {
    cache.delete(key);
    return null;
  }

  return entry.data;
}

export function setCache(key: string, data: any, ttl: number): void {
  cache.set(key, {
    data,
    timestamp: Date.now(),
    ttl,
  });
}

export function clearCache(): void {
  cache.clear();
}
