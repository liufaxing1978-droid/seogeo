import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { prisma } from '../db/prisma.js';

export const SESSION_COOKIE_NAME = 'seogeo_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function hashSessionToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function createSessionToken(): { rawToken: string; tokenHash: string } {
  const rawToken = randomBytes(32).toString('base64url');
  return {
    rawToken,
    tokenHash: hashSessionToken(rawToken),
  };
}

export interface ActiveSessionIdentity {
  id: string;
  userId: string;
  tokenHash: string;
}

export class SessionRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  create(userId: string, tokenHash: string, expiresAt: Date) {
    return this.client.userSession.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
      },
    });
  }

  findActiveByTokenHash(
    tokenHash: string,
    now: Date,
  ): Promise<ActiveSessionIdentity | null> {
    return this.client.userSession.findFirst({
      where: {
        tokenHash,
        revokedAt: null,
        expiresAt: { gt: now },
        user: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        userId: true,
        tokenHash: true,
      },
    });
  }

  revoke(sessionId: string, at: Date) {
    return this.client.userSession.updateMany({
      where: {
        id: sessionId,
        revokedAt: null,
      },
      data: { revokedAt: at },
    });
  }

  revokeAllForUser(userId: string, at: Date) {
    return this.client.userSession.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: { revokedAt: at },
    });
  }
}
