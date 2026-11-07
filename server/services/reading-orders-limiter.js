/**
 * Domain Rate Limiter & Politeness Engine
 *
 * Implements per-domain request pacing, randomized anti-bot jitter,
 * adaptive backoff, and circuit-breaker defense.
 */

class DomainRateLimiter {
  constructor(minDelayMs = 1200, minJitterMs = 150, maxJitterMs = 350, maxConsecutiveErrors = 5) {
    this.minDelayMs = minDelayMs;
    this.minJitterMs = minJitterMs;
    this.maxJitterMs = maxJitterMs;
    this.maxConsecutiveErrors = maxConsecutiveErrors;
    this.lastRequestTime = 0;
    this.consecutiveErrors = 0;
  }

  async waitForNextSlot(onCooldown) {
    if (this.consecutiveErrors >= this.maxConsecutiveErrors) {
      throw new Error(`Circuit breaker tripped: ${this.consecutiveErrors} consecutive rate limit or server errors.`);
    }

    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    const jitterRange = Math.max(0, this.maxJitterMs - this.minJitterMs);
    const jitter = Math.floor(Math.random() * (jitterRange + 1)) + this.minJitterMs;

    if (elapsed < this.minDelayMs) {
      const waitTime = (this.minDelayMs - elapsed) + jitter;
      if (typeof onCooldown === 'function') {
        onCooldown(waitTime);
      }
      await new Promise((r) => setTimeout(r, waitTime));
    } else if (jitter > 0) {
      // Even if elapsed >= minDelayMs, sleep small jitter to randomize cadence
      await new Promise((r) => setTimeout(r, jitter));
    }

    this.lastRequestTime = Date.now();
  }

  recordSuccess() {
    this.consecutiveErrors = 0;
  }

  recordError() {
    this.consecutiveErrors += 1;
  }

  reset() {
    this.consecutiveErrors = 0;
    this.lastRequestTime = 0;
  }
}

module.exports = {
  DomainRateLimiter,
};
