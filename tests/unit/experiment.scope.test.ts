import { describe, expect, it } from 'vitest';
import {
  normalizeExperimentHttpUrl,
  resolveExperimentMeasurementScope,
  type ExperimentScopeCandidate
} from '../../src/modules/optimization-experiments/experiment.scope.js';

const targetUrl = 'https://example.com/page';

function candidate(overrides: Partial<ExperimentScopeCandidate> = {}): ExperimentScopeCandidate {
  return {
    id: 'candidate-1',
    projectId: 'project-1',
    growthSnapshotId: 'snapshot-1',
    marketScopeMode: 'CONFIGURED_MARKET',
    marketCode: 'HK',
    locale: 'zh-Hant',
    normalizedQuery: '興善堂',
    canonicalPage: targetUrl,
    sourceProvenance: {
      version: 'GROWTH_SEARCH_PROVENANCE_V1',
      mode: 'CONFIGURED_MARKET',
      scoringLane: {
        provider: 'GOOGLE_SEARCH_CONSOLE',
        factKind: 'QUERY_PAGE',
        snapshotIds: ['snapshot-1'],
        sourceRefs: ['source-1'],
        marketProjections: [
          { marketCode: 'HK', locale: 'zh-Hant', propertyRef: 'gsc:property:1' }
        ]
      },
      corroboratingLanes: []
    },
    ...overrides
  };
}

type VisibilityScopeFact = {
  evidence: {
    snapshotId: string;
    projectId: string;
    sourceModule: string;
    sourceType: string;
    sourceId: string;
    sourceFactVersion: string;
    ruleKey: string;
  };
  row: {
    id: string;
    projectId: string;
    visibilityMetricSnapshotId: string;
    metricType: 'MENTION_RATE' | 'CITATION_RATE' | 'MENTION_SHARE_OF_VOICE';
    dimensionType: string;
    dimensionKey: string;
    actorType: string;
    actorKey: string;
  };
  snapshot: {
    id: string;
    projectId: string;
    status: string;
    formulaVersion: string;
    extractorVersion: string;
    subjectSetHash: string;
    scopeHash: string;
  };
};

function visibilityFact(
  metricType: 'MENTION_RATE' | 'CITATION_RATE',
  overrides: Partial<VisibilityScopeFact> = {}
): VisibilityScopeFact {
  const rowId = metricType === 'CITATION_RATE' ? 'row-citation' : 'row-mention';
  const ruleKey = metricType === 'CITATION_RATE' ? 'P6_CITATION_RATE' : 'P6_MENTION_RATE';
  return {
    evidence: {
      snapshotId: 'snapshot-1',
      projectId: 'project-1',
      sourceModule: 'P6_VISIBILITY',
      sourceType: 'VISIBILITY_METRIC_ROW',
      sourceId: rowId,
      sourceFactVersion: 'VISIBILITY_FORMULA_V1:metric-snapshot-1',
      ruleKey
    },
    row: {
      id: rowId,
      projectId: 'project-1',
      visibilityMetricSnapshotId: 'metric-snapshot-1',
      metricType,
      dimensionType: 'OVERALL',
      dimensionKey: 'OVERALL',
      actorType: 'OWNED_ROLLUP',
      actorKey: 'owned-rollup'
    },
    snapshot: {
      id: 'metric-snapshot-1',
      projectId: 'project-1',
      status: 'COMPLETED',
      formulaVersion: 'VISIBILITY_FORMULA_V1',
      extractorVersion: 'VISIBILITY_EXTRACTOR_V1',
      subjectSetHash: 'subject-set-1',
      scopeHash: 'scope-1'
    },
    ...overrides
  };
}

function visibilityInput(
  interventionType: 'GEO_CITABILITY_IMPROVEMENT' | 'AI_VISIBILITY_IMPROVEMENT',
  facts: readonly VisibilityScopeFact[]
) {
  return {
    projectId: 'project-1',
    interventionType,
    targetUrl,
    candidate: candidate(),
    visibilitySource: {
      listVisibilityScopeFacts: async () => facts
    }
  } as unknown as Parameters<typeof resolveExperimentMeasurementScope>[0];
}

