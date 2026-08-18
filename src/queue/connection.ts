import { Redis } from 'ioredis';
import { env } from '../config/env.js';

export function createRedisConnection(): Redis {
  return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
}
