import { env } from '../../config/env.js';
import { prisma } from '../../db/prisma.js';
import { SearchFactRepository } from '../search-facts/search-fact.repository.js';
import type {
  NormalizedSearchFactDraft,
  SearchFactMaterializeIdentity,
} from '../search-facts/search-fact.types.js';
import {
  createDataForSeoCurrentSerpProvider,
  resolveDataForSeoCurrentSerpCredentials,
} from './dataforseo-current-serp.provider.js';
import {
  createKeywordCurrentSerpService,
  type KeywordCurrentSerpServiceDependencies,
} from './keyword-current-serp.service.js';
import { KeywordRepository } from './keyword.repository.js';

type DataForSeoCurrentSerpRuntimeEnv = {
  DATAFORSEO_LOGIN?: string;
  DATAFORSEO_PASSWORD?: string;
  DATAFORSEO_BASE_URL: string;
  DATAFORSEO_TIMEOUT_MS: number;
};

export type KeywordCurrentSerpRuntimeOptions = {
  lanes: KeywordCurrentSerpServiceDependencies['lanes'];
  runtimeEnv?: DataForSeoCurrentSerpRuntimeEnv;
  keywords?: KeywordCurrentSerpServiceDependencies['keywords'];
  searchFacts?: KeywordCurrentSerpServiceDependencies['searchFacts'];
  fetchImpl?: typeof fetch;
  now?: () => Date;
};

function createDefaultKeywordPort(): KeywordCurrentSerpServiceDependencies['keywords'] {
  const repository = new KeywordRepository();
  return {
    async findKeyword(projectId, keywordId) {
      const keyword = await repository.findKeyword(projectId, keywordId);
      if (!keyword) return null;
      return {
        id: keyword.id,
        projectId: keyword.projectId,
        text: keyword.text,
        status: keyword.status,
      };
    },
  };
}

function createDefaultSearchFactPort(): KeywordCurrentSerpServiceDependencies['searchFacts'] {
  const repository = new SearchFactRepository(prisma);
  return {
    async persistCompletedSnapshot(identity, drafts, inputHash) {
      const snapshot = await repository.persistCompletedSnapshot(
        identity as unknown as SearchFactMaterializeIdentity,
        drafts as unknown as readonly NormalizedSearchFactDraft[],
        inputHash,
      );
      return { id: snapshot.id };
    },
  };
}

export function createKeywordCurrentSerpRuntimeService(
  options: KeywordCurrentSerpRuntimeOptions,
) {
  const runtimeEnv = options.runtimeEnv ?? env;
  const provider = createDataForSeoCurrentSerpProvider({
    baseUrl: runtimeEnv.DATAFORSEO_BASE_URL,
    timeoutMs: runtimeEnv.DATAFORSEO_TIMEOUT_MS,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...(options.now ? { now: options.now } : {}),
  });

  return createKeywordCurrentSerpService({
    keywords: options.keywords ?? createDefaultKeywordPort(),
    lanes: options.lanes,
    secrets: {
      resolve(providerCode) {
        if (providerCode !== 'DATAFORSEO') return Promise.resolve(null);
        return resolveDataForSeoCurrentSerpCredentials(runtimeEnv);
      },
    },
    providers: {
      get(providerCode) {
        return providerCode === 'DATAFORSEO' ? provider : null;
      },
    },
    searchFacts: options.searchFacts ?? createDefaultSearchFactPort(),
  });
}
