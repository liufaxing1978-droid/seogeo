import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import { deriveCsrfToken } from '../../src/auth/csrf.js';
import { env } from '../../src/config/env.js';
import type { MarketApiPort } from '../../src/modules/market/market.routes.js';
import { MarketValidationError } from '../../src/modules/market/market.types.js';
import { seedAuthenticatedUser } from '../helpers/auth-fixture.js';

function createService(overrides: Partial<MarketApiPort> = {}): MarketApiPort {
  return {
    listResolvedMarkets: vi.fn().mockResolvedValue([]),
    replaceMarkets: vi.fn().mockResolvedValue([]),
    ...overrides
  };
}

describe('P9-0A project market REST API', () => {
  let owner: Awaited<ReturnType<typeof seedAuthenticatedUser>>;

  beforeEach(async () => {
    owner = await seedAuthenticatedUser({
      role: 'OWNER',
      planLevel: 'ENTERPRISE',
      userStatus: 'ACTIVE',
      membershipStatus: 'ACTIVE',
    });
  });

  afterEach(async () => {
    await owner.cleanup();
  });

  function csrfToken() {
    return deriveCsrfToken(env.SESSION_SECRET, owner.csrfInput.sessionId, owner.csrfInput.tokenHash);
  }

  it('rejects anonymous market reads and writes before invoking the service', async () => {
    const service = createService();
    const app = createApp({ marketService: service });

    const readResponse = await request(app).get(`/api/projects/${owner.project.id}/markets`);
    const writeResponse = await request(app)
      .put(`/api/projects/${owner.project.id}/markets`)
      .send({ markets: [{ marketCode: 'CN', locale: 'zh-CN', enabled: true }] });

    expect(readResponse.status).toBe(401);
    expect(writeResponse.status).toBe(401);
    expect(service.listResolvedMarkets).not.toHaveBeenCalled();
    expect(service.replaceMarkets).not.toHaveBeenCalled();
  });

  it('requires CSRF and project settings capability for market writes', async () => {
    const viewer = await seedAuthenticatedUser({ role: 'VIEWER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
    const service = createService();
    try {
      const missingCsrf = await request(createApp({ marketService: service }))
        .put(`/api/projects/${owner.project.id}/markets`)
        .set('Cookie', owner.sessionCookie)
        .send({ markets: [] });
      const forbidden = await request(createApp({ marketService: service }))
        .put(`/api/projects/${viewer.project.id}/markets`)
        .set('Cookie', viewer.sessionCookie)
        .set('X-CSRF-Token', deriveCsrfToken(env.SESSION_SECRET, viewer.csrfInput.sessionId, viewer.csrfInput.tokenHash))
        .send({ markets: [] });

      expect(missingCsrf.status).toBe(403);
      expect(forbidden.status).toBe(403);
      expect(service.replaceMarkets).not.toHaveBeenCalled();
    } finally { await viewer.cleanup(); }
  });
  it('GET returns resolved markets without invoking a write method', async () => {
    const service = createService({
      listResolvedMarkets: vi.fn().mockResolvedValue([
        { marketCode: 'CN', locale: 'zh-CN', enabled: true, source: 'LEGACY_FALLBACK' }
      ])
    });

    const response = await request(createApp({ marketService: service }))
      .get(`/api/projects/${owner.project.id}/markets`)
      .set('Cookie', owner.sessionCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      { marketCode: 'CN', locale: 'zh-CN', enabled: true, source: 'LEGACY_FALLBACK' }
    ]);
    expect(service.listResolvedMarkets).toHaveBeenCalledWith(owner.project.id);
    expect(service.replaceMarkets).not.toHaveBeenCalled();
  });

  it('PUT passes bounded market input to the service and returns its canonical result', async () => {
    const service = createService({
      replaceMarkets: vi.fn().mockResolvedValue([
        { marketCode: 'CN', locale: 'zh-CN', enabled: true, source: 'EXPLICIT' },
        { marketCode: 'GLOBAL', locale: 'zh-Hant', enabled: true, source: 'EXPLICIT' }
      ])
    });

    const response = await request(createApp({ marketService: service }))
      .put(`/api/projects/${owner.project.id}/markets`)
      .set('Cookie', owner.sessionCookie)
      .set('X-CSRF-Token', csrfToken())
      .send({
        markets: [
          { marketCode: 'GLOBAL', locale: 'zh-hant', enabled: true },
          { marketCode: 'CN', locale: 'zh-cn', enabled: true }
        ]
      });

    expect(response.status).toBe(200);
    expect(service.replaceMarkets).toHaveBeenCalledOnce();
    expect(service.replaceMarkets).toHaveBeenCalledWith(owner.project.id, [
      { marketCode: 'GLOBAL', locale: 'zh-hant', enabled: true },
      { marketCode: 'CN', locale: 'zh-cn', enabled: true }
    ]);
    expect(response.body.data).toEqual([
      { marketCode: 'CN', locale: 'zh-CN', enabled: true, source: 'EXPLICIT' },
      { marketCode: 'GLOBAL', locale: 'zh-Hant', enabled: true, source: 'EXPLICIT' }
    ]);
  });

  it('defaults omitted enabled to true before passing input to the service', async () => {
    const service = createService();

    const response = await request(createApp({ marketService: service }))
      .put(`/api/projects/${owner.project.id}/markets`)
      .set('Cookie', owner.sessionCookie)
      .set('X-CSRF-Token', csrfToken())
      .send({ markets: [{ marketCode: 'CN', locale: 'zh-CN' }] });

    expect(response.status).toBe(200);
    expect(service.replaceMarkets).toHaveBeenCalledWith(owner.project.id, [
      { marketCode: 'CN', locale: 'zh-CN', enabled: true }
    ]);
  });

  it.each([
    ['unknown market code', { markets: [{ marketCode: 'US', locale: 'en-US', enabled: true }] }],
    ['65-character locale', { markets: [{ marketCode: 'GLOBAL', locale: 'a'.repeat(65), enabled: true }] }],
    ['extra body property', { markets: [], extra: true }],
    ['21 rows', {
      markets: Array.from({ length: 21 }, (_, index) => ({
        marketCode: 'GLOBAL',
        locale: `en-x-p9-${index}`,
        enabled: true
      }))
    }]
  ])('returns HTTP 400 for %s before calling replaceMarkets', async (_label, body) => {
    const service = createService();

    const response = await request(createApp({ marketService: service }))
      .put(`/api/projects/${owner.project.id}/markets`)
      .set('Cookie', owner.sessionCookie)
      .set('X-CSRF-Token', csrfToken())
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(service.replaceMarkets).not.toHaveBeenCalled();
  });

  it('maps PROJECT_NOT_FOUND from the service to HTTP 404', async () => {
    const service = createService({
      listResolvedMarkets: vi.fn().mockRejectedValue(
        new MarketValidationError('Project not found', 'PROJECT_NOT_FOUND')
      )
    });

    const response = await request(createApp({ marketService: service }))
      .get(`/api/projects/${owner.project.id}/markets`)
      .set('Cookie', owner.sessionCookie);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('maps duplicate market validation failures to HTTP 400', async () => {
    const service = createService({
      replaceMarkets: vi.fn().mockRejectedValue(
        new MarketValidationError('Duplicate market identity', 'DUPLICATE_MARKET')
      )
    });

    const response = await request(createApp({ marketService: service }))
      .put(`/api/projects/${owner.project.id}/markets`)
      .set('Cookie', owner.sessionCookie)
      .set('X-CSRF-Token', csrfToken())
      .send({ markets: [{ marketCode: 'CN', locale: 'zh-CN', enabled: true }] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('DUPLICATE_MARKET');
  });
});
