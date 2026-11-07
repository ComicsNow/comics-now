/**
 * Unit tests for DomainRateLimiter in reading-orders-limiter.js
 */
const { DomainRateLimiter } = require('../server/services/reading-orders-limiter');

describe('DomainRateLimiter', () => {
  it('enforces delay between requests with jitter', async () => {
    const limiter = new DomainRateLimiter(50, 10, 20); // 50ms min delay, 10-20ms jitter
    const start = Date.now();
    await limiter.waitForNextSlot();
    await limiter.waitForNextSlot();
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(55); // 50 + at least 10ms jitter
  });

  it('tracks success and resets consecutive error count', () => {
    const limiter = new DomainRateLimiter();
    limiter.recordError();
    limiter.recordError();
    expect(limiter.consecutiveErrors).toBe(2);
    limiter.recordSuccess();
    expect(limiter.consecutiveErrors).toBe(0);
  });

  it('trips circuit breaker after max consecutive errors', async () => {
    const limiter = new DomainRateLimiter(10, 0, 0, 3); // max 3 errors
    limiter.recordError();
    limiter.recordError();
    limiter.recordError();
    await expect(limiter.waitForNextSlot()).rejects.toThrow(/circuit breaker/i);
  });

  it('reports cooldown via callback when throttled', async () => {
    const limiter = new DomainRateLimiter(60, 10, 10);
    await limiter.waitForNextSlot();
    let cooldownReported = null;
    await limiter.waitForNextSlot((waitMs) => {
      cooldownReported = waitMs;
    });
    expect(cooldownReported).toBeGreaterThan(0);
  });
});
