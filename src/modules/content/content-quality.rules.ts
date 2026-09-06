import type {
  ComparableSnapshot,
  ContentQualityCategory,
  ContentQualityEvaluation,
  ContentQualityEvidence,
  ContentQualityPriority,
  InternalLinkSupportFacts,
  P5ContentOpportunityReference,
  P5ContentSignalReference
} from './content-quality.types.js';

const V1 = 1 as const;

export const CONTENT_QUALITY_RULESET_V1 = Object.freeze({
  version: V1,
  internalLinkSupportMin: 3,
  contentDecay: Object.freeze({
    minimumWordCountDrop: 200,
    minimumWordCountDropFraction: 0.3
  })
});

function evaluation(
  findingKey: string,
  status: ContentQualityEvaluation['status'],
  category: ContentQualityCategory,
  priority: ContentQualityPriority,
  summary: string,
  evidence: Omit<ContentQualityEvidence, 'status'>
): ContentQualityEvaluation {
  return {
    findingKey,
    ruleVersion: V1,
    status,
    category,
    priority,
    summary,
    evidence: { status, ...evidence }
  };
}

function isEligibleSnapshot(snapshot: ComparableSnapshot): boolean {
  return snapshot.indexable === true
    && snapshot.statusCode !== null
    && snapshot.statusCode >= 200
    && snapshot.statusCode < 300
    && snapshot.contentType !== null
    && /^(text\/html|application\/xhtml\+xml)\b/i.test(snapshot.contentType.trim())
    && Number.isFinite(snapshot.capturedAt.getTime());
}

function orderedSnapshots(history: ComparableSnapshot[]): ComparableSnapshot[] {
  return [...history].sort((left, right) => {
    const leftTime = left.capturedAt.getTime();
    const rightTime = right.capturedAt.getTime();
    if (leftTime !== rightTime) return leftTime - rightTime;
    return left.id.localeCompare(right.id);
  });
}

function present(value: string | null): boolean | null {
  if (value === null) return null;
  return value.trim().length > 0;
}

function materialWordCountDrop(previous: number | null, current: number | null): boolean | null {
  if (previous === null || current === null || previous < 0 || current < 0) return null;
  const drop = previous - current;
  return drop >= CONTENT_QUALITY_RULESET_V1.contentDecay.minimumWordCountDrop
    && drop / previous >= CONTENT_QUALITY_RULESET_V1.contentDecay.minimumWordCountDropFraction;
}

function decayEvidence(
  previous: ComparableSnapshot,
  current: ComparableSnapshot,
  extras: Omit<ContentQualityEvidence, 'status' | 'sourceReferences' | 'previousSnapshotId' | 'currentSnapshotId'> = {}
) {
  return {
    sourceReferences: [
      { type: 'PAGE_SNAPSHOT' as const, id: previous.id },
      { type: 'PAGE_SNAPSHOT' as const, id: current.id }
    ],
    previousSnapshotId: previous.id,
    currentSnapshotId: current.id,
    ...extras
  };
}

export function evaluateInternalLinkSupport(facts: InternalLinkSupportFacts): ContentQualityEvaluation {
  const sourceReferences = [{ type: 'PAGE_SNAPSHOT' as const, id: facts.latestPageSnapshotId }];
  if (facts.internalLinkCount === null) {
    return evaluation(
      'CONTENT_INTERNAL_LINK_SUPPORT', 'UNKNOWN', 'INTERNAL_LINK_SUPPORT', 'MEDIUM',
      'Internal-link support cannot be assessed from the persisted snapshot.',
      { sourceReferences }
    );
  }

  const status = facts.internalLinkCount >= CONTENT_QUALITY_RULESET_V1.internalLinkSupportMin ? 'PASS' : 'FAIL';
  return evaluation(
    'CONTENT_INTERNAL_LINK_SUPPORT', status, 'INTERNAL_LINK_SUPPORT', 'MEDIUM',
    status === 'FAIL'
      ? 'The persisted snapshot shows insufficient aggregate internal-link support; review manually.'
      : 'The persisted snapshot meets the aggregate internal-link support threshold.',
    {
      sourceReferences,
      observedInternalLinkCount: facts.internalLinkCount,
      requiredInternalLinkCount: CONTENT_QUALITY_RULESET_V1.internalLinkSupportMin
    }
  );
}

