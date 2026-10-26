/**
 * Live rate-limit probe. Not part of the default suite because it spends real Figma quota.
 *
 * Run with:
 *   RUN_FIGMA_RATE_LIMIT_PROBE=1 pnpm vitest run src/tests/liveRateLimit.test.ts
 *
 * Phase 1 plays another session or script: it bursts raw requests with the same token,
 * bypassing our limiter, until Figma answers 429.
 * Phase 2 is this MCP client (httpClientRaw) sending requests while the quota is still
 * exhausted. Every attempt is recorded, so the test checks that our 429s were followed by
 * a retry no sooner than Retry-After and that every request finally succeeded.
 */
import { config } from "dotenv";
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

config();

const BURST_CLIENT = "burst";
const RECOVERY_CLIENT = "mcp";
const PROBE_HEADER = "X-Probe-Client";
const BURST_CONCURRENCY = 10;
const MAX_BURST_REQUESTS = Number(process.env.FIGMA_PROBE_MAX_BURST_REQUESTS || 400);
const RECOVERY_REQUESTS = Number(process.env.FIGMA_PROBE_RECOVERY_REQUESTS || 10);
const PROBE_TIMEOUT_MS = 10 * 60 * 1000;
const HTTP_OK = 200;
const HTTP_RATE_LIMITED = 429;
const SECONDS_TO_MS = 1000;

type Attempt = {
  client: string;
  status: number;
  startedAt: number;
  retryAfterMs?: number;
};

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("Retry-After");
  const seconds = Number(header);
  if (response.status !== HTTP_RATE_LIMITED || header === null || !Number.isFinite(seconds)) {
    return undefined;
  }
  return seconds * SECONDS_TO_MS;
}

function recordAttempts(realFetch: typeof fetch, attempts: Attempt[]) {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const client = new Headers(init?.headers).get(PROBE_HEADER) ?? "unknown";
    const startedAt = Date.now();
    const response = await realFetch(input, init);
    attempts.push({
      client,
      status: response.status,
      startedAt,
      retryAfterMs: retryAfterMs(response),
    });
    return response;
  };
}

async function freshHttpClient() {
  vi.resetModules();
  return import("~/utils/httpClient");
}

async function burstOnce(url: string, token: string, label: string): Promise<void> {
  const response = await fetch(url, {
    headers: { "X-Figma-Token": token, [PROBE_HEADER]: label },
  });
  await response.arrayBuffer();
}

async function burstUntilRateLimited(url: string, token: string, attempts: Attempt[]) {
  let sent = 0;
  while (sent < MAX_BURST_REQUESTS) {
    const round = Array.from({ length: BURST_CONCURRENCY }, (_, index) => sent + index);
    await Promise.all(round.map((index) => burstOnce(url, token, `${BURST_CLIENT}-${index}`)));
    sent += BURST_CONCURRENCY;
    if (
      attempts.some(
        (attempt) =>
          attempt.client.startsWith(BURST_CLIENT) && attempt.status === HTTP_RATE_LIMITED,
      )
    ) {
      break;
    }
  }
  return sent;
}

async function recoverThroughHttpClient(url: string, token: string): Promise<number[]> {
  const { httpClientRaw } = await freshHttpClient();
  return Promise.all(
    Array.from({ length: RECOVERY_REQUESTS }, async () => {
      const response = await httpClientRaw(url, {
        headers: { "X-Figma-Token": token, [PROBE_HEADER]: RECOVERY_CLIENT },
      });
      await response.arrayBuffer();
      return response.status;
    }),
  );
}

function countByStatus(attempts: Attempt[]): Record<number, number> {
  return attempts.reduce<Record<number, number>>((counts, attempt) => {
    counts[attempt.status] = (counts[attempt.status] ?? 0) + 1;
    return counts;
  }, {});
}

describe.skipIf(process.env.RUN_FIGMA_RATE_LIMIT_PROBE !== "1")("live 429 handling", () => {
  const attempts: Attempt[] = [];
  const token = process.env.FIGMA_API_KEY || "";
  const fileKey = process.env.FIGMA_FILE_KEY || "";

  beforeAll(() => {
    vi.stubGlobal("fetch", recordAttempts(globalThis.fetch, attempts));
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it(
    "gets 429s from the real quota, waits Retry-After, retries, and succeeds",
    async () => {
      if (!token || !fileKey) throw new Error("FIGMA_API_KEY and FIGMA_FILE_KEY are required");
      const url = `https://api.figma.com/v1/files/${fileKey}/components`;

      const burstRequests = await burstUntilRateLimited(url, token, attempts);
      const statuses = await recoverThroughHttpClient(url, token);

      const recoveryAttempts = attempts.filter((attempt) => attempt.client === RECOVERY_CLIENT);
      const rateLimited = attempts.filter((attempt) => attempt.status === HTTP_RATE_LIMITED);
      console.log(
        `Burst requests: ${burstRequests}; attempts: ${attempts.length}, ` +
          `by status: ${JSON.stringify(countByStatus(attempts))}, 429s: ${rateLimited.length}, ` +
          `our 429s: ${recoveryAttempts.filter((attempt) => attempt.status === HTTP_RATE_LIMITED).length}, ` +
          `Retry-After seconds: ${rateLimited.map((attempt) => (attempt.retryAfterMs ?? 0) / SECONDS_TO_MS).join(", ")}`,
      );

      expect(
        rateLimited.length,
        "the burst never got a 429; raise FIGMA_PROBE_MAX_BURST_REQUESTS",
      ).toBeGreaterThan(0);

      const ourRateLimited = recoveryAttempts.filter(
        (attempt) => attempt.status === HTTP_RATE_LIMITED,
      );
      expect(
        ourRateLimited.length,
        "our client never saw a 429 while the quota was exhausted",
      ).toBeGreaterThan(0);

      for (const limited of ourRateLimited) {
        const retry = recoveryAttempts[recoveryAttempts.indexOf(limited) + 1];
        expect(retry, "no retry after our 429").toBeDefined();
        expect((retry?.startedAt ?? 0) - limited.startedAt).toBeGreaterThanOrEqual(
          limited.retryAfterMs ?? 0,
        );
      }

      expect(statuses.length, "every recovery request completed").toBe(RECOVERY_REQUESTS);
      expect(
        statuses.filter((status) => status !== HTTP_OK),
        "final statuses are all 200",
      ).toEqual([]);
    },
    PROBE_TIMEOUT_MS,
  );
});
