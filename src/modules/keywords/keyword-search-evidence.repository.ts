import type { MarketCode } from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { SearchFactRepository } from '../search-facts/search-fact.repository.js';
import type {
  SearchFactSnapshotView,
  SearchFactView,
} from '../search-facts/search-fact.types.js';
import type { SearchProviderCode } from '../search-providers/search-provider.types.js';

export type KeywordSearchEvidenceWindow = {
  snapshots: SearchFactSnapshotView[];
  facts: SearchFactView[];
};

export type KeywordSearchEvidenceWindowInput = {
  projectId: string;
  dateFrom: Date;
  dateTo: Date;
  provider?: SearchProviderCode;
  marketCode?: MarketCode;
  locale?: string;
  propertyRef?: string;
};

const DAY_MS = 86_400_000;

function endOfUtcDay(value: Date): Date {
  return new Date(value.getTime() + DAY_MS - 1);
}

function supportsPersistedQueryFacts(provider: SearchFactSnapshotView['provider']): boolean {
  return provider === 'GOOGLE_SEARCH_CONSOLE' || provider === 'BING_WEBMASTER';
}

export class KeywordSearchEvidenceRepository {
  constructor(
    private readonly searchFacts = new SearchFactRepository(prisma),
  ) {}

  async loadProjectWindow(
    input: KeywordSearchEvidenceWindowInput,
  ): Promise<KeywordSearchEvidenceWindow> {
    if (input.provider && !supportsPersistedQueryFacts(input.provider)) {
      return { snapshots: [], facts: [] };
    }

    const shared = {
      projectId: input.projectId,
      ...(input.marketCode ? { marketCode: input.marketCode } : {}),
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
      ...(input.propertyRef !== undefined ? { propertyRef: input.propertyRef } : {}),
    };

    const snapshots = (await this.searchFacts.listCompletedSnapshots({
      ...shared,
      ...(input.provider ? { provider: input.provider } : {}),
      sourceCutoffFrom: input.dateFrom,
      sourceCutoffTo: endOfUtcDay(input.dateTo),
    })).filter((snapshot) => supportsPersistedQueryFacts(snapshot.provider));

    const factReads: Array<Promise<SearchFactView[]>> = [];

    if (!input.provider || input.provider === 'GOOGLE_SEARCH_CONSOLE') {
      factReads.push(this.searchFacts.listCompletedFacts({
        ...shared,
        provider: 'GOOGLE_SEARCH_CONSOLE',
        factKind: 'QUERY_PAGE',
        sourceDateFrom: input.dateFrom,
        sourceDateTo: input.dateTo,
      }));
    }

    if (!input.provider || input.provider === 'BING_WEBMASTER') {
      factReads.push(this.searchFacts.listCompletedFacts({
        ...shared,
        provider: 'BING_WEBMASTER',
        factKind: 'QUERY',
        sourceDateFrom: input.dateFrom,
        sourceDateTo: input.dateTo,
      }));
    }

    const facts = (await Promise.all(factReads)).flat();
    return { snapshots, facts };
  }
}