describe('P9-D experiment measurement scope', () => {
  it('normalizes bounded HTTP(S) URLs by removing fragments only', () => {
    expect(normalizeExperimentHttpUrl('https://example.com/page?x=1#fragment'))
      .toBe('https://example.com/page?x=1');
    expect(() => normalizeExperimentHttpUrl('ftp://example.com/page'))
      .toThrow('EXPERIMENT_URL_INVALID');
    expect(() => normalizeExperimentHttpUrl(`https://example.com/${'x'.repeat(2_100)}`))
      .toThrow('EXPERIMENT_URL_INVALID');
  });

  it.each([
    'SERP_SNIPPET_OPTIMIZATION',
    'ON_PAGE_OPTIMIZATION',
    'CONTENT_REFRESH'
  ] as const)('resolves exact configured-market query-page scope for %s', async (interventionType) => {
    await expect(resolveExperimentMeasurementScope({
      projectId: 'project-1',
      interventionType,
      targetUrl,
      candidate: candidate()
    })).resolves.toEqual({
      kind: 'SEARCH',
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'HK',
      locale: 'zh-Hant',
      propertyRef: 'gsc:property:1',
      normalizedQuery: '興善堂',
      canonicalPage: targetUrl,
      aggregationScope: 'QUERY_PAGE'
    });
  });

  it('uses query-only scope for CONTENT_CREATION without manufacturing a page baseline', async () => {
    await expect(resolveExperimentMeasurementScope({
      projectId: 'project-1',
      interventionType: 'CONTENT_CREATION',
      targetUrl,
      candidate: candidate({ canonicalPage: null })
    })).resolves.toEqual({
      kind: 'SEARCH',
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'HK',
      locale: 'zh-Hant',
      propertyRef: 'gsc:property:1',
      normalizedQuery: '興善堂',
      canonicalPage: null,
      aggregationScope: 'QUERY'
    });
  });

  it.each([
    ['legacy scope', { marketScopeMode: 'UNCONFIGURED_LEGACY' }],
    ['missing market', { marketCode: null }],
    ['missing locale', { locale: null }],
    ['blank query', { normalizedQuery: '   ' }],
    ['wrong canonical page', { canonicalPage: 'https://example.com/other' }],
    ['wrong provenance version', {
      sourceProvenance: { version: 'OLD', mode: 'CONFIGURED_MARKET', scoringLane: {} }
    }],
    ['ambiguous projection', {
      sourceProvenance: {
        version: 'GROWTH_SEARCH_PROVENANCE_V1',
        mode: 'CONFIGURED_MARKET',
        scoringLane: {
          provider: 'GOOGLE_SEARCH_CONSOLE',
          marketProjections: [
            { marketCode: 'HK', locale: 'zh-Hant', propertyRef: 'one' },
            { marketCode: 'HK', locale: 'zh-Hant', propertyRef: 'two' }
          ]
        }
      }
    }]
  ] as const)('fails closed for %s', async (_label, overrides) => {
    await expect(resolveExperimentMeasurementScope({
      projectId: 'project-1',
      interventionType: 'SERP_SNIPPET_OPTIMIZATION',
      targetUrl,
      candidate: candidate(overrides as Partial<ExperimentScopeCandidate>)
    })).resolves.toBeNull();
  });

  it('freezes GEO citability scope from the exact P6 citation evidence row', async () => {
    await expect(resolveExperimentMeasurementScope(
      visibilityInput('GEO_CITABILITY_IMPROVEMENT', [visibilityFact('CITATION_RATE')])
    )).resolves.toEqual({
      kind: 'VISIBILITY',
      metricType: 'CITATION_RATE',
      subjectSetHash: 'subject-set-1',
      scopeHash: 'scope-1',
      formulaVersion: 'VISIBILITY_FORMULA_V1',
      extractorVersion: 'VISIBILITY_EXTRACTOR_V1',
      dimensionType: 'OVERALL',
      dimensionKey: 'OVERALL',
      actorType: 'OWNED_ROLLUP',
      actorKey: 'owned-rollup'
    });
  });

  it('uses mention rate for AI visibility when exact mention and citation evidence both exist', async () => {
    await expect(resolveExperimentMeasurementScope(
      visibilityInput('AI_VISIBILITY_IMPROVEMENT', [
        visibilityFact('CITATION_RATE'),
        visibilityFact('MENTION_RATE')
      ])
    )).resolves.toMatchObject({
      kind: 'VISIBILITY',
      metricType: 'MENTION_RATE'
    });
  });

  it('uses citation for AI visibility only when it is the sole exact immutable visibility target', async () => {
    await expect(resolveExperimentMeasurementScope(
      visibilityInput('AI_VISIBILITY_IMPROVEMENT', [visibilityFact('CITATION_RATE')])
    )).resolves.toMatchObject({
      kind: 'VISIBILITY',
      metricType: 'CITATION_RATE'
    });
  });

  it.each([
    ['wrong evidence project', [visibilityFact('CITATION_RATE', {
      evidence: { ...visibilityFact('CITATION_RATE').evidence, projectId: 'project-2' }
    })]],
    ['wrong source fact version', [visibilityFact('CITATION_RATE', {
      evidence: { ...visibilityFact('CITATION_RATE').evidence, sourceFactVersion: 'wrong' }
    })]],
    ['wrong row dimension', [visibilityFact('CITATION_RATE', {
      row: { ...visibilityFact('CITATION_RATE').row, dimensionType: 'PROVIDER' }
    })]],
    ['wrong actor', [visibilityFact('CITATION_RATE', {
      row: { ...visibilityFact('CITATION_RATE').row, actorType: 'COMPETITOR' }
    })]],
    ['ambiguous citation evidence', [visibilityFact('CITATION_RATE'), visibilityFact('CITATION_RATE', {
      evidence: { ...visibilityFact('CITATION_RATE').evidence, sourceId: 'row-citation-2' },
      row: { ...visibilityFact('CITATION_RATE').row, id: 'row-citation-2' }
    })]]
  ] as const)('fails closed for visibility %s', async (_label, facts) => {
    await expect(resolveExperimentMeasurementScope(
      visibilityInput('GEO_CITABILITY_IMPROVEMENT', facts as readonly VisibilityScopeFact[])
    )).resolves.toBeNull();
  });

  it('does not resolve unsupported interventions as a measurement scope', async () => {
    await expect(resolveExperimentMeasurementScope({
      projectId: 'project-1',
      interventionType: 'TECHNICAL_SEO_REMEDIATION',
      targetUrl,
      candidate: candidate()
    })).resolves.toBeNull();
  });
});
