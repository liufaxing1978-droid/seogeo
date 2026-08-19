import { describe, expect, it } from 'vitest';
import { calculateVisibilityMetrics } from '../../src/modules/visibility/visibility-metrics.calculator.js';
import type {
  CalculatedVisibilityMetricRow,
  VisibilityMetricActor,
  VisibilityMetricInputRecord
} from '../../src/modules/visibility/visibility-metrics.types.js';

const OWNED: VisibilityMetricActor = {
  actorType: 'OWNED_ROLLUP',
  actorKey: 'OWNED_ROLLUP',
  actorSubjectId: null
};
const COMPETITOR_A: VisibilityMetricActor = {
  actorType: 'COMPETITOR',
  actorKey: 'COMPETITOR:competitor-a',
  actorSubjectId: 'competitor-a'
};
const COMPETITOR_B: VisibilityMetricActor = {
  actorType: 'COMPETITOR',
  actorKey: 'COMPETITOR:competitor-b',
  actorSubjectId: 'competitor-b'
};

function record(
  observationId: string,
  overrides: Partial<VisibilityMetricInputRecord> = {}
): VisibilityMetricInputRecord {
  return {
    observationId,
    provider: 'OPENAI',
    promptSetId: 'prompt-set-a',
    promptSetName: 'Discovery',
    mentionStatus: 'KNOWN_EMPTY',
    citationStatus: 'KNOWN_EMPTY',
    ownedMentioned: false,
    competitorMentionedSubjectIds: [],
    ownedCited: false,
    competitorCitedSubjectIds: [],
    ...overrides
  };
}

function row(
  rows: CalculatedVisibilityMetricRow[],
  metricType: CalculatedVisibilityMetricRow['metricType'],
  actorKey: string,
  dimensionType: CalculatedVisibilityMetricRow['dimensionType'] = 'OVERALL',
  dimensionKey = dimensionType === 'OVERALL' ? 'OVERALL' : undefined
) {
  const found = rows.find((item) =>
    item.metricType === metricType &&
    item.actorKey === actorKey &&
    item.dimensionType === dimensionType &&
    (dimensionKey === undefined || item.dimensionKey === dimensionKey)
  );
  expect(found).toBeDefined();
  return found!;
}

