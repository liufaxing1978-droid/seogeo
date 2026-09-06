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

function is2xx(snapshot: ComparableSnapshot): boolean {
  return snapshot.statusCode !== null && snapshot.statusCode >= 200 && snapshot.statusCode < 300;
}

function isHtml(snapshot: ComparableSnapshot): boolean {
  return snapshot.contentType !== null && /^(text\/html|application\/xhtml\+xml)\b/i.test(snapshot.contentType.trim());
}

function isEligibleSnapshot(snapshot: ComparableSnapshot): boolean {
  return snapshot.indexable === true && is2xx(snapshot) && isHtml(snapshot) && Number.isFinite(snapshot.capturedAt.getTime());
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

  if (!previous || !current || previous === current || !Number.isFinite(previous.capturedAt.getTime()) || !Number.isFinite(current.capturedAt.getTime())) {
    return evaluation(
      'INSUFFICIENT_COMPARABLE_HISTORY', 'UNKNOWN', 'CONTENT_DECAY', 'MEDIUM',
      'At least two persisted, indexable 2xx HTML snapshots are required for a like-for-like decay comparison.',
      { sourceReferences: [] }
    );
  }

  if (previous.indexable === true && current.indexable === false) {
    return evaluation(
      'CONTENT_DECAY_INDEXABILITY_LOST', 'FAIL', 'CONTENT_DECAY', 'HIGH',
      'The persisted snapshots show a loss of indexability; review manually.',
      decayEvidence(previous, current)
    );
  }

  if (is2xx(previous) && isHtml(previous) && current.statusCode !== null && !is2xx(current)) {
    return evaluation(
      'CONTENT_DECAY_HTTP_ELIGIBILITY_LOST', 'FAIL', 'CONTENT_DECAY', 'HIGH',
      'The persisted snapshots show a 2xx HTML page becoming non-2xx; review manually.',
      decayEvidence(previous, current)
    );
  }

  if (is2xx(previous) && isHtml(previous) && is2xx(current) && current.contentType !== null && !isHtml(current)) {
    return evaluation(
      'CONTENT_DECAY_HTML_ELIGIBILITY_LOST', 'FAIL', 'CONTENT_DECAY', 'HIGH',
      'The persisted snapshots show a 2xx HTML page becoming non-HTML; review manually.',
      decayEvidence(previous, current)
    );
  }

  if (!isEligibleSnapshot(previous) || !isEligibleSnapshot(current)) {
    return evaluation(
      'INSUFFICIENT_COMPARABLE_HISTORY', 'UNKNOWN', 'CONTENT_DECAY', 'MEDIUM',
      'At least two persisted, indexable 2xx HTML snapshots are required for a like-for-like decay comparison.',
      decayEvidence(previous, current)
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

  const previousTitlePresent = present(previous.title);
  const currentTitlePresent = present(current.title);
  if (previousTitlePresent === true && currentTitlePresent === false) {
    return evaluation(
      'CONTENT_DECAY_TITLE_REMOVED', 'FAIL', 'CONTENT_DECAY', 'HIGH',
      'The persisted comparable snapshots show title removal; review manually.',
      decayEvidence(previous, current)
    );
  }

  const previousH1Present = present(previous.h1);
  const currentH1Present = present(current.h1);
  if (previousH1Present === true && currentH1Present === false) {
    return evaluation(
      'CONTENT_DECAY_H1_REMOVED', 'FAIL', 'CONTENT_DECAY', 'HIGH',
      'The persisted comparable snapshots show H1 removal; review manually.',
      decayEvidence(previous, current)
    );
  }

  if (wordCountDrop === null || previousTitlePresent === null || currentTitlePresent === null || previousH1Present === null || currentH1Present === null) {
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
  const snapshotSourceReferences = signal?.sourceReferences.filter((reference) => reference.type === 'PAGE_SNAPSHOT') ?? [];
  const sourceReferences: ContentQualityEvidence['sourceReferences'] = [
    ...(opportunity ? [{ type: 'CONTENT_OPPORTUNITY' as const, id: opportunity.id }] : []),
    ...(signal ? [{ type: 'CONTENT_SIGNAL' as const, id: signal.id }] : []),
    ...snapshotSourceReferences
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

  const relationshipMatches = opportunity !== null && signal !== null
    && opportunity.contentDocumentId === signal.contentDocumentId
    && opportunity.opportunityVersion === signal.ruleVersion
    && opportunity.opportunityKey === `${signal.ruleKey}:v${signal.ruleVersion}`;
  if (!relationshipMatches || snapshotSourceReferences.length === 0 || signal === null || signal.status === 'UNKNOWN') {
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
