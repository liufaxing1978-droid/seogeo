import { describe, expect, it } from 'vitest';
import type { SearchFactReadFilter, SearchFactView } from '../../src/modules/search-facts/search-fact.types.js';
import { resolveSearchWindowComparison } from '../../src/modules/optimization-experiments/experiment.search-source.js';
import type { SearchExperimentMeasurementScope } from '../../src/modules/optimization-experiments/experiment.types.js';

const scope: SearchExperimentMeasurementScope = {
  kind: 'SEARCH',
  provider: 'GOOGLE_SEARCH_CONSOLE',
  marketCode: 'HK',
  locale: 'zh-Hant',
  propertyRef: 'gsc:property:1',
  normalizedQuery: '興善堂',
  canonicalPage: 'https://example.com/page',
  aggregationScope: 'QUERY_PAGE'
};

function utcDay(day: number): Date {
  return new Date(Date.UTC(2026, 7, day, 0, 0, 0));
}

function makeFact(input: {
  day: number;
  snapshotId: string;
  clicks: number;
  impressions: number;
  position: number;
}): SearchFactView {
  return {
    snapshotId: input.snapshotId,
    projectId: 'project-1',
    provider: 'GOOGLE_SEARCH_CONSOLE',
    marketCode: 'HK',
    locale: 'zh-Hant',
    propertyRef: 'gsc:property:1',
    propertyType: 'URL_PREFIX',
    sourceKind: 'GSC_DAILY_SNAPSHOT',
    sourceRef: `gsc-day-${input.day}`,
    sourceObservationRef: `gsc-observation-${input.day}`,
    sourceCutoffAt: new Date(Date.UTC(2026, 7, input.day, 23, 0, 0)),
    sourceCompleteness: 'COMPLETE',
    normalizationVersion: 'SEARCH_FACT_NORMALIZATION_V1',
    factKey: `fact-${input.day}`,
    factKind: 'QUERY_PAGE',
    sourceDate: utcDay(input.day),
    query: '興善堂',
    normalizedQuery: '興善堂',
    queryNormalizationVersion: 'QUERY_NORMALIZATION_V1',
    page: 'https://example.com/page',
    canonicalPage: 'https://example.com/page',
    canonicalizationVersion: 'URL_CANONICALIZATION_V1',
    metrics: [
      { metricSemantic: 'CLICKS', numericValue: input.clicks, evidenceState: 'KNOWN_PRESENT', sourceField: 'clicks' },
      { metricSemantic: 'IMPRESSIONS', numericValue: input.impressions, evidenceState: 'KNOWN_PRESENT', sourceField: 'impressions' },
      { metricSemantic: 'CTR', numericValue: input.clicks / input.impressions, evidenceState: 'KNOWN_PRESENT', sourceField: 'ctr' },
      { metricSemantic: 'GOOGLE_SEARCH_CONSOLE_POSITION', numericValue: input.position, evidenceState: 'KNOWN_PRESENT', sourceField: 'position' }
    ]
  };
}

function completeWindowFacts(): SearchFactView[] {
  return [
    ...Array.from({ length: 7 }, (_, index) => makeFact({
      day: index + 1,
      snapshotId: `baseline-${index + 1}`,
      clicks: 1,
      impressions: 10,
      position: 4
    })),
    ...Array.from({ length: 7 }, (_, index) => makeFact({
      day: index + 8,
      snapshotId: `observed-${index + 8}`,
      clicks: 2,
      impressions: 10,
      position: 3
    }))
  ];
}

describe('P9-D search fact window resolver', () => {
  it('aggregates exact complete daily query-page facts across baseline and observed UTC windows', async () => {
    const facts = completeWindowFacts();
    let receivedFilter: SearchFactReadFilter | null = null;
    const source = {
      async listCompletedFacts(filter: SearchFactReadFilter): Promise<SearchFactView[]> {
        receivedFilter = filter;
        return facts;
      }
    };

    const result = await resolveSearchWindowComparison({
      projectId: 'project-1',
      scope,
      verifiedAnchorAt: new Date('2026-08-08T15:30:00.000Z'),
      windowType: '7D',
      windowDays: 7,
      source
    });

    expect(receivedFilter).toMatchObject({
      projectId: 'project-1',
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'HK',
      locale: 'zh-Hant',
      propertyRef: 'gsc:property:1',
      factKind: 'QUERY_PAGE',
      normalizedQuery: '興善堂',
      canonicalPage: 'https://example.com/page'
    });
    expect(result.coverageState).toBe('SUFFICIENT');
    expect(result.reasonCodes).toEqual([]);
    expect(result.comparisons).toEqual(expect.arrayContaining([
      expect.objectContaining({ metricKey: 'CLICKS', baselineValue: 7, observedValue: 14 }),
      expect.objectContaining({ metricKey: 'IMPRESSIONS', baselineValue: 70, observedValue: 70 }),
      expect.objectContaining({ metricKey: 'CTR', baselineValue: 0.1, observedValue: 0.2 }),
      expect.objectContaining({ metricKey: 'GOOGLE_SEARCH_CONSOLE_POSITION', baselineValue: 4, observedValue: 3 })
    ]));
    expect(result.baselineSearchSourceRefs).toHaveLength(7);
    expect(result.observedSearchSourceRefs).toHaveLength(7);
    expect(result.inputCutoffAt.toISOString()).toBe('2026-08-14T23:00:00.000Z');
  });

  it('includes the entire final UTC calendar day in the repository read window', async () => {
    const facts = completeWindowFacts().map((fact) => (
      fact.sourceDate.getUTCDate() === 14
        ? { ...fact, sourceDate: new Date('2026-08-14T12:00:00.000Z') }
        : fact
    ));
    const source = {
      async listCompletedFacts(filter: SearchFactReadFilter): Promise<SearchFactView[]> {
        return facts.filter((fact) => (
          (!filter.sourceDateFrom || fact.sourceDate >= filter.sourceDateFrom)
          && (!filter.sourceDateTo || fact.sourceDate <= filter.sourceDateTo)
        ));
      }
    };

    const result = await resolveSearchWindowComparison({
      projectId: 'project-1',
      scope,
      verifiedAnchorAt: new Date('2026-08-08T15:30:00.000Z'),
      windowType: '7D',
      windowDays: 7,
      source
    });

    expect(result.coverageState).toBe('SUFFICIENT');
    expect(result.observedSearchSourceRefs).toHaveLength(7);
  });
});
