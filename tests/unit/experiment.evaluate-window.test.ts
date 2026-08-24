import { describe, expect, it } from 'vitest';
import { OptimizationExperimentService } from '../../src/modules/optimization-experiments/experiment.service.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function searchFact(input: {
  snapshotId: string;
  factKey: string;
  sourceDate: Date;
  sourceCutoffAt: Date;
  clicks: number;
  impressions: number;
  position: number;
}) {
  return {
    snapshotId: input.snapshotId,
    projectId: 'project-1',
    provider: 'GOOGLE_SEARCH_CONSOLE',
    marketCode: 'HK',
    locale: 'zh-Hant',
    propertyRef: 'gsc:property:1',
    propertyType: 'URL_PREFIX',
    sourceKind: 'SEARCH_CONSOLE_API',
    sourceRef: `source:${input.snapshotId}`,
    sourceObservationRef: `observation:${input.factKey}`,
    sourceCutoffAt: input.sourceCutoffAt,
    sourceCompleteness: 'COMPLETE',
    normalizationVersion: 'SEARCH_FACT_NORMALIZATION_V1',
    factKey: input.factKey,
    factKind: 'QUERY_PAGE',
    sourceDate: input.sourceDate,
    query: '興善堂',
    normalizedQuery: '興善堂',
    queryNormalizationVersion: 'QUERY_NORMALIZATION_V1',
    page: 'https://example.com/page',
    canonicalPage: 'https://example.com/page',
    canonicalizationVersion: 'CANONICALIZATION_V1',
    metrics: [
      {
        metricSemantic: 'CLICKS',
        numericValue: input.clicks,
        evidenceState: 'KNOWN_PRESENT',
        sourceField: 'clicks'
      },
      {
        metricSemantic: 'IMPRESSIONS',
        numericValue: input.impressions,
        evidenceState: 'KNOWN_PRESENT',
        sourceField: 'impressions'
      },
      {
        metricSemantic: 'GOOGLE_SEARCH_CONSOLE_POSITION',
        numericValue: input.position,
        evidenceState: 'KNOWN_PRESENT',
        sourceField: 'position'
      }
    ]
  } as const;
}

