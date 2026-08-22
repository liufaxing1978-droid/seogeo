import { describe, expect, it } from 'vitest';
import { MarketService } from '../../src/modules/market/market.service.js';
import type { MarketRepository } from '../../src/modules/market/market.repository.js';
import type { MarketWriteInput } from '../../src/modules/market/market.types.js';

class FakeMarketRepository implements MarketRepository {
  project: { id: string; targetCountry: string; defaultLanguage: string } | null = {
    id: 'p1',
    targetCountry: 'CN',
    defaultLanguage: 'zh-CN'
  };
  markets: MarketWriteInput[] = [];
  replaceCalls = 0;

  async findProjectIdentity(projectId: string) {
    return this.project?.id === projectId ? this.project : null;
  }

  async listExplicitMarkets(_projectId: string) {
    return this.markets.map((market) => ({ ...market }));
  }

  async replaceExplicitMarkets(_projectId: string, markets: MarketWriteInput[]) {
    this.replaceCalls += 1;
    this.markets = markets.map((market) => ({ ...market }));
  }
}

describe('P9-0A market service', () => {
  it('returns legacy fallback when no explicit markets exist without writing', async () => {
    const repository = new FakeMarketRepository();
    repository.project = { id: 'p1', targetCountry: 'CN', defaultLanguage: 'zh-cn' };
    const service = new MarketService(repository);

    await expect(service.listResolvedMarkets('p1')).resolves.toEqual([
      { marketCode: 'CN', locale: 'zh-CN', enabled: true, source: 'LEGACY_FALLBACK' }
    ]);
    expect(repository.replaceCalls).toBe(0);
  });

  it('returns sorted explicit rows and does not append legacy fallback', async () => {
    const repository = new FakeMarketRepository();
    repository.markets = [
      { marketCode: 'GLOBAL', locale: 'zh-Hant', enabled: true },
      { marketCode: 'CN', locale: 'zh-CN', enabled: false }
    ];
    const service = new MarketService(repository);

    await expect(service.listResolvedMarkets('p1')).resolves.toEqual([
      { marketCode: 'CN', locale: 'zh-CN', enabled: false, source: 'EXPLICIT' },
      { marketCode: 'GLOBAL', locale: 'zh-Hant', enabled: true, source: 'EXPLICIT' }
    ]);
  });

  it('rejects duplicate normalized identities before repository write', async () => {
    const repository = new FakeMarketRepository();
    const service = new MarketService(repository);

    await expect(service.replaceMarkets('p1', [
      { marketCode: 'CN', locale: 'zh-cn', enabled: true },
      { marketCode: 'CN', locale: 'zh-CN', enabled: true }
    ])).rejects.toMatchObject({ code: 'DUPLICATE_MARKET' });
    expect(repository.replaceCalls).toBe(0);
  });

  it('rejects more than 20 markets before repository write', async () => {
    const repository = new FakeMarketRepository();
    const service = new MarketService(repository);
    const rows = Array.from({ length: 21 }, (_, index) => ({
      marketCode: 'GLOBAL' as const,
      locale: `en-x-p9-${index}`,
      enabled: true
    }));

    await expect(service.replaceMarkets('p1', rows)).rejects.toMatchObject({
      code: 'MARKET_LIMIT_EXCEEDED'
    });
    expect(repository.replaceCalls).toBe(0);
  });

  it('rejects an unknown project', async () => {
    const repository = new FakeMarketRepository();
    repository.project = null;
    const service = new MarketService(repository);

    await expect(service.listResolvedMarkets('missing')).rejects.toMatchObject({
      code: 'PROJECT_NOT_FOUND'
    });
  });

  it('normalizes replacement rows and restores legacy fallback after explicit rows are cleared', async () => {
    const repository = new FakeMarketRepository();
    const service = new MarketService(repository);

    await expect(service.replaceMarkets('p1', [
      { marketCode: 'GLOBAL', locale: 'zh-hant', enabled: true },
      { marketCode: 'CN', locale: 'zh-cn', enabled: true }
    ])).resolves.toEqual([
      { marketCode: 'CN', locale: 'zh-CN', enabled: true, source: 'EXPLICIT' },
      { marketCode: 'GLOBAL', locale: 'zh-Hant', enabled: true, source: 'EXPLICIT' }
    ]);

    await expect(service.replaceMarkets('p1', [])).resolves.toEqual([
      { marketCode: 'CN', locale: 'zh-CN', enabled: true, source: 'LEGACY_FALLBACK' }
    ]);
    expect(repository.replaceCalls).toBe(2);
  });

  it('keeps an existing CN project behavior when there are no explicit rows', async () => {
    const repository = new FakeMarketRepository();
    repository.project = { id: 'p1', targetCountry: 'CN', defaultLanguage: 'zh-CN' };
    repository.markets = [];
    const service = new MarketService(repository);

    expect(await service.listResolvedMarkets('p1')).toEqual([
      { marketCode: 'CN', locale: 'zh-CN', enabled: true, source: 'LEGACY_FALLBACK' }
    ]);
  });

  it('maps a legacy US project to GLOBAL rather than inventing a new market code', async () => {
    const repository = new FakeMarketRepository();
    repository.project = { id: 'p1', targetCountry: 'US', defaultLanguage: 'en-US' };
    repository.markets = [];
    const service = new MarketService(repository);

    expect(await service.listResolvedMarkets('p1')).toEqual([
      { marketCode: 'GLOBAL', locale: 'en-US', enabled: true, source: 'LEGACY_FALLBACK' }
    ]);
  });

  it('restores legacy fallback after explicit markets are cleared', async () => {
    const repository = new FakeMarketRepository();
    repository.markets = [
      { marketCode: 'GLOBAL', locale: 'en-US', enabled: true }
    ];
    const service = new MarketService(repository);

    await service.replaceMarkets('p1', []);

    expect(await service.listResolvedMarkets('p1')).toEqual([
      { marketCode: 'CN', locale: 'zh-CN', enabled: true, source: 'LEGACY_FALLBACK' }
    ]);
  });
});
