import { prisma } from '../../db/prisma.js';
import { createRedisConnection } from '../../queue/connection.js';

export async function checkReadiness() {
  const redis = createRedisConnection();
  try {
    await Promise.all([prisma.$queryRaw`SELECT 1`, redis.ping()]);
    return { status: 'ok' as const };
  } finally {
    await redis.quit().catch(() => undefined);
  }
}