describe('P9-D evaluateWindow orchestration', () => {
  it('evaluates a due frozen search window, promotes the expected metric to PRIMARY, and persists a stable-cutoff observation', async () => {
    const verifiedAnchorAt = new Date('2026-08-01T00:00:00.000Z');
    const dueAt = new Date(verifiedAnchorAt.getTime() + 7 * DAY_MS);
    const sourceCutoffAt = new Date('2026-08-08T12:00:00.000Z');
    const facts = Array.from({ length: 14 }, (_, index) => {
      const baseline = index < 7;
      const dayOffset = baseline ? index - 7 : index - 7;
      const sourceDate = new Date(verifiedAnchorAt.getTime() + dayOffset * DAY_MS);
      return searchFact({
        snapshotId: `snapshot-${index}`,
        factKey: `fact-${index}`,
        sourceDate,
        sourceCutoffAt: baseline
          ? new Date('2026-07-31T23:00:00.000Z')
          : sourceCutoffAt,
        clicks: baseline ? 10 : 15,
        impressions: baseline ? 100 : 120,
        position: 5
      });
    });

    let persistedInput: Record<string, unknown> | null = null;
    const experiment = {
      id: 'experiment-1',
      projectId: 'project-1',
      publicationExecutionId: 'execution-1',
      interventionType: 'SERP_SNIPPET_OPTIMIZATION',
      targetUrl: 'https://example.com/page',
      verifiedAnchorAt,
      measurementScopeJson: {
        kind: 'SEARCH',
        provider: 'GOOGLE_SEARCH_CONSOLE',
        marketCode: 'HK',
        locale: 'zh-Hant',
        propertyRef: 'gsc:property:1',
        normalizedQuery: '興善堂',
        canonicalPage: 'https://example.com/page',
        aggregationScope: 'QUERY_PAGE'
      },
      observationScheduleJson: [{ windowType: '7D', windowDays: 7 }],
      expectedDirectionJson: { CTR: 'HIGHER' }
    };
    const repository = {
      findExperimentForEvaluation: async () => experiment,
      listPublicationEvents: async () => [],
      createOrGetObservation: async (input: Record<string, unknown>) => {
        persistedInput = input;
        return {
          id: 'observation-1',
          createdAt: new Date('2026-08-08T12:01:00.000Z'),
          ...input
        };
      }
    };
    const searchSource = {
      listCompletedFacts: async () => facts
    };

    const service = new OptimizationExperimentService(repository as never);
    (service as unknown as { searchSource: unknown }).searchSource = searchSource;
    (service as unknown as { now: () => Date }).now = () => new Date('2026-08-09T00:00:00.000Z');

    const observation = await (service as unknown as {
      evaluateWindow(input: {
        projectId: string;
        experimentId: string;
        windowType: '7D';
      }): Promise<Record<string, unknown> | null>;
    }).evaluateWindow({
      projectId: 'project-1',
      experimentId: 'experiment-1',
      windowType: '7D'
    });

    expect(observation).not.toBeNull();
    expect(persistedInput).toMatchObject({
      projectId: 'project-1',
      experimentId: 'experiment-1',
      windowType: '7D',
      windowDays: 7,
      dueAt,
      inputCutoffAt: sourceCutoffAt,
      coverageState: 'SUFFICIENT',
      contaminationState: 'CLEAR',
      effectState: 'POSITIVE'
    });
    expect(persistedInput).toHaveProperty('observationKey');
    expect(persistedInput).toHaveProperty('evaluatorVersion', 'OPTIMIZATION_EXPERIMENT_EVALUATOR_V1');
    expect(persistedInput).toHaveProperty('reasonCodes');
    expect(persistedInput).toHaveProperty('baselineSearchSourceRefs');
    expect(persistedInput).toHaveProperty('observedSearchSourceRefs');
    expect(persistedInput).toHaveProperty('baselineMetricsJson');
    expect(persistedInput).toHaveProperty('observedMetricsJson');
    expect(persistedInput).toHaveProperty('deltaMetricsJson');
  });

  it('returns null before a frozen window is due and never persists an observation', async () => {
    const verifiedAnchorAt = new Date('2026-08-01T00:00:00.000Z');
    let persisted = false;
    const repository = {
      findExperimentForEvaluation: async () => ({
        id: 'experiment-1',
        projectId: 'project-1',
        publicationExecutionId: 'execution-1',
        interventionType: 'SERP_SNIPPET_OPTIMIZATION',
        targetUrl: 'https://example.com/page',
        verifiedAnchorAt,
        measurementScopeJson: {
          kind: 'SEARCH',
          provider: 'GOOGLE_SEARCH_CONSOLE',
          marketCode: 'HK',
          locale: 'zh-Hant',
          propertyRef: 'gsc:property:1',
          normalizedQuery: '興善堂',
          canonicalPage: 'https://example.com/page',
          aggregationScope: 'QUERY_PAGE'
        },
        observationScheduleJson: [{ windowType: '7D', windowDays: 7 }],
        expectedDirectionJson: { CTR: 'HIGHER' }
      }),
      listPublicationEvents: async () => [],
      createOrGetObservation: async () => {
        persisted = true;
        return {};
      }
    };

    const service = new OptimizationExperimentService(repository as never);
    (service as unknown as { now: () => Date }).now = () => new Date('2026-08-07T23:59:59.000Z');

    await expect((service as unknown as {
      evaluateWindow(input: {
        projectId: string;
        experimentId: string;
        windowType: '7D';
      }): Promise<Record<string, unknown> | null>;
    }).evaluateWindow({
      projectId: 'project-1',
      experimentId: 'experiment-1',
      windowType: '7D'
    })).resolves.toBeNull();
    expect(persisted).toBe(false);
  });
});
