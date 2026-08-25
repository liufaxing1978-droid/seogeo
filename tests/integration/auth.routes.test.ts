import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { authenticationMiddleware } from '../../src/auth/authentication.js';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { normalizeEmail } from '../../src/auth/email.js';
import type { LoginAttemptLimiter } from '../../src/auth/login-attempt-limiter.js';
import { passwordHasher } from '../../src/auth/password.js';
import { createAuthRoutes } from '../../src/auth/auth.routes.js';
import { env } from '../../src/config/env.js';
import { errorHandler } from '../../src/core/http.js';
import { prisma } from '../../src/db/prisma.js';
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  SessionRepository,
  createSessionToken,
} from '../../src/auth/session.repository.js';

const TEST_HOST = 'auth.example.test';
const TEST_ORIGIN = `http://${TEST_HOST}`;
const CURRENT_PASSWORD = 'correct horse battery staple';
const NEW_PASSWORD = 'new correct horse battery staple';

class FakeLoginAttemptLimiter implements LoginAttemptLimiter {
  readonly asserted: string[] = [];
  readonly failures: string[] = [];
  readonly cleared: string[] = [];

  async assertAllowed(key: string): Promise<void> {
    this.asserted.push(key);
  }

  async recordFailure(key: string): Promise<void> {
    this.failures.push(key);
  }

  async clear(key: string): Promise<void> {
    this.cleared.push(key);
  }
}

function createTestApp(limiter = new FakeLoginAttemptLimiter()) {
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', new URL('../../src/views', import.meta.url).pathname);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(authenticationMiddleware);
  app.use('/auth', createAuthRoutes({ loginAttemptLimiter: limiter }));
  app.use(errorHandler);
  return { app, limiter };
}

async function createUser(options: { status?: 'ACTIVE' | 'DISABLED' } = {}) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const email = `auth-route-${suffix}@example.com`;
  const user = await prisma.user.create({
    data: {
      email,
      normalizedEmail: normalizeEmail(email),
      passwordHash: await passwordHasher.hash(CURRENT_PASSWORD),
      status: options.status ?? 'ACTIVE',
    },
  });
  return user;
}

async function createSession(userId: string) {
  const token = createSessionToken();
  const session = await new SessionRepository().create(
    userId,
    token.tokenHash,
    new Date(Date.now() + SESSION_TTL_MS),
  );
  return {
    session,
    rawToken: token.rawToken,
    cookie: `${SESSION_COOKIE_NAME}=${token.rawToken}`,
    csrf: deriveCsrfToken(env.SESSION_SECRET, session.id, token.tokenHash),
  };
}

const createdUserIds: string[] = [];

afterEach(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds.splice(0) } } });
  }
});

