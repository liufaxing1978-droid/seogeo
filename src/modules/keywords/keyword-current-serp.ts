import { createHash } from 'node:crypto';
import { normalizeKeywordText } from './keyword-normalize.js';

export type CurrentSerpSearchEngine = 'GOOGLE' | 'BING';
export type CurrentSerpFactProvider = 'GOOGLE_SERP' | 'BING_SERP';

export type CurrentSerpResult = {
  position: number;
  url: string;
};

export type CurrentSerpFactInput = {
  projectId: string;
  keywordId: string;
  keywordText: string;
  searchEngine: CurrentSerpSearchEngine;
  marketCode: string;
  locale: string;
  targetUrl: string;
  observedAt: Date;
  searchDepth: number;
  observationRef: string;
  position: number | null;
};

function normalizeComparableUrl(value: string): string {
  const parsed = new URL(value);
  parsed.hash = '';
  parsed.hostname = parsed.hostname.toLocaleLowerCase('und');

  if ((parsed.protocol === 'https:' && parsed.port === '443') ||
      (parsed.protocol === 'http:' && parsed.port === '80')) {
    parsed.port = '';
  }

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
    parsed.pathname = parsed.pathname.replace(/\/+$/u, '');
  }

  return parsed.toString();
}

function sourceDate(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function providerFor(searchEngine: CurrentSerpSearchEngine): CurrentSerpFactProvider {
  return searchEngine === 'GOOGLE' ? 'GOOGLE_SERP' : 'BING_SERP';
}

export function resolveCurrentSerpPosition(input: {
  targetUrl: string;
  results: readonly CurrentSerpResult[];
}): number | null {
  const target = normalizeComparableUrl(input.targetUrl);
  const matchingPositions = input.results
    .filter((result) => Number.isInteger(result.position) && result.position > 0)
    .filter((result) => {
      try {
        return normalizeComparableUrl(result.url) === target;
      } catch {
        return false;
      }
    })
    .map((result) => result.position);

  return matchingPositions.length > 0 ? Math.min(...matchingPositions) : null;
}

export function buildCurrentSerpSearchFact(input: CurrentSerpFactInput) {
  if (!input.observationRef.trim()) {
    throw new Error('CURRENT_SERP_OBSERVATION_REF_REQUIRED');
  }
  if (!Number.isInteger(input.searchDepth) || input.searchDepth < 1) {
    throw new Error('CURRENT_SERP_SEARCH_DEPTH_INVALID');
  }
  if (input.position !== null &&
      (!Number.isInteger(input.position) || input.position < 1 || input.position > input.searchDepth)) {
    throw new Error('CURRENT_SERP_POSITION_OUTSIDE_DEPTH');
  }

  const canonicalPage = normalizeComparableUrl(input.targetUrl);
  const normalizedQuery = normalizeKeywordText(input.keywordText);
  const provider = providerFor(input.searchEngine);
  const stableSourceRef = [
    'current-serp',
    input.searchEngine.toLocaleLowerCase('und'),
    input.keywordId,
    input.observationRef,
  ].join(':');
  const factKey = createHash('sha256')
    .update([
      input.projectId,
      input.keywordId,
      input.searchEngine,
      input.marketCode,
      input.locale,
      normalizedQuery,
      canonicalPage,
      input.observationRef,
    ].join('\u001f'))
    .digest('hex');

  return {
    identity: {
      projectId: input.projectId,
      provider,
      marketCode: input.marketCode,
      locale: input.locale,
      propertyRef: canonicalPage,
      propertyType: 'URL_PREFIX',
      sourceKind: 'REALTIME_SERP_OBSERVATION',
      sourceRef: stableSourceRef,
      sourceCutoffAt: input.observedAt,
      sourceCompleteness: 'TOP_ROWS_ONLY',
      normalizationVersion: 'SEARCH_FACT_NORMALIZATION_V1',
    },
    draft: {
      factKey,
      factKind: 'QUERY_PAGE_RANK',
      sourceObservationRef: input.observationRef,
      sourceDate: sourceDate(input.observedAt),
      query: input.keywordText,
      normalizedQuery,
      queryNormalizationVersion: 'KEYWORD_NORMALIZATION_V1',
      page: input.targetUrl,
      canonicalPage,
      canonicalizationVersion: 'CURRENT_SERP_URL_V1',
      metrics: [
        {
          metricSemantic: 'CURRENT_SERP_POSITION',
          numericValue: input.position,
          evidenceState: input.position === null ? 'KNOWN_EMPTY' : 'KNOWN_PRESENT',
          sourceField: 'organic.position',
        },
      ],
    },
  } as const;
}
