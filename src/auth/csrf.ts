import { createHmac, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { env } from '../config/env.js';
import { AppError } from '../core/errors.js';

export function deriveCsrfToken(
  secret: string,
  sessionId: string,
  tokenHash: string,
): string {
  return createHmac('sha256', secret)
    .update(`${sessionId}\n${tokenHash}`, 'utf8')
    .digest('base64url');
}

export function verifyCsrfToken(expected: string, submitted: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const submittedBuffer = Buffer.from(submitted, 'utf8');

  if (expectedBuffer.length !== submittedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, submittedBuffer);
}

function submittedCsrfToken(req: Parameters<RequestHandler>[0]): string | null {
  const headerToken = req.get('X-CSRF-Token');
  const body = req.body as Record<string, unknown> | undefined;
  const formToken = typeof body?._csrf === 'string' ? body._csrf : undefined;

  if (headerToken && formToken && headerToken !== formToken) return null;
  return headerToken ?? formToken ?? null;
}

export function requireCsrf(): RequestHandler {
  return (req, res, next) => {
    const tokenHash = res.locals.authSessionTokenHash;
    const submitted = submittedCsrfToken(req);

    if (!req.auth || typeof tokenHash !== 'string' || !submitted) {
      next(new AppError('Invalid CSRF token', 403, 'CSRF_INVALID'));
      return;
    }

    const expected = deriveCsrfToken(
      env.SESSION_SECRET,
      req.auth.sessionId,
      tokenHash,
    );

    if (!verifyCsrfToken(expected, submitted)) {
      next(new AppError('Invalid CSRF token', 403, 'CSRF_INVALID'));
      return;
    }

    next();
  };
}
