import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';

describe('security response headers', () => {
  it('adds baseline browser protections to public health responses', async () => {
    const response = await request(createApp()).get('/health/live').expect(200);

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(response.headers['permissions-policy']).toContain('geolocation=()');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
  });
});
