import { describe, expect, it } from 'vitest';
import {
  evaluateContentDecay,
  evaluateInternalLinkSupport,
  surfaceContentQaFinding
} from '../../src/modules/content/content-quality.rules.js';
import type { ComparableSnapshot } from '../../src/modules/content/content-quality.types.js';

function facts(input: { internalLinkCount?: number | null } = {}) {
  return {
    latestPageSnapshotId: 'snapshot-current',
    internalLinkCount: 3,
    ...input
  };
}

function eligibleSnapshot(input: Partial<ComparableSnapshot> = {}): ComparableSnapshot {
  return {
    id: 'snapshot-current',
    capturedAt: new Date('2026-09-01T00:00:00.000Z'),
    statusCode: 200,
    contentType: 'text/html; charset=utf-8',
    indexable: true,
    wordCount: 900,
    title: 'Useful guide',
    h1: 'Useful guide',
    ...input
  };
}

describe('content quality rules V1', () => {
  it('returns UNKNOWN instead of zero when the internal link count is absent', () => {
    expect(evaluateInternalLinkSupport(facts({ internalLinkCount: null }))).toMatchObject({ status: 'UNKNOWN' });
  });

  it('does not identify a specific internal-link source or target', () => {
    const evaluation = evaluateInternalLinkSupport(facts({ internalLinkCount: 1 }));

    expect(evaluation).toMatchObject({ status: 'FAIL', findingKey: 'CONTENT_INTERNAL_LINK_SUPPORT' });
    expect(evaluation.evidence).not.toHaveProperty('targetPageId');
    expect(evaluation.evidence).not.toHaveProperty('sourcePageId');
    expect(evaluation.evidence).toMatchObject({ observedInternalLinkCount: 1 });
  });

  it('detects only an observed comparable regression', () => {
    expect(evaluateContentDecay([
      eligibleSnapshot({ id: 'newer', capturedAt: new Date('2026-09-02T00:00:00.000Z'), wordCount: 300 }),
      eligibleSnapshot({ id: 'older', capturedAt: new Date('2026-09-01T00:00:00.000Z'), wordCount: 900 })
    ])).toMatchObject({ status: 'FAIL', findingKey: 'CONTENT_DECAY_WORD_COUNT_DROP' });
  });

  it('returns UNKNOWN when the newest snapshot is not eligible for a like-for-like comparison', () => {
    expect(evaluateContentDecay([
      eligibleSnapshot({ id: 'older' }),
      eligibleSnapshot({ id: 'newer', capturedAt: new Date('2026-09-02T00:00:00.000Z'), indexable: null, wordCount: 300 })
    ])).toMatchObject({ status: 'UNKNOWN', findingKey: 'INSUFFICIENT_COMPARABLE_HISTORY' });
  });

  it('uses snapshot id to make equal capture times deterministic', () => {
    expect(evaluateContentDecay([
      eligibleSnapshot({ id: 'z-newer', wordCount: 300 }),
      eligibleSnapshot({ id: 'a-older', wordCount: 900 })
    ])).toMatchObject({
      status: 'FAIL',
      findingKey: 'CONTENT_DECAY_WORD_COUNT_DROP',
      evidence: { previousSnapshotId: 'a-older', currentSnapshotId: 'z-newer' }
    });
  });

  it('surfaces an existing P5-A failed opportunity as immutable QA evidence', () => {
    expect(surfaceContentQaFinding(
      { id: 'opportunity-1', opportunityKey: 'CONTENT_BODY_SUBSTANTIVE:v1', opportunityVersion: 1, status: 'OPEN', priority: 'HIGH' },
      { id: 'signal-1', ruleKey: 'CONTENT_BODY_SUBSTANTIVE', ruleVersion: 1, status: 'FAIL' }
    )).toMatchObject({
      status: 'FAIL',
      findingKey: 'CONTENT_QA_P5A_FAILED_OPPORTUNITY',
      category: 'CONTENT_QA',
      evidence: {
        p5OpportunityId: 'opportunity-1',
        p5SignalId: 'signal-1',
        p5OpportunityStatus: 'OPEN',
        p5SignalStatus: 'FAIL'
      }
    });
  });
});
