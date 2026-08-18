import { describe, expect, it } from 'vitest';
import { buildCompetitorGaps, type CompetitorMetrics } from '../../src/modules/competitor/competitor-comparison.js';

const owned: CompetitorMetrics = {
  pagesSampled: 10,
  successShare: 1,
  averageWordCount: 900,
  titlePresenceShare: 1,
  h1PresenceShare: 1,
  averageHeadingCount: 5,
  averageInternalLinkCount: 6,
  structuredDataPresenceShare: 0.8,
  indexableShare: null
};

describe('COMPETITOR_COMPARISON_V1', () => {
  it('computes only arithmetic comparable gaps', () => {
    const gaps = buildCompetitorGaps(owned, { ...owned, averageWordCount: 1200, averageInternalLinkCount: 3 });
    expect(gaps.find((gap) => gap.metric === 'averageWordCount')).toMatchObject({ delta: -300, state: 'BEHIND' });
    expect(gaps.find((gap) => gap.metric === 'averageInternalLinkCount')).toMatchObject({ delta: 3, state: 'AHEAD' });
  });

  it('preserves unknown metrics', () => {
    const gaps = buildCompetitorGaps(owned, { ...owned, indexableShare: 0.9 });
    expect(gaps.find((gap) => gap.metric === 'indexableShare')).toMatchObject({ delta: null, state: 'UNKNOWN' });
  });
});
