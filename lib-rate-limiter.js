class MemoryRateLimiter {
  constructor() {
    this.buckets = new Map();
  }

  take(key, rule) {
    const now = Date.now();
    const bucket = (this.buckets.get(key) || []).filter((timestamp) => now - timestamp < rule.windowMs);

    if (bucket.length >= rule.max) {
      this.buckets.set(key, bucket);
      return {
        allowed: false,
        retryAfterMs: rule.windowMs - (now - bucket[0])
      };
    }

    bucket.push(now);
    this.buckets.set(key, bucket);

    return {
      allowed: true,
      retryAfterMs: 0
    };
  }
}

module.exports = {
  MemoryRateLimiter
};
