import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../../src/app.js';
import type { MarketApiPort } from '../../src/modules/market/market.routes.js';
import { MarketValidationError } from '../../src/modules/market/market.types.js';

function createService(overrides: Partial<MarketApiPort> = {}): MarketApiPort {
  return {
    listResolvedMarkets: vi.fn().mockResolvedValue([]),
    replaceMarkets: vi.fn().mockResolvedValue([]),
    ...overrides
  };
}

describe('P9-0A project market REST API', () => {
  it('GET returns resolved markets without invoking a write method', async () => {
    const service = createService({
      listResolvedMarkets: vi.fn().mockResolvedValue([
        { marketCode: 'CN', locale: 'zh-CN', enabled: true, source: 'LEGACY_FALLBACK' }
      ])
    });

    const response = await request(createApp({ marketService: service }))
      .get('/api/projects/p1/markets');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([
      { marketCode: 'CN', locale: 'zh-CN', enabled: true, source: 'LEGACY_FALLBACK' }
    ]);
    expect(service.listResolvedMarkets).toHaveBeenCalledWith('p1');
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
      .put('/api/projects/p1/markets')
      .send({
        markets: [
          { marketCode: 'GLOBAL', locale: 'zh-hant', enabled: true },
          { marketCode: 'CN', locale: 'zh-cn', enabled: true }
        ]
      });

    expect(response.status).toBe(200);
    expect(service.replaceMarkets).toHaveBeenCalledOnce();
    expect(service.replaceMarkets).toHaveBeenCalledWith('p1', [
      { marketCode: 'GLOBAL', locale: 'zh-hant', enabled: true },
      { marketCode: 'CN', locale: 'zh-cn', enabled: true }
    ]);
    expect(response.body.data).toEqual([
      { marketCode: 'CN', locale: 'zh-CN', enabled: true, source: 'EXPLICIT' },
      { marketCode: 'GLOBAL', locale: 'zh-Hant', enabled: true, source: 'EXPLICIT' }
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
      .put('/api/projects/p1/markets')
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
      .get('/api/projects/missing/markets');

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
      .put('/api/projects/p1/markets')
      .send({ markets: [{ marketCode: 'CN', locale: 'zh-CN', enabled: true }] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('DUPLICATE_MARKET');
  });
});
