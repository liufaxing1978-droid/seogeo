import { createHash } from 'node:crypto';
import {
  buildCurrentSerpSearchFact,
  resolveCurrentSerpPosition,
  type CurrentSerpSearchEngine,
} from './keyword-current-serp.js';

export type CurrentSerpTransportProvider = 'DATAFORSEO';
export type CurrentSerpDevice = 'DESKTOP' | 'MOBILE';

export type CurrentSerpKeywordRecord = {
  id: string;
  projectId: string;
  text: string;
  status: 'ACTIVE' | 'DISABLED' | 'ARCHIVED';
};

export type CurrentSerpLane = {
  provider: CurrentSerpTransportProvider;
  searchEngine: CurrentSerpSearchEngine;
  marketCode: string;
  locale: string;
  device: CurrentSerpDevice;
  searchDepth: number;
};

export type CurrentSerpProviderObservation = {
  observationRef: string;
  observedAt: Date;
  results: Array<{
    position: number;
    url: string;
  }>;
};

export type CurrentSerpProvider = {
  observe(input: Record<string, unknown>): Promise<CurrentSerpProviderObservation>;
};

export type KeywordCurrentSerpServiceDependencies = {
  keywords: {
    findKeyword(projectId: string, keywordId: string): Promise<CurrentSerpKeywordRecord | null>;
  };
  lanes: {
    findActiveLane(input: {
      projectId: string;
      searchEngine: CurrentSerpSearchEngine;
      marketCode: string;
      locale: string;
      device: CurrentSerpDevice;
    }): Promise<CurrentSerpLane | null>;
  };
  secrets: {
    resolve(provider: CurrentSerpTransportProvider): Promise<Record<string, string> | null>;
  };
  providers: {
    get(provider: CurrentSerpTransportProvider): CurrentSerpProvider | null;
  };
  searchFacts: {
    persistCompletedSnapshot(
      identity: Record<string, unknown>,
      drafts: readonly Record<string, unknown>[],
      inputHash: string,
    ): Promise<{ id: string }>;
  };
};

export type ObserveKeywordCurrentSerpInput = {
  projectId: string;
  keywordId: string;
  searchEngine: CurrentSerpSearchEngine;
  marketCode: string;
  locale: string;
  device: CurrentSerpDevice;
  targetUrl: string;
};

export type ObserveKeywordCurrentSerpResult = {
  snapshotId: string;
  position: number | null;
  observationRef: string;
};

function assertNonEmpty(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function assertLaneMatchesRequest(
  lane: CurrentSerpLane,
  input: ObserveKeywordCurrentSerpInput,
): void {
  if (
    lane.searchEngine !== input.searchEngine ||
    lane.marketCode !== input.marketCode ||
    lane.locale !== input.locale ||
    lane.device !== input.device ||
    !Number.isInteger(lane.searchDepth) ||
    lane.searchDepth < 1
  ) {
    throw new Error('CURRENT_SERP_LANE_IDENTITY_MISMATCH');
  }
}

function assertProviderObservation(
  observation: CurrentSerpProviderObservation,
  searchDepth: number,
): void {
  if (
    !observation ||
    !observation.observationRef?.trim() ||
    !(observation.observedAt instanceof Date) ||
    Number.isNaN(observation.observedAt.getTime()) ||
    !Array.isArray(observation.results)
  ) {
    throw new Error('CURRENT_SERP_PROVIDER_OBSERVATION_INVALID');
  }

  for (const result of observation.results) {
    if (
      !Number.isInteger(result.position) ||
      result.position < 1 ||
      result.position > searchDepth ||
      typeof result.url !== 'string' ||
      result.url.trim().length === 0
    ) {
      throw new Error('CURRENT_SERP_PROVIDER_OBSERVATION_INVALID');
    }
  }
}

function stableJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function buildInputHash(identity: Record<string, unknown>, draft: Record<string, unknown>): string {
  return createHash('sha256')
    .update(stableJson({ identity, drafts: [draft] }), 'utf8')
    .digest('hex');
}

export function createKeywordCurrentSerpService(
  deps: KeywordCurrentSerpServiceDependencies,
) {
  return {
    async observe(input: ObserveKeywordCurrentSerpInput): Promise<ObserveKeywordCurrentSerpResult> {
      const projectId = assertNonEmpty(input.projectId, 'CURRENT_SERP_PROJECT_ID_REQUIRED');
      const keywordId = assertNonEmpty(input.keywordId, 'CURRENT_SERP_KEYWORD_ID_REQUIRED');
      assertNonEmpty(input.marketCode, 'CURRENT_SERP_MARKET_REQUIRED');
      assertNonEmpty(input.locale, 'CURRENT_SERP_LOCALE_REQUIRED');
      assertNonEmpty(input.targetUrl, 'CURRENT_SERP_TARGET_URL_REQUIRED');

      const keyword = await deps.keywords.findKeyword(projectId, keywordId);
      if (!keyword || keyword.projectId !== projectId || keyword.id !== keywordId) {
        throw new Error('CURRENT_SERP_KEYWORD_NOT_FOUND');
      }
      if (keyword.status !== 'ACTIVE') {
        throw new Error('CURRENT_SERP_KEYWORD_NOT_ACTIVE');
      }

      const lane = await deps.lanes.findActiveLane({
        projectId,
        searchEngine: input.searchEngine,
        marketCode: input.marketCode,
        locale: input.locale,
        device: input.device,
      });
      if (!lane) {
        throw new Error('CURRENT_SERP_LANE_NOT_CONFIGURED');
      }
      assertLaneMatchesRequest(lane, input);

      const secret = await deps.secrets.resolve(lane.provider);
      if (!secret || Object.keys(secret).length === 0) {
        throw new Error('CURRENT_SERP_SECRET_NOT_CONFIGURED');
      }

      const provider = deps.providers.get(lane.provider);
      if (!provider) {
        throw new Error('CURRENT_SERP_PROVIDER_NOT_REGISTERED');
      }

      const observation = await provider.observe({
        projectId,
        keywordId,
        keyword: keyword.text,
        searchEngine: lane.searchEngine,
        marketCode: lane.marketCode,
        locale: lane.locale,
        device: lane.device,
        searchDepth: lane.searchDepth,
        targetUrl: input.targetUrl,
        credentials: { ...secret },
      });
      assertProviderObservation(observation, lane.searchDepth);

      const position = resolveCurrentSerpPosition({
        targetUrl: input.targetUrl,
        results: observation.results,
      });
      const fact = buildCurrentSerpSearchFact({
        projectId,
        keywordId,
        keywordText: keyword.text,
        searchEngine: lane.searchEngine,
        marketCode: lane.marketCode,
        locale: lane.locale,
        targetUrl: input.targetUrl,
        observedAt: observation.observedAt,
        searchDepth: lane.searchDepth,
        observationRef: observation.observationRef,
        position,
      });

      const identity = fact.identity as unknown as Record<string, unknown>;
      const draft = fact.draft as unknown as Record<string, unknown>;
      const inputHash = buildInputHash(identity, draft);
      const snapshot = await deps.searchFacts.persistCompletedSnapshot(
        identity,
        [draft],
        inputHash,
      );

      return {
        snapshotId: snapshot.id,
        position,
        observationRef: observation.observationRef,
      };
    },
  };
}
