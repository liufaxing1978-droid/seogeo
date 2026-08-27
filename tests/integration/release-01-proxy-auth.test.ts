import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const originalTrustProxyHops = process.env.TRUST_PROXY_HOPS;
let createApp: typeof import('../../src/app.js').createApp;

beforeAll(async () => {
  process.env.TRUST_PROXY_HOPS = '1';
  vi.resetModules();
  ({ createApp } = await import('../../src/app.js'));
});

afterAll(() => {
  if (originalTrustProxyHops === undefined) delete process.env.TRUST_PROXY_HOPS;
  else process.env.TRUST_PROXY_HOPS = originalTrustProxyHops;
  vi.resetModules();
});

describe('Release-01 reverse proxy login origin contract', () => {
  it('keeps a mismatched public HTTPS Origin rejected', async () => {
    const response = await request(createApp())
      .post('/auth/login')
      .set('Host', 'staging.example')
      .set('X-Forwarded-Proto', 'https')
      .set('Origin', 'https://evil.example')
      .send({ email: 'missing@example.com', password: 'wrong', returnPath: '/' });

    expect(response.status).toBe(403);
    expect(response.body.error?.code).toBe('LOGIN_ORIGIN_INVALID');
  });

  it('accepts the matching public HTTPS Origin and proceeds to credential validation', async () => {
    const response = await request(createApp())
      .post('/auth/login')
      .set('Host', 'staging.example')
      .set('X-Forwarded-Proto', 'https')
      .set('Origin', 'https://staging.example')
      .send({ email: 'missing@example.com', password: 'wrong', returnPath: '/' });

    expect(response.status).toBe(401);
    expect(response.body.error?.code).toBe('INVALID_CREDENTIALS');
  });
});