export function evaluateContentDecay(history: ComparableSnapshot[]): ContentQualityEvaluation {
  const snapshots = orderedSnapshots(history);
  const previous = snapshots[0];
  const current = snapshots.at(-1);

  if (!previous || !current || previous === current || !isEligibleSnapshot(previous) || !isEligibleSnapshot(current)) {
    return evaluation(
      'INSUFFICIENT_COMPARABLE_HISTORY', 'UNKNOWN', 'CONTENT_DECAY', 'MEDIUM',
      'At least two persisted, indexable 2xx HTML snapshots are required for a like-for-like decay comparison.',
      { sourceReferences: [] }
    );
  }

  const wordCountDrop = materialWordCountDrop(previous.wordCount, current.wordCount);
  if (wordCountDrop) {
    return evaluation(
      'CONTENT_DECAY_WORD_COUNT_DROP', 'FAIL', 'CONTENT_DECAY', 'HIGH',
      'The persisted comparable snapshots show a material word-count decrease; review manually.',
      decayEvidence(previous, current, {
        previousWordCount: previous.wordCount ?? undefined,
        currentWordCount: current.wordCount ?? undefined,
        minimumWordCountDrop: CONTENT_QUALITY_RULESET_V1.contentDecay.minimumWordCountDrop,
        minimumWordCountDropFraction: CONTENT_QUALITY_RULESET_V1.contentDecay.minimumWordCountDropFraction
      })
    );
  }

  if (present(previous.title) === true && present(current.title) === false) {
    return evaluation(
      'CONTENT_DECAY_TITLE_REMOVED', 'FAIL', 'CONTENT_DECAY', 'HIGH',
      'The persisted comparable snapshots show title removal; review manually.',
      decayEvidence(previous, current)
    );
  }

  if (present(previous.h1) === true && present(current.h1) === false) {
    return evaluation(
      'CONTENT_DECAY_H1_REMOVED', 'FAIL', 'CONTENT_DECAY', 'HIGH',
      'The persisted comparable snapshots show H1 removal; review manually.',
      decayEvidence(previous, current)
    );
  }

  const hasObservedMeasure = wordCountDrop !== null
    || (present(previous.title) !== null && present(current.title) !== null)
    || (present(previous.h1) !== null && present(current.h1) !== null);
  if (!hasObservedMeasure) {
    return evaluation(
      'INSUFFICIENT_COMPARABLE_HISTORY', 'UNKNOWN', 'CONTENT_DECAY', 'MEDIUM',
      'Comparable snapshots lack enough persisted content facts to assess decay.',
      decayEvidence(previous, current)
    );
  }

  return evaluation(
    'CONTENT_DECAY', 'PASS', 'CONTENT_DECAY', 'MEDIUM',
    'No supported content decay was observed in the persisted comparable snapshots.',
    decayEvidence(previous, current)
  );
}

export function surfaceContentQaFinding(
  opportunity: P5ContentOpportunityReference | null,
  signal: P5ContentSignalReference | null
): ContentQualityEvaluation {
  const sourceReferences = [
    ...(opportunity ? [{ type: 'CONTENT_OPPORTUNITY' as const, id: opportunity.id }] : []),
    ...(signal ? [{ type: 'CONTENT_SIGNAL' as const, id: signal.id }] : [])
  ];
  const evidence = {
    sourceReferences,
    ...(opportunity ? {
      p5OpportunityId: opportunity.id,
      p5OpportunityKey: opportunity.opportunityKey,
      p5OpportunityVersion: opportunity.opportunityVersion,
      p5OpportunityStatus: opportunity.status
    } : {}),
    ...(signal ? {
      p5SignalId: signal.id,
      p5SignalRuleKey: signal.ruleKey,
      p5SignalRuleVersion: signal.ruleVersion,
      p5SignalStatus: signal.status
    } : {})
  };

  if (!opportunity || !signal || signal.status === 'UNKNOWN') {
    return evaluation(
      'CONTENT_QA_P5A_FAILED_OPPORTUNITY', 'UNKNOWN', 'CONTENT_QA', 'MEDIUM',
      'A persisted P5-A opportunity and signal are required to assess this QA evidence.',
      evidence
    );
  }

  const status = signal.status === 'FAIL' && opportunity.status !== 'VERIFIED_FIXED' ? 'FAIL' : 'PASS';
  return evaluation(
    'CONTENT_QA_P5A_FAILED_OPPORTUNITY', status, 'CONTENT_QA', opportunity.priority,
    status === 'FAIL'
      ? 'An existing P5-A failed opportunity is surfaced as QA evidence for manual review.'
      : 'No open P5-A failed opportunity is available to surface as QA evidence.',
    evidence
  );
}
