/**
 * Small in-memory sliding-window rate limiter. Suitable for a single-process
 * deployment (which this app is, by design). Windows are pruned lazily.
 */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  private lastSweep = Date.now();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Returns true if the action is allowed, false if rate-limited. */
  check(key: string, nowMs = Date.now()): boolean {
    this.sweep(nowMs);
    const cutoff = nowMs - this.windowMs;
    const list = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (list.length >= this.max) {
      this.hits.set(key, list);
      return false;
    }
    list.push(nowMs);
    this.hits.set(key, list);
    return true;
  }

  /** Seconds until the oldest hit leaves the window (for Retry-After). */
  retryAfterSeconds(key: string, nowMs = Date.now()): number {
    const list = this.hits.get(key) ?? [];
    if (list.length === 0) return 0;
    const oldest = Math.min(...list);
    return Math.max(1, Math.ceil((oldest + this.windowMs - nowMs) / 1000));
  }

  private sweep(nowMs: number): void {
    if (nowMs - this.lastSweep < this.windowMs) return;
    this.lastSweep = nowMs;
    const cutoff = nowMs - this.windowMs;
    for (const [key, list] of this.hits) {
      const kept = list.filter((t) => t > cutoff);
      if (kept.length === 0) this.hits.delete(key);
      else this.hits.set(key, kept);
    }
  }
}
