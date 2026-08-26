import { createHash } from 'node:crypto';
import { AppError } from '../core/errors.js';

const LOGIN_FAILURE_LIMIT = 10;
const LOGIN_WINDOW_SECONDS = 15 * 60;

const RECORD_FAILURE_LUA = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
return count
`;

export interface LoginAttemptLimiter {
  assertAllowed(key: string): Promise<void>;
  recordFailure(key: string): Promise<void>;
  clear(key: string): Promise<void>;
}

export interface LoginAttemptRedis {
  get(key: string): Promise<string | null>;
  eval(
    script: string,
    numberOfKeys: number,
    key: string,
    ttlSeconds: string,
  ): Promise<unknown>;
  del(key: string): Promise<number>;
}

export function loginLimiterKey(normalizedEmail: string, sourceIp: string): string {
  const digest = createHash('sha256')
    .update(`${normalizedEmail}\n${sourceIp}`, 'utf8')
    .digest('hex');
  return `auth:login:${digest}`;
}

function backendUnavailable(): AppError {
  return new AppError(
    'Authentication rate limiter unavailable',
    503,
    'AUTH_RATE_LIMITER_UNAVAILABLE',
  );
}

export class RedisLoginAttemptLimiter implements LoginAttemptLimiter {
  constructor(private readonly redis: LoginAttemptRedis) {}

  async assertAllowed(key: string): Promise<void> {
    let rawCount: string | null;
    try {
      rawCount = await this.redis.get(key);
    } catch {
      throw backendUnavailable();
    }

    const count = rawCount === null ? 0 : Number.parseInt(rawCount, 10);
    if (Number.isFinite(count) && count >= LOGIN_FAILURE_LIMIT) {
      throw new AppError('Too many login attempts', 429, 'LOGIN_RATE_LIMITED');
    }
  }

  async recordFailure(key: string): Promise<void> {
    try {
      await this.redis.eval(
        RECORD_FAILURE_LUA,
        1,
        key,
        String(LOGIN_WINDOW_SECONDS),
      );
    } catch {
      throw backendUnavailable();
    }
  }

  async clear(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch {
      throw backendUnavailable();
    }
  }
}
