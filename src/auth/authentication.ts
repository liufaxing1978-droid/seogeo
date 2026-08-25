import type { RequestHandler } from 'express';
import { AppError } from '../core/errors.js';
import {
  SESSION_COOKIE_NAME,
  SessionRepository,
  hashSessionToken,
} from './session.repository.js';

export interface AuthenticatedActor {
  userId: string;
  sessionId: string;
}

const sessionRepository = new SessionRepository();
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function readCookie(cookieHeader: string | undefined, name: string): string | null {
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;

    const key = part.slice(0, separator).trim();
    if (key !== name) continue;

    const value = part.slice(separator + 1).trim();
    return value || null;
  }

  return null;
}

export const authenticationMiddleware: RequestHandler = async (req, res, next) => {
  req.auth = null;
  res.locals.auth = null;
  res.locals.authSessionTokenHash = null;

  const rawToken = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
  if (!rawToken || !SESSION_TOKEN_PATTERN.test(rawToken)) {
    next();
    return;
  }

  try {
    const session = await sessionRepository.findActiveByTokenHash(
      hashSessionToken(rawToken),
      new Date(),
    );

    if (!session) {
      next();
      return;
    }

    req.auth = {
      userId: session.userId,
      sessionId: session.id,
    };
    res.locals.auth = req.auth;
    res.locals.authSessionTokenHash = session.tokenHash;
    next();
  } catch (error) {
    next(error);
  }
};

export function requireAuthentication(): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) {
      next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      return;
    }

    next();
  };
}
