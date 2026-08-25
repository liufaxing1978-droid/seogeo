import { Router, type Request, type Response } from 'express';
import { env } from '../config/env.js';
import { AppError, ValidationError } from '../core/errors.js';
import { prisma } from '../db/prisma.js';
import { createRedisConnection } from '../queue/connection.js';
import { requireAuthentication } from './authentication.js';
import { deriveCsrfToken, requireCsrf } from './csrf.js';
import { normalizeEmail } from './email.js';
import {
  RedisLoginAttemptLimiter,
  loginLimiterKey,
  type LoginAttemptLimiter,
} from './login-attempt-limiter.js';
import { passwordHasher } from './password.js';
import { SecurityAuditRepository } from './security-audit.repository.js';
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  createSessionToken,
} from './session.repository.js';

export interface AuthRoutesOptions {
  loginAttemptLimiter?: LoginAttemptLimiter;
}

let sharedProductionLimiter: LoginAttemptLimiter | null = null;

function getProductionLoginAttemptLimiter(): LoginAttemptLimiter {
  if (!sharedProductionLimiter) {
    sharedProductionLimiter = new RedisLoginAttemptLimiter(createRedisConnection());
  }
  return sharedProductionLimiter;
}

const lazyProductionLoginAttemptLimiter: LoginAttemptLimiter = {
  assertAllowed(key) {
    return getProductionLoginAttemptLimiter().assertAllowed(key);
  },
  recordFailure(key) {
    return getProductionLoginAttemptLimiter().recordFailure(key);
  },
  clear(key) {
    return getProductionLoginAttemptLimiter().clear(key);
  },
};

function invalidCredentials(): AppError {
  return new AppError('Invalid credentials', 401, 'INVALID_CREDENTIALS');
}

function assertSameOriginLogin(req: Request): void {
  const origin = req.get('Origin');
  const host = req.get('Host');
  if (!origin || !host) {
    throw new AppError('Invalid login origin', 403, 'LOGIN_ORIGIN_INVALID');
  }

  let actualOrigin: string;
  let expectedOrigin: string;
  try {
    actualOrigin = new URL(origin).origin;
    expectedOrigin = new URL(`${req.protocol}://${host}`).origin;
  } catch {
    throw new AppError('Invalid login origin', 403, 'LOGIN_ORIGIN_INVALID');
  }

  if (actualOrigin !== expectedOrigin) {
    throw new AppError('Invalid login origin', 403, 'LOGIN_ORIGIN_INVALID');
  }
}

function normalizeReturnPath(value: unknown): string {
  if (value === undefined || value === null || value === '') return '/';
  if (
    typeof value !== 'string'
    || !value.startsWith('/')
    || value.startsWith('//')
    || value.includes('\\')
  ) {
    throw new ValidationError('Invalid return path');
  }

  try {
    const base = new URL('http://local.invalid');
    const parsed = new URL(value, base);
    if (parsed.origin !== base.origin) throw new Error('external origin');
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    throw new ValidationError('Invalid return path');
  }
}

function requirePasswordInput(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new ValidationError(`Invalid ${field}`);
  }
  return value;
}

function assertNewPasswordPolicy(password: string): void {
  const length = Array.from(password).length;
  if (length < 12 || length > 256) {
    throw new AppError(
      'Password must be between 12 and 256 characters',
      400,
      'PASSWORD_POLICY_VIOLATION',
    );
  }
}

function setSessionCookie(res: Response, rawToken: string): void {
  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS,
  });
}

function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
  });
}

