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

  it('does not resolve unsupported interventions as a measurement scope', async () => {
    await expect(resolveExperimentMeasurementScope({
      projectId: 'project-1',
      interventionType: 'TECHNICAL_SEO_REMEDIATION',
      targetUrl,
      candidate: candidate()
    })).resolves.toBeNull();
  });
});