describe('P10-A authentication HTTP routes', () => {
  it('renders the local login page', async () => {
    const { app } = createTestApp();
    const response = await request(app).get('/auth/login');

    expect(response.status).toBe(200);
    expect(response.text).toContain('action="/auth/login"');
    expect(response.text).toContain('name="email"');
    expect(response.text).toContain('name="password"');
  });

  it.each([
    ['nonexistent email', 'missing@example.com', CURRENT_PASSWORD, undefined],
    ['wrong password', undefined, 'definitely-wrong-password', 'ACTIVE' as const],
    ['disabled user', undefined, CURRENT_PASSWORD, 'DISABLED' as const],
  ])('returns the same bounded INVALID_CREDENTIALS response for %s', async (_label, explicitEmail, password, status) => {
    let email = explicitEmail;
    if (!email) {
      const user = await createUser({ status });
      createdUserIds.push(user.id);
      email = user.email;
    }

    const { app, limiter } = createTestApp();
    const response = await request(app)
      .post('/auth/login')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .send({ email, password });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      error: { code: 'INVALID_CREDENTIALS' },
    });
    expect(limiter.asserted).toHaveLength(1);
    expect(limiter.failures).toHaveLength(1);
    expect(limiter.cleared).toHaveLength(0);
  });

  it('rejects a cross-origin login before rate limiting or credential verification', async () => {
    const user = await createUser();
    createdUserIds.push(user.id);
    const { app, limiter } = createTestApp();

    const response = await request(app)
      .post('/auth/login')
      .set('Host', TEST_HOST)
      .set('Origin', 'https://attacker.example')
      .send({ email: user.email, password: CURRENT_PASSWORD });

    expect(response.status).toBe(403);
    expect(limiter.asserted).toHaveLength(0);
    expect(limiter.failures).toHaveLength(0);
    expect(limiter.cleared).toHaveLength(0);
  });

  it('creates a fresh seven-day session and hardened cookie on valid login', async () => {
    const user = await createUser();
    createdUserIds.push(user.id);
    const oldSession = await createSession(user.id);
    const { app, limiter } = createTestApp();

    const before = Date.now();
    const response = await request(app)
      .post('/auth/login')
      .set('Host', TEST_HOST)
      .set('Origin', TEST_ORIGIN)
      .set('Cookie', oldSession.cookie)
      .send({ email: `  ${user.email.toUpperCase()}  `, password: CURRENT_PASSWORD, returnPath: '/projects' });
    const after = Date.now();

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(400);
    const cookie = response.headers['set-cookie']?.[0] ?? '';
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=604800');
    expect(cookie).not.toContain(oldSession.rawToken);
    expect(limiter.cleared).toHaveLength(1);

    const sessions = await prisma.userSession.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.id).toBe(oldSession.session.id);
    expect(sessions[1]?.tokenHash).not.toBe(oldSession.session.tokenHash);
    expect(sessions[1]?.expiresAt.getTime()).toBeGreaterThanOrEqual(before + SESSION_TTL_MS - 1_000);
    expect(sessions[1]?.expiresAt.getTime()).toBeLessThanOrEqual(after + SESSION_TTL_MS + 1_000);
  });

  it('returns only bounded current user/session data and a derived CSRF token', async () => {
    const user = await createUser();
    createdUserIds.push(user.id);
    const auth = await createSession(user.id);
    const { app } = createTestApp();

    const response = await request(app)
      .get('/auth/session')
      .set('Cookie', auth.cookie);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: {
        user: {
          id: user.id,
          email: user.email,
          displayName: null,
        },
        session: {
          id: auth.session.id,
          expiresAt: auth.session.expiresAt.toISOString(),
        },
        csrfToken: auth.csrf,
      },
    });
    expect(JSON.stringify(response.body)).not.toContain(auth.rawToken);
    expect(JSON.stringify(response.body)).not.toContain(auth.session.tokenHash);
    expect(JSON.stringify(response.body)).not.toContain(user.passwordHash);
  });

  it('requires authentication and CSRF for logout, then revokes only the current session and clears its cookie', async () => {
    const { app } = createTestApp();
    expect((await request(app).post('/auth/logout')).status).toBe(401);

    const user = await createUser();
    createdUserIds.push(user.id);
    const current = await createSession(user.id);
    const other = await createSession(user.id);

    expect((await request(app).post('/auth/logout').set('Cookie', current.cookie)).status).toBe(403);

    const response = await request(app)
      .post('/auth/logout')
      .set('Cookie', current.cookie)
      .set('X-CSRF-Token', current.csrf);

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(400);
    const rows = await prisma.userSession.findMany({
      where: { id: { in: [current.session.id, other.session.id] } },
      orderBy: { id: 'asc' },
    });
    const currentRow = rows.find((row) => row.id === current.session.id);
    const otherRow = rows.find((row) => row.id === other.session.id);
    expect(currentRow?.revokedAt).not.toBeNull();
    expect(otherRow?.revokedAt).toBeNull();
    expect(response.headers['set-cookie']?.join(';') ?? '').toContain(`${SESSION_COOKIE_NAME}=`);
    expect(response.headers['set-cookie']?.join(';') ?? '').toMatch(/Max-Age=0|Expires=/);
  });

  it('requires authentication + CSRF for password change and revokes every active session', async () => {
    const { app } = createTestApp();
    expect((await request(app).post('/auth/password/change')).status).toBe(401);

    const user = await createUser();
    createdUserIds.push(user.id);
    const current = await createSession(user.id);
    const other = await createSession(user.id);

    expect((await request(app)
      .post('/auth/password/change')
      .set('Cookie', current.cookie)
      .send({ currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD })).status).toBe(403);

    const response = await request(app)
      .post('/auth/password/change')
      .set('Cookie', current.cookie)
      .set('X-CSRF-Token', current.csrf)
      .send({ currentPassword: CURRENT_PASSWORD, newPassword: NEW_PASSWORD });

    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(400);

    const refreshedUser = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(refreshedUser.passwordHash).not.toBe(user.passwordHash);
    expect(refreshedUser.passwordHashVersion).toBe(1);
    await expect(passwordHasher.verify(NEW_PASSWORD, refreshedUser.passwordHash)).resolves.toBe(true);

    const sessions = await prisma.userSession.findMany({
      where: { id: { in: [current.session.id, other.session.id] } },
    });
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);

    expect((await request(app).get('/auth/session').set('Cookie', current.cookie)).status).toBe(401);
  });
});
