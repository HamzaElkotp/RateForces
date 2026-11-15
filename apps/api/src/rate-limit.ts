type Window = { count: number; resetsAt: number };

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, Window>();

  consume(key: string, limit: number, windowMs: number, now = Date.now()): { allowed: boolean; retryAfterMs: number } {
    let current = this.windows.get(key);
    if (!current || current.resetsAt <= now) {
      current = { count: 0, resetsAt: now + windowMs };
      this.windows.set(key, current);
    }
    if (current.count >= limit) return { allowed: false, retryAfterMs: current.resetsAt - now };
    current.count += 1;
    if (this.windows.size > 10_000) {
      for (const [entryKey, entry] of this.windows) if (entry.resetsAt <= now) this.windows.delete(entryKey);
    }
    return { allowed: true, retryAfterMs: 0 };
  }
}
