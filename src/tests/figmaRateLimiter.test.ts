import { describe, it, expect } from "vitest";
import {
  FIGMA_TIER,
  FigmaRateLimiter,
  TIER_BUDGET_PER_MINUTE,
  figmaTierForUrl,
  type FigmaRateClock,
} from "~/utils/figmaRateLimiter";

const API_ROOT = "https://api.figma.com/v1";
const TIER_ONE_URL = `${API_ROOT}/files/abc/nodes?ids=1:2`;
const TIER_TWO_URL = `${API_ROOT}/files/abc/variables/local`;
const TIER_THREE_URL = `${API_ROOT}/components/key1`;
const MINUTE_MS = 60_000;

type FakeClock = FigmaRateClock & { time: number; sleeps: number[] };

function fakeClock(): FakeClock {
  const clock: FakeClock = {
    time: 0,
    sleeps: [],
    now: () => clock.time,
    sleep: async (ms) => {
      clock.sleeps.push(ms);
      clock.time += ms;
    },
  };
  return clock;
}

function recordingSend(clock: FakeClock) {
  const sentAt: number[] = [];
  const send = async () => {
    sentAt.push(clock.time);
  };
  return { sentAt, send };
}

describe("figmaTierForUrl", () => {
  it.each([
    [TIER_THREE_URL, FIGMA_TIER.THREE],
    [`${API_ROOT}/files/abc/components`, FIGMA_TIER.THREE],
    [`${API_ROOT}/files/abc/styles`, FIGMA_TIER.THREE],
    [TIER_TWO_URL, FIGMA_TIER.TWO],
    [`${API_ROOT}/files/abc/comments`, FIGMA_TIER.TWO],
    [`${API_ROOT}/files/abc/images`, FIGMA_TIER.TWO],
    [TIER_ONE_URL, FIGMA_TIER.ONE],
    [`${API_ROOT}/files/abc`, FIGMA_TIER.ONE],
    [`${API_ROOT}/images/abc?ids=1:2`, FIGMA_TIER.ONE],
    [`${API_ROOT}/unknown/endpoint`, FIGMA_TIER.ONE],
  ])("classifies %s as %s", (url, tier) => {
    expect(figmaTierForUrl(url)).toBe(tier);
  });
});

describe("FigmaRateLimiter", () => {
  it("keeps a tier within its budget for any rolling minute", async () => {
    const clock = fakeClock();
    const budget = { ...TIER_BUDGET_PER_MINUTE, [FIGMA_TIER.ONE]: 2 };
    const limiter = new FigmaRateLimiter(clock, budget);
    const { sentAt, send } = recordingSend(clock);
    await Promise.all([
      limiter.run(TIER_ONE_URL, send),
      limiter.run(TIER_ONE_URL, send),
      limiter.run(TIER_ONE_URL, send),
    ]);
    expect(sentAt).toEqual([0, 0, MINUTE_MS]);
  });

  it("counts only the calls made within the last minute", async () => {
    const clock = fakeClock();
    const budget = { ...TIER_BUDGET_PER_MINUTE, [FIGMA_TIER.ONE]: 2 };
    const limiter = new FigmaRateLimiter(clock, budget);
    const { sentAt, send } = recordingSend(clock);
    await limiter.run(TIER_ONE_URL, send);
    clock.time = 30_000;
    await limiter.run(TIER_ONE_URL, send);
    await limiter.run(TIER_ONE_URL, send);
    expect(sentAt).toEqual([0, 30_000, MINUTE_MS]);
  });

  it("runs one request at a time within a tier", async () => {
    const limiter = new FigmaRateLimiter(fakeClock());
    let inFlight = 0;
    let maxInFlight = 0;
    const send = async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
    };
    await Promise.all([1, 2, 3].map(() => limiter.run(TIER_TWO_URL, send)));
    expect(maxInFlight).toBe(1);
  });

  it("pauses only the tier that was rate limited", async () => {
    const clock = fakeClock();
    const limiter = new FigmaRateLimiter(clock);
    const { sentAt, send } = recordingSend(clock);
    limiter.pause(TIER_ONE_URL, 45_000);
    await limiter.run(TIER_TWO_URL, send);
    expect(clock.sleeps).toEqual([]);
    await limiter.run(TIER_ONE_URL, send);
    expect(clock.sleeps).toEqual([45_000]);
    expect(sentAt).toEqual([0, 45_000]);
  });
});
