const BUDGET_WINDOW_MS = 60_000;

export const FIGMA_TIER = { ONE: "tier1", TWO: "tier2", THREE: "tier3" } as const;
export type FigmaTier = (typeof FIGMA_TIER)[keyof typeof FIGMA_TIER];

/** Requests per minute for Professional Dev/Full seats (see README). */
export const TIER_BUDGET_PER_MINUTE: Record<FigmaTier, number> = {
  [FIGMA_TIER.ONE]: 10,
  [FIGMA_TIER.TWO]: 25,
  [FIGMA_TIER.THREE]: 50,
};

const TIER_THREE_PATHS = [
  /^\/v1\/components\//,
  /^\/v1\/component_sets\//,
  /^\/v1\/styles\//,
  /^\/v1\/files\/[^/]+\/(components|component_sets|styles)$/,
];
const TIER_TWO_PATHS = [
  /^\/v1\/files\/[^/]+\/variables\//,
  /^\/v1\/files\/[^/]+\/(comments|images)$/,
];

/** Endpoints not listed in a higher tier fall back to tier 1, the strictest budget. */
export function figmaTierForUrl(url: string): FigmaTier {
  const { pathname } = new URL(url);
  if (TIER_THREE_PATHS.some((pattern) => pattern.test(pathname))) return FIGMA_TIER.THREE;
  if (TIER_TWO_PATHS.some((pattern) => pattern.test(pathname))) return FIGMA_TIER.TWO;
  return FIGMA_TIER.ONE;
}

export type FigmaRateClock = {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
};

export const SYSTEM_CLOCK: FigmaRateClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

type TierState = {
  tier: FigmaTier;
  chain: Promise<void>;
  sentAt: number[];
  pausedUntil: number;
};

/**
 * Paces Figma requests per tier. Requests within a tier run one at a time and
 * never exceed that tier's budget in any rolling minute; a 429 pauses only its tier.
 */
export class FigmaRateLimiter {
  private readonly tiers = new Map<FigmaTier, TierState>();
  private readonly clock: FigmaRateClock;
  private readonly budgetPerMinute: Record<FigmaTier, number>;

  constructor(
    clock: FigmaRateClock = SYSTEM_CLOCK,
    budgetPerMinute: Record<FigmaTier, number> = TIER_BUDGET_PER_MINUTE,
  ) {
    this.clock = clock;
    this.budgetPerMinute = budgetPerMinute;
  }

  run<T>(url: string, send: () => Promise<T>): Promise<T> {
    const state = this.stateFor(figmaTierForUrl(url));
    const result = state.chain.then(async () => {
      await this.reserveSlot(state);
      return send();
    });
    state.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  pause(url: string, durationMs: number): void {
    const state = this.stateFor(figmaTierForUrl(url));
    state.pausedUntil = Math.max(state.pausedUntil, this.clock.now() + durationMs);
  }

  reset(): void {
    this.tiers.clear();
  }

  private stateFor(tier: FigmaTier): TierState {
    const existing = this.tiers.get(tier);
    if (existing) return existing;
    const created: TierState = { tier, chain: Promise.resolve(), sentAt: [], pausedUntil: 0 };
    this.tiers.set(tier, created);
    return created;
  }

  private async reserveSlot(state: TierState): Promise<void> {
    let waitMs = this.delayBeforeSendMs(state);
    while (waitMs > 0) {
      await this.clock.sleep(waitMs);
      waitMs = this.delayBeforeSendMs(state);
    }
    state.sentAt.push(this.clock.now());
  }

  private delayBeforeSendMs(state: TierState): number {
    const now = this.clock.now();
    state.sentAt = state.sentAt.filter((sentAt) => sentAt > now - BUDGET_WINDOW_MS);
    const budget = this.budgetPerMinute[state.tier];
    const budgetDelayMs =
      state.sentAt.length < budget
        ? 0
        : state.sentAt[state.sentAt.length - budget] + BUDGET_WINDOW_MS - now;
    return Math.max(0, state.pausedUntil - now, budgetDelayMs);
  }
}

export const figmaRateLimiter = new FigmaRateLimiter();