describe('P6-C visibility metric calculator', () => {
  it('uses KNOWN_EMPTY as eligible denominator evidence and preserves legitimate zero', () => {
    const rows = calculateVisibilityMetrics({
      actors: [OWNED],
      records: [record('obs-1'), record('obs-2')]
    });

    const mention = row(rows, 'MENTION_RATE', 'OWNED_ROLLUP');
    const citation = row(rows, 'CITATION_RATE', 'OWNED_ROLLUP');

    expect(mention).toMatchObject({
      metricStatus: 'CALCULATED',
      numerator: 0,
      denominator: 2,
      candidateObservationCount: 2,
      eligibleObservationCount: 2,
      notEligibleObservationCount: 0,
      unknownObservationCount: 0
    });
    expect(citation).toMatchObject({
      metricStatus: 'CALCULATED',
      numerator: 0,
      denominator: 2
    });
  });

  it('never coerces UNKNOWN to zero or into a denominator', () => {
    const rows = calculateVisibilityMetrics({
      actors: [OWNED],
      records: [
        record('obs-known', { mentionStatus: 'EXTRACTED', ownedMentioned: true }),
        record('obs-unknown', { mentionStatus: 'UNKNOWN' })
      ]
    });

    expect(row(rows, 'MENTION_RATE', 'OWNED_ROLLUP')).toMatchObject({
      metricStatus: 'UNKNOWN',
      numerator: 1,
      denominator: 1,
      candidateObservationCount: 2,
      eligibleObservationCount: 1,
      unknownObservationCount: 1
    });
  });

  it('excludes NOT_ELIGIBLE without invalidating complete eligible evidence', () => {
    const rows = calculateVisibilityMetrics({
      actors: [OWNED],
      records: [
        record('obs-1', { mentionStatus: 'EXTRACTED', ownedMentioned: true }),
        record('obs-2', { mentionStatus: 'KNOWN_EMPTY' }),
        record('obs-3', { mentionStatus: 'NOT_ELIGIBLE' })
      ]
    });

    expect(row(rows, 'MENTION_RATE', 'OWNED_ROLLUP')).toMatchObject({
      metricStatus: 'CALCULATED',
      numerator: 1,
      denominator: 2,
      candidateObservationCount: 3,
      eligibleObservationCount: 2,
      notEligibleObservationCount: 1,
      unknownObservationCount: 0
    });
  });

  it('returns NOT_ELIGIBLE when every candidate is explicitly ineligible', () => {
    const rows = calculateVisibilityMetrics({
      actors: [OWNED],
      records: [
        record('obs-1', { mentionStatus: 'NOT_ELIGIBLE', citationStatus: 'NOT_ELIGIBLE' }),
        record('obs-2', { mentionStatus: 'NOT_ELIGIBLE', citationStatus: 'NOT_ELIGIBLE' })
      ]
    });

    expect(row(rows, 'MENTION_RATE', 'OWNED_ROLLUP').metricStatus).toBe('NOT_ELIGIBLE');
    expect(row(rows, 'CITATION_RATE', 'OWNED_ROLLUP').metricStatus).toBe('NOT_ELIGIBLE');
  });

  it('deduplicates actor presence per observation and makes calculated SOV numerators sum to the denominator', () => {
    const rows = calculateVisibilityMetrics({
      actors: [OWNED, COMPETITOR_A, COMPETITOR_B],
      records: [
        record('obs-1', {
          mentionStatus: 'EXTRACTED',
          ownedMentioned: true,
          competitorMentionedSubjectIds: ['competitor-a', 'competitor-a']
        }),
        record('obs-2', {
          mentionStatus: 'EXTRACTED',
          ownedMentioned: true,
          competitorMentionedSubjectIds: ['competitor-a', 'competitor-b']
        }),
        record('obs-3', {
          mentionStatus: 'EXTRACTED',
          competitorMentionedSubjectIds: ['competitor-b']
        })
      ]
    });

    const owned = row(rows, 'MENTION_SHARE_OF_VOICE', 'OWNED_ROLLUP');
    const a = row(rows, 'MENTION_SHARE_OF_VOICE', 'COMPETITOR:competitor-a');
    const b = row(rows, 'MENTION_SHARE_OF_VOICE', 'COMPETITOR:competitor-b');

    expect(owned).toMatchObject({ metricStatus: 'CALCULATED', numerator: 2, denominator: 6 });
    expect(a).toMatchObject({ metricStatus: 'CALCULATED', numerator: 2, denominator: 6 });
    expect(b).toMatchObject({ metricStatus: 'CALCULATED', numerator: 2, denominator: 6 });
    expect(owned.numerator + a.numerator + b.numerator).toBe(owned.denominator);
  });

  it('returns NO_SIGNAL for SOV when mention evidence is eligible but no monitored actor appears', () => {
    const rows = calculateVisibilityMetrics({
      actors: [OWNED, COMPETITOR_A],
      records: [record('obs-1'), record('obs-2')]
    });

    expect(row(rows, 'MENTION_SHARE_OF_VOICE', 'OWNED_ROLLUP')).toMatchObject({
      metricStatus: 'NO_SIGNAL',
      numerator: 0,
      denominator: 0,
      eligibleObservationCount: 2
    });
    expect(row(rows, 'MENTION_SHARE_OF_VOICE', 'COMPETITOR:competitor-a').metricStatus).toBe('NO_SIGNAL');
  });

  it('returns Overall NO_DATA rows when there are no candidate observations', () => {
    const rows = calculateVisibilityMetrics({ records: [], actors: [OWNED, COMPETITOR_A] });

    expect(rows).toHaveLength(6);
    for (const item of rows) {
      expect(item).toMatchObject({
        dimensionType: 'OVERALL',
        dimensionKey: 'OVERALL',
        metricStatus: 'NO_DATA',
        numerator: 0,
        denominator: 0,
        candidateObservationCount: 0
      });
    }
  });

  it('materializes independent Provider and Prompt Set dimensions and ignores actors outside the registry', () => {
    const rows = calculateVisibilityMetrics({
      actors: [OWNED, COMPETITOR_A],
      records: [
        record('obs-openai-a', {
          provider: 'OPENAI',
          promptSetId: 'set-a',
          promptSetName: 'Set A',
          mentionStatus: 'EXTRACTED',
          citationStatus: 'EXTRACTED',
          ownedMentioned: true,
          competitorMentionedSubjectIds: ['competitor-a', 'competitor-not-configured'],
          ownedCited: true
        }),
        record('obs-gemini-b', {
          provider: 'GEMINI',
          promptSetId: 'set-b',
          promptSetName: 'Set B',
          mentionStatus: 'KNOWN_EMPTY',
          citationStatus: 'KNOWN_EMPTY'
        })
      ]
    });

    expect(row(rows, 'MENTION_RATE', 'OWNED_ROLLUP', 'PROVIDER', 'OPENAI')).toMatchObject({
      metricStatus: 'CALCULATED', numerator: 1, denominator: 1
    });
    expect(row(rows, 'MENTION_RATE', 'OWNED_ROLLUP', 'PROVIDER', 'GEMINI')).toMatchObject({
      metricStatus: 'CALCULATED', numerator: 0, denominator: 1
    });
    expect(row(rows, 'CITATION_RATE', 'OWNED_ROLLUP', 'PROMPT_SET', 'set-a')).toMatchObject({
      metricStatus: 'CALCULATED', numerator: 1, denominator: 1, dimensionLabelSnapshot: 'Set A'
    });
    expect(rows.some((item) => item.actorKey === 'COMPETITOR:competitor-not-configured')).toBe(false);
  });
});