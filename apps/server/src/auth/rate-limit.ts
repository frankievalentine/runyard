/**
 * Counts failures per key in a sliding window and blocks a key once it has
 * `max` of them. In memory: a restart clears it, which is acceptable for a
 * single-process service.
 */
export class FailureLimiter {
  private failures = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  blocked(key: string, now = Date.now()): boolean {
    return this.recent(key, now).length >= this.max;
  }

  fail(key: string, now = Date.now()) {
    this.failures.set(key, [...this.recent(key, now), now]);
  }

  reset(key: string) {
    this.failures.delete(key);
  }

  private recent(key: string, now: number) {
    const recent = (this.failures.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (recent.length === 0) this.failures.delete(key);
    return recent;
  }
}