export function createAuthRoutes(options: AuthRoutesOptions = {}) {
  const routes = Router();
  const limiter = options.loginAttemptLimiter ?? lazyProductionLoginAttemptLimiter;

  routes.get('/login', (req, res) => {
    let returnPath = '/';
    try {
      returnPath = normalizeReturnPath(req.query.returnPath);
    } catch {
      returnPath = '/';
    }
    res.render('auth/login', { returnPath });
  });

  routes.post('/login', async (req, res, next) => {
    try {
      const rawEmail = typeof req.body?.email === 'string' ? req.body.email : '';
      const normalizedEmail = normalizeEmail(rawEmail);
      assertSameOriginLogin(req);
      const returnPath = normalizeReturnPath(req.body?.returnPath);
      const limiterKey = loginLimiterKey(
        normalizedEmail,
        req.socket.remoteAddress ?? 'unknown',
      );

      await limiter.assertAllowed(limiterKey);

      const user = normalizedEmail
        ? await prisma.user.findFirst({
            where: { normalizedEmail, status: 'ACTIVE' },
            select: { id: true, passwordHash: true },
          })
        : null;
      const password = typeof req.body?.password === 'string' ? req.body.password : '';
      const valid = user ? await passwordHasher.verify(password, user.passwordHash) : false;

      if (!user || !valid) {
        await limiter.recordFailure(limiterKey);
        throw invalidCredentials();
      }

      await limiter.clear(limiterKey);
      const token = createSessionToken();
      const createdAt = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.userSession.create({
          data: {
            userId: user.id,
            tokenHash: token.tokenHash,
            createdAt,
            expiresAt: new Date(createdAt.getTime() + SESSION_TTL_MS),
          },
        });
        await new SecurityAuditRepository(tx).append({
          eventType: 'SESSION_CREATED',
          actorUserId: user.id,
          targetUserId: user.id,
          createdAt,
        });
      });
      setSessionCookie(res, token.rawToken);
      res.redirect(303, returnPath);
    } catch (error) {
      next(error);
    }
  });

  routes.get('/session', requireAuthentication(), async (req, res, next) => {
    try {
      const auth = req.auth!;
      const tokenHash = res.locals.authSessionTokenHash;
      if (typeof tokenHash !== 'string') {
        throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
      }

      const [user, session] = await Promise.all([
        prisma.user.findFirst({
          where: { id: auth.userId, status: 'ACTIVE' },
          select: { id: true, email: true, displayName: true },
        }),
        prisma.userSession.findFirst({
          where: {
            id: auth.sessionId,
            userId: auth.userId,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          select: { id: true, expiresAt: true },
        }),
      ]);

      if (!user || !session) {
        throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
      }

      res.json({
        data: {
          user,
          session: {
            id: session.id,
            expiresAt: session.expiresAt.toISOString(),
          },
          csrfToken: deriveCsrfToken(env.SESSION_SECRET, session.id, tokenHash),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  routes.post('/logout', requireAuthentication(), requireCsrf(), async (req, res, next) => {
    try {
      const revokedAt = new Date();
      const userId = req.auth!.userId;
      const sessionId = req.auth!.sessionId;
      await prisma.$transaction(async (tx) => {
        await tx.userSession.updateMany({
          where: { id: sessionId, userId, revokedAt: null },
          data: { revokedAt },
        });
        await new SecurityAuditRepository(tx).append({
          eventType: 'SESSION_REVOKED',
          actorUserId: userId,
          targetUserId: userId,
          createdAt: revokedAt,
        });
      });
      clearSessionCookie(res);
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });

  routes.post(
    '/password/change',
    requireAuthentication(),
    requireCsrf(),
    async (req, res, next) => {
      try {
        const currentPassword = requirePasswordInput(
          req.body?.currentPassword,
          'current password',
        );
        const newPassword = requirePasswordInput(req.body?.newPassword, 'new password');
        assertNewPasswordPolicy(newPassword);

        const user = await prisma.user.findFirst({
          where: { id: req.auth!.userId, status: 'ACTIVE' },
          select: { id: true, passwordHash: true },
        });
        if (!user || !(await passwordHasher.verify(currentPassword, user.passwordHash))) {
          throw invalidCredentials();
        }

        const newHash = await passwordHasher.hash(newPassword);
        const revokedAt = new Date();
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: user.id },
            data: {
              passwordHash: newHash,
              passwordHashVersion: 1,
            },
          });
          await tx.userSession.updateMany({
            where: { userId: user.id, revokedAt: null },
            data: { revokedAt },
          });
          const audit = new SecurityAuditRepository(tx);
          await audit.append({
            eventType: 'PASSWORD_CHANGED',
            actorUserId: user.id,
            targetUserId: user.id,
            createdAt: revokedAt,
          });
          await audit.append({
            eventType: 'SESSIONS_REVOKED_ALL',
            actorUserId: user.id,
            targetUserId: user.id,
            createdAt: revokedAt,
          });
        });

        clearSessionCookie(res);
        res.status(204).end();
      } catch (error) {
        next(error);
      }
    },
  );

  return routes;
}
