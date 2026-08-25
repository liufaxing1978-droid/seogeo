import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { errorHandler } from '../../src/core/http.js';
import {
  authenticationMiddleware,
  requireAuthentication,
} from '../../src/auth/authentication.js';
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
} from '../../src/auth/session.repository.js';

const createdUserIds: string[] = [];

function createProbeApp() {
  const app = express();
  app.use(express.json());
  app.use(authenticationMiddleware);
  app.get('/probe', requireAuthentication(), (req, res) => {
    res.json({ auth: req.auth });
  });
  app.use(errorHandler);
  return app;
}

async function seedSession(options: {
  userStatus?: 'ACTIVE' | 'DISABLED';
  expiresAt?: Date;
  revokedAt?: Date | null;
} = {}) {
  const suffix = `${Date.now()}-${Math.random()}`;
  const user = await prisma.user.create({
    data: {
      email: `session-${suffix}@example.com`,
      normalizedEmail: `session-${suffix}@example.com`,
      passwordHash: 'test-only-hash',
      status: options.userStatus ?? 'ACTIVE',
    },
  });
  createdUserIds.push(user.id);

  const token = createSessionToken();
  const session = await prisma.userSession.create({
    data: {
      userId: user.id,
      tokenHash: token.tokenHash,
      expiresAt: options.expiresAt ?? new Date(Date.now() + 60_000),
      revokedAt: options.revokedAt ?? null,
    },
  });

  return {
    user,
    session,
    rawToken: token.rawToken,
    cookie: `${SESSION_COOKIE_NAME}=${token.rawToken}`,
  };
}

afterEach(async () => {
  while (createdUserIds.length > 0) {
    const userId = createdUserIds.pop()!;
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
});

describe('trusted session authentication', () => {
  it('resolves a valid opaque cookie to the stable user/session identity', async () => {
    const seeded = await seedSession();

    const response = await request(createProbeApp())
      .get('/probe')
      .set('Cookie', seeded.cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      auth: {
        userId: seeded.user.id,
        sessionId: seeded.session.id,
      },
    });
    expect(seeded.session.tokenHash).not.toBe(seeded.rawToken);
  });

  it.each([
    ['missing cookie', async () => undefined],
    ['expired session', async () => seedSession({ expiresAt: new Date(Date.now() - 1_000) })],
    ['revoked session', async () => seedSession({ revokedAt: new Date() })],
    ['disabled user', async () => seedSession({ userStatus: 'DISABLED' })],
  ])('fails closed for %s', async (_label, seed) => {
    const seeded = await seed();
    const call = request(createProbeApp()).get('/probe');
    if (seeded) call.set('Cookie', seeded.cookie);

    const response = await call;

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('does not trust actor/user identity from headers, authorization, or query parameters', async () => {
    const response = await request(createProbeApp())
      .get('/probe?userId=00000000-0000-0000-0000-000000000001')
      .set('X-User-Id', '00000000-0000-0000-0000-000000000001')
      .set('X-Actor-Id', 'spoofed-actor')
      .set('Authorization', 'Bearer spoofed-local-user');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });

  it('keeps authenticated GET request-pure for UserSession and security audit persistence', async () => {
    const seeded = await seedSession();
    const beforeSession = await prisma.userSession.findUniqueOrThrow({ where: { id: seeded.session.id } });
    const beforeAuditCount = await prisma.securityAuditEvent.count({
      where: { targetUserId: seeded.user.id },
    });

    const response = await request(createProbeApp())
      .get('/probe')
      .set('Cookie', seeded.cookie);

    expect(response.status).toBe(200);

    const afterSession = await prisma.userSession.findUniqueOrThrow({ where: { id: seeded.session.id } });
    const afterAuditCount = await prisma.securityAuditEvent.count({
      where: { targetUserId: seeded.user.id },
    });

    expect(afterSession).toEqual(beforeSession);
    expect(afterAuditCount).toBe(beforeAuditCount);
  });
});
