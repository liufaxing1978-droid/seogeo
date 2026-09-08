import { describe, expect, it } from 'vitest';
import {
  evaluateContentDecay,
  evaluateInternalLinkSupport,
  surfaceContentQaFinding,
  surfaceContentQaFindings
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

  it('fails an observed loss of indexability before content comparability gating', () => {
    expect(evaluateContentDecay([
      eligibleSnapshot({ id: 'older' }),
      eligibleSnapshot({ id: 'newer', capturedAt: new Date('2026-09-02T00:00:00.000Z'), indexable: false })
    ])).toMatchObject({ status: 'FAIL', findingKey: 'CONTENT_DECAY_INDEXABILITY_LOST' });
  });

  it('fails an observed 2xx HTML to non-2xx regression before content comparability gating', () => {
    expect(evaluateContentDecay([
      eligibleSnapshot({ id: 'older' }),
      eligibleSnapshot({ id: 'newer', capturedAt: new Date('2026-09-02T00:00:00.000Z'), statusCode: 404 })
    ])).toMatchObject({ status: 'FAIL', findingKey: 'CONTENT_DECAY_HTTP_ELIGIBILITY_LOST' });
  });

  it('fails an observed 2xx HTML to non-HTML regression before content comparability gating', () => {
    expect(evaluateContentDecay([
      eligibleSnapshot({ id: 'older' }),
      eligibleSnapshot({ id: 'newer', capturedAt: new Date('2026-09-02T00:00:00.000Z'), contentType: 'application/pdf' })
    ])).toMatchObject({ status: 'FAIL', findingKey: 'CONTENT_DECAY_HTML_ELIGIBILITY_LOST' });
  });

  it('returns UNKNOWN when stable word count cannot rule out title and H1 decay', () => {
    expect(evaluateContentDecay([
      eligibleSnapshot({ id: 'older', wordCount: 900, title: null, h1: null }),
      eligibleSnapshot({ id: 'newer', capturedAt: new Date('2026-09-02T00:00:00.000Z'), wordCount: 900, title: null, h1: null })
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
      { id: 'opportunity-1', contentDocumentId: 'document-1', opportunityKey: 'CONTENT_BODY_SUBSTANTIVE:v1', opportunityVersion: 1, status: 'OPEN', priority: 'HIGH' },
      {
        id: 'signal-1', contentDocumentId: 'document-1', ruleKey: 'CONTENT_BODY_SUBSTANTIVE', ruleVersion: 1, status: 'FAIL',
        sourceReferences: [{ type: 'PAGE_SNAPSHOT', id: 'snapshot-current' }]
      }
    )).toMatchObject({
      status: 'FAIL',
      findingKey: 'CONTENT_QA_P5A_FAILED_OPPORTUNITY',
      category: 'CONTENT_QA',
      evidence: {
        p5OpportunityId: 'opportunity-1',
        p5SignalId: 'signal-1',
        p5OpportunityStatus: 'OPEN',
        p5SignalStatus: 'FAIL',
        sourceReferences: expect.arrayContaining([{ type: 'PAGE_SNAPSHOT', id: 'snapshot-current' }])
      }
    });
  });

  it('does not surface QA evidence when the P5-A opportunity and signal do not prove the same rule and document', () => {
    expect(surfaceContentQaFinding(
      { id: 'opportunity-1', contentDocumentId: 'document-1', opportunityKey: 'CONTENT_BODY_SUBSTANTIVE:v1', opportunityVersion: 1, status: 'OPEN', priority: 'HIGH' },
      {
        id: 'signal-1', contentDocumentId: 'document-2', ruleKey: 'CONTENT_H1_PRESENT', ruleVersion: 1, status: 'FAIL',
        sourceReferences: [{ type: 'PAGE_SNAPSHOT', id: 'snapshot-current' }]
      }
    )).toMatchObject({ status: 'UNKNOWN', findingKey: 'CONTENT_QA_P5A_FAILED_OPPORTUNITY' });
  });

  it('does not surface QA evidence without the persisted P5-A snapshot reference', () => {
    expect(surfaceContentQaFinding(
      { id: 'opportunity-1', contentDocumentId: 'document-1', opportunityKey: 'CONTENT_BODY_SUBSTANTIVE:v1', opportunityVersion: 1, status: 'OPEN', priority: 'HIGH' },
      { id: 'signal-1', contentDocumentId: 'document-1', ruleKey: 'CONTENT_BODY_SUBSTANTIVE', ruleVersion: 1, status: 'FAIL', sourceReferences: [] }
    )).toMatchObject({ status: 'UNKNOWN', findingKey: 'CONTENT_QA_P5A_FAILED_OPPORTUNITY' });
  });

  it('surfaces each independently matching actionable P5-A failure once and excludes duplicate internal-link or ignored evidence', () => {
    const opportunities = [
      { id: 'body-opportunity', contentDocumentId: 'document-1', opportunityKey: 'CONTENT_BODY_SUBSTANTIVE:v1', opportunityVersion: 1, status: 'OPEN' as const, priority: 'HIGH' as const },
      { id: 'title-opportunity', contentDocumentId: 'document-1', opportunityKey: 'CONTENT_TITLE_PRESENT:v1', opportunityVersion: 1, status: 'IN_PROGRESS' as const, priority: 'HIGH' as const },
      { id: 'ignored-opportunity', contentDocumentId: 'document-1', opportunityKey: 'CONTENT_H1_PRESENT:v1', opportunityVersion: 1, status: 'IGNORED' as const, priority: 'HIGH' as const },
      { id: 'link-opportunity', contentDocumentId: 'document-1', opportunityKey: 'CONTENT_INTERNAL_LINK_SUPPORT:v1', opportunityVersion: 1, status: 'OPEN' as const, priority: 'MEDIUM' as const },
    ];
    const signals = [
      { id: 'body-signal', contentDocumentId: 'document-1', ruleKey: 'CONTENT_BODY_SUBSTANTIVE', ruleVersion: 1, status: 'FAIL' as const, sourceReferences: [{ type: 'PAGE_SNAPSHOT' as const, id: 'snapshot-current' }] },
      { id: 'title-signal', contentDocumentId: 'document-1', ruleKey: 'CONTENT_TITLE_PRESENT', ruleVersion: 1, status: 'FAIL' as const, sourceReferences: [{ type: 'PAGE_SNAPSHOT' as const, id: 'snapshot-current' }] },
      { id: 'ignored-signal', contentDocumentId: 'document-1', ruleKey: 'CONTENT_H1_PRESENT', ruleVersion: 1, status: 'FAIL' as const, sourceReferences: [{ type: 'PAGE_SNAPSHOT' as const, id: 'snapshot-current' }] },
      { id: 'link-signal', contentDocumentId: 'document-1', ruleKey: 'CONTENT_INTERNAL_LINK_SUPPORT', ruleVersion: 1, status: 'FAIL' as const, sourceReferences: [{ type: 'PAGE_SNAPSHOT' as const, id: 'snapshot-current' }] },
    ];

    expect(surfaceContentQaFindings(opportunities, signals)).toMatchObject([
      { status: 'FAIL', findingKey: 'CONTENT_QA_P5A_CONTENT_BODY_SUBSTANTIVE', evidence: { p5OpportunityId: 'body-opportunity', p5SignalId: 'body-signal' } },
      { status: 'FAIL', findingKey: 'CONTENT_QA_P5A_CONTENT_TITLE_PRESENT', evidence: { p5OpportunityId: 'title-opportunity', p5SignalId: 'title-signal' } },
    ]);
  });
});
