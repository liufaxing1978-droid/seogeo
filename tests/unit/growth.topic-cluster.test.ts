import { describe, expect, it } from 'vitest';
import { resolveTopicAssignment, scoreTopicCluster } from '../../src/modules/growth/topic-cluster.js';

describe('P7-A deterministic Topic Cluster contracts', () => {
  it('uses P3 entity/topic first, alias second, normalized primary Query third, then UNCLUSTERED', () => {
    expect(resolveTopicAssignment({
      normalizedQuery: '六壬仙师',
      p3Topic: { entityId: 'entity-1', topicKey: 'liuren', primaryQuery: '六壬' },
      aliasMap: { '六壬仙师': '六壬' },
      primaryQuery: '六壬仙师'
    })).toMatchObject({ source: 'P3_ENTITY', topicKey: 'entity:entity-1', primaryQuery: '六壬' });

    expect(resolveTopicAssignment({
      normalizedQuery: '六壬仙师', aliasMap: { '六壬仙师': '六壬' }, primaryQuery: '六壬仙师'
    })).toEqual({ source: 'ALIAS', topicKey: 'query:六壬', primaryQuery: '六壬', primaryEntityId: null });

    expect(resolveTopicAssignment({ normalizedQuery: '六壬历史', primaryQuery: '六壬历史' }))
      .toEqual({ source: 'PRIMARY_QUERY', topicKey: 'query:六壬历史', primaryQuery: '六壬历史', primaryEntityId: null });

    expect(resolveTopicAssignment({ normalizedQuery: '', primaryQuery: null }))
      .toEqual({ source: 'UNCLUSTERED', topicKey: 'UNCLUSTERED', primaryQuery: 'UNCLUSTERED', primaryEntityId: null });
  });

  it('scores Topic as top opportunity 50%, demand-weighted opportunities 30%, trend/visibility 20%', () => {
    const result = scoreTopicCluster({
      opportunities: [
        { score: 80, demand: 100 },
        { score: 60, demand: 50 }
      ],
      trendVisibilityScore: 40
    });
    // top=80; demand weighted=(80*100+60*50)/150=73.333; trend=40
    expect(result.score).toBe(70);
    expect(result.availableWeight).toBe(100);
    expect(result.rankingEligible).toBe(true);
  });

  it('normalizes over known topic weights and marks insufficient evidence UNKNOWN', () => {
    const partial = scoreTopicCluster({
      opportunities: [{ score: 80, demand: 100 }],
      trendVisibilityScore: null
    });
    expect(partial.score).toBe(80);
    expect(partial.availableWeight).toBe(80);
    expect(partial.evidenceQuality).toBe('PARTIAL');

    const unknown = scoreTopicCluster({ opportunities: [], trendVisibilityScore: 40 });
    expect(unknown.score).toBeNull();
    expect(unknown.availableWeight).toBe(20);
    expect(unknown.evidenceQuality).toBe('UNKNOWN');
    expect(unknown.rankingEligible).toBe(false);
  });
});
