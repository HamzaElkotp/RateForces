import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FixedWindowRateLimiter } from "./rate-limit.js";

describe("FixedWindowRateLimiter", () => {
  it("allows up to the configured limit and returns a retry delay", () => {
    const limiter = new FixedWindowRateLimiter();
    assert.deepEqual(limiter.consume("owner", 2, 60_000, 100), { allowed: true, retryAfterMs: 0 });
    assert.deepEqual(limiter.consume("owner", 2, 60_000, 200), { allowed: true, retryAfterMs: 0 });
    assert.deepEqual(limiter.consume("owner", 2, 60_000, 300), { allowed: false, retryAfterMs: 59_800 });
  });

  it("isolates keys and resets windows at their deadline", () => {
    const limiter = new FixedWindowRateLimiter();
    limiter.consume("owner-a", 1, 100, 1000);
    assert.equal(limiter.consume("owner-b", 1, 100, 1000).allowed, true);
    assert.equal(limiter.consume("owner-a", 1, 100, 1100).allowed, true);
  });
});
