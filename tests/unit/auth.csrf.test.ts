import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { env } from '../../src/config/env.js';
import { errorHandler } from '../../src/core/http.js';
import {
  deriveCsrfToken,
  requireCsrf,
  verifyCsrfToken,
} from '../../src/auth/csrf.js';

const SESSION_ID = 'session-id';
const TOKEN_HASH = 'a'.repeat(64);

function createProbeApp() {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.auth = {
      userId: '00000000-0000-0000-0000-000000000001',
      sessionId: SESSION_ID,
    };
    res.locals.authSessionTokenHash = TOKEN_HASH;
    next();
  });
  app.post('/probe', requireCsrf(), (_req, res) => res.sendStatus(204));
  app.use(errorHandler);
  return app;
}

describe('P10-A CSRF', () => {
  it('derives the token from the exact sessionId newline tokenHash message', () => {
    const secret = 's'.repeat(32);
    const token = deriveCsrfToken(secret, SESSION_ID, TOKEN_HASH);
    const expected = createHmac('sha256', secret)
      .update(`${SESSION_ID}\n${TOKEN_HASH}`, 'utf8')
      .digest('base64url');

    expect(token).toBe(expected);
    expect(verifyCsrfToken(token, token)).toBe(true);
    expect(verifyCsrfToken(token, `${token}x`)).toBe(false);
  });

  it.each([
    ['missing token', undefined, undefined],
    ['mismatched header', 'wrong-header-token', undefined],
    ['mismatched form value', undefined, 'wrong-form-token'],
  ])('rejects %s before the protected handler', async (_label, headerToken, formToken) => {
    const call = request(createProbeApp()).post('/probe');
    if (headerToken) call.set('X-CSRF-Token', headerToken);
    if (formToken) call.type('form').send({ _csrf: formToken });

    const response = await call;

    expect(response.status).toBe(403);
  });

  it('accepts the server-derived token from the header or form field', async () => {
    const token = deriveCsrfToken(env.SESSION_SECRET, SESSION_ID, TOKEN_HASH);

    const headerResponse = await request(createProbeApp())
      .post('/probe')
      .set('X-CSRF-Token', token);
    const formResponse = await request(createProbeApp())
      .post('/probe')
      .type('form')
      .send({ _csrf: token });

    expect(headerResponse.status).toBe(204);
    expect(formResponse.status).toBe(204);
  });
});
