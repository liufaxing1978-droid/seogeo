import { describe, expect, it } from 'vitest';
import {
  RedisLoginAttemptLimiter,
  loginLimiterKey,
} from '../../src/auth/login-attempt-limiter.js';

class FakeRedis {
  readonly counts = new Map<string, number>();
  readonly expiries = new Map<string, number>();

  async get(key: string) {
    const count = this.counts.get(key);
    return count === undefined ? null : String(count);
  }

  async eval(_script: string, _numberOfKeys: number, key: string, ttlSeconds: string) {
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    if (next === 1) this.expiries.set(key, Number(ttlSeconds));
    return next;
  }

  async del(key: string) {
    const existed = this.counts.delete(key);
    this.expiries.delete(key);
    return existed ? 1 : 0;
  }
}

class FailingRedis {
  async get() {
    throw new Error('redis unavailable');
  }

  async eval() {
    throw new Error('redis unavailable');
  }

  async del() {
    throw new Error('redis unavailable');
  }
}

describe('P10-A Redis login throttling', () => {
  it('hashes normalized email and connection-derived source IP into a non-plaintext key', () => {
    const key = loginLimiterKey('owner@example.com', '203.0.113.8');

    expect(key).toMatch(/^auth:login:[a-f0-9]{64}$/);
    expect(key).toBe(loginLimiterKey('owner@example.com', '203.0.113.8'));
    expect(key).not.toContain('owner@example.com');
    expect(key).not.toContain('203.0.113.8');
  });

  it('blocks after ten failures in one 15-minute fixed window and clear resets it', async () => {
    const redis = new FakeRedis();
    const limiter = new RedisLoginAttemptLimiter(redis as never);
    const key = loginLimiterKey('owner@example.com', '203.0.113.8');

    await limiter.assertAllowed(key);
    for (let attempt = 1; attempt <= 9; attempt += 1) {
      await limiter.recordFailure(key);
      await limiter.assertAllowed(key);
    }

    await limiter.recordFailure(key);
    expect(redis.expiries.get(key)).toBe(900);
    await expect(limiter.assertAllowed(key)).rejects.toMatchObject({
      status: 429,
      code: 'LOGIN_RATE_LIMITED',
    });

    await limiter.clear(key);
    await expect(limiter.assertAllowed(key)).resolves.toBeUndefined();
  });

  it('fails closed with 503 when the Redis backend is unavailable', async () => {
    const limiter = new RedisLoginAttemptLimiter(new FailingRedis() as never);
    const key = loginLimiterKey('owner@example.com', '203.0.113.8');

    await expect(limiter.assertAllowed(key)).rejects.toMatchObject({
      status: 503,
      code: 'AUTH_RATE_LIMITER_UNAVAILABLE',
    });
    await expect(limiter.recordFailure(key)).rejects.toMatchObject({
      status: 503,
      code: 'AUTH_RATE_LIMITER_UNAVAILABLE',
    });
    await expect(limiter.clear(key)).rejects.toMatchObject({
      status: 503,
      code: 'AUTH_RATE_LIMITER_UNAVAILABLE',
    });
  });
});
