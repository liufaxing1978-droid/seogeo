import { marketRepository, type MarketRepository } from './market.repository.js';
import {
  MarketValidationError,
  marketIdentity,
  normalizeLocale,
  resolveLegacyMarket,
  type MarketSelection,
  type MarketWriteInput
} from './market.types.js';

const MAX_PROJECT_MARKETS = 20;

function sortMarkets<T extends Pick<MarketWriteInput, 'marketCode' | 'locale'>>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const marketOrder = left.marketCode.localeCompare(right.marketCode);
    return marketOrder !== 0 ? marketOrder : left.locale.localeCompare(right.locale);
  });
}

export class MarketService {
  constructor(private readonly repository: MarketRepository = marketRepository) {}

  async listResolvedMarkets(projectId: string): Promise<MarketSelection[]> {
    const project = await this.requireProject(projectId);
    const explicit = await this.repository.listExplicitMarkets(projectId);
    if (explicit.length === 0) {
      return [resolveLegacyMarket(project)];
    }

    return sortMarkets(explicit.map((market) => ({
      marketCode: market.marketCode,
      locale: normalizeLocale(market.locale),
      enabled: market.enabled,
      source: 'EXPLICIT' as const
    })));
  }

  async replaceMarkets(projectId: string, input: MarketWriteInput[]): Promise<MarketSelection[]> {
    const project = await this.requireProject(projectId);
    if (input.length > MAX_PROJECT_MARKETS) {
      throw new MarketValidationError(
        `A project may configure at most ${MAX_PROJECT_MARKETS} markets`,
        'MARKET_LIMIT_EXCEEDED'
      );
    }

    const normalized = input.map((market) => ({
      marketCode: market.marketCode,
      locale: normalizeLocale(market.locale),
      enabled: market.enabled
    }));

    const identities = new Set<string>();
    for (const market of normalized) {
      const identity = marketIdentity(market);
      if (identities.has(identity)) {
        throw new MarketValidationError(
          `Duplicate market identity: ${identity}`,
          'DUPLICATE_MARKET'
        );
      }
      identities.add(identity);
    }

    const sorted = sortMarkets(normalized);
    await this.repository.replaceExplicitMarkets(projectId, sorted);

    if (sorted.length === 0) {
      return [resolveLegacyMarket(project)];
    }

    return sorted.map((market) => ({ ...market, source: 'EXPLICIT' as const }));
  }

  private async requireProject(projectId: string) {
    const project = await this.repository.findProjectIdentity(projectId);
    if (!project) {
      throw new MarketValidationError('Project not found', 'PROJECT_NOT_FOUND');
    }
    return project;
  }
}

export const marketService = new MarketService();
