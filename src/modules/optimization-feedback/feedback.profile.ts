import type { OptimizationFeedbackEvidence } from '@prisma/client';
import { OPTIMIZATION_FEEDBACK_WINDOW_LIMIT } from './feedback.types.js';

export type FeedbackProfileCalculation = {
  orderedEvidenceIds: string[];
  sampleCount: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  rollingEffectBalance: number;
  historicalRankAdjustment: number;
  oldestEvidenceCutoffAt: Date;
  newestEvidenceCutoffAt: Date;
};

type FeedbackProfileEvidence = Pick<
  OptimizationFeedbackEvidence,
  'id' | 'observationId' | 'effectState' | 'inputCutoffAt'
>;

function assertUniqueEvidence(evidence: readonly FeedbackProfileEvidence[]): void {
  const evidenceIds = new Set<string>();
  const observationIds = new Set<string>();

  for (const item of evidence) {
    if (evidenceIds.has(item.id)) {
      throw new Error('FEEDBACK_PROFILE_DUPLICATE_EVIDENCE_ID');
    }
    if (observationIds.has(item.observationId)) {
      throw new Error('FEEDBACK_PROFILE_DUPLICATE_OBSERVATION_ID');
    }
    if (!Number.isFinite(item.inputCutoffAt.getTime())) {
      throw new Error('FEEDBACK_PROFILE_INVALID_CUTOFF');
    }
    evidenceIds.add(item.id);
    observationIds.add(item.observationId);
  }
}

export function calculateFeedbackProfile(
  evidence: readonly FeedbackProfileEvidence[]
): FeedbackProfileCalculation {
  if (evidence.length === 0) {
    throw new Error('FEEDBACK_PROFILE_EMPTY_EVIDENCE');
  }

  assertUniqueEvidence(evidence);

  const ordered = [...evidence]
    .sort((left, right) => (
      left.inputCutoffAt.getTime() - right.inputCutoffAt.getTime()
      || left.observationId.localeCompare(right.observationId)
    ))
    .slice(-OPTIMIZATION_FEEDBACK_WINDOW_LIMIT);

  let positiveCount = 0;
  let neutralCount = 0;
  let negativeCount = 0;

  for (const item of ordered) {
    if (item.effectState === 'POSITIVE') positiveCount += 1;
    else if (item.effectState === 'NEUTRAL') neutralCount += 1;
    else if (item.effectState === 'NEGATIVE') negativeCount += 1;
  }

  const sampleCount = positiveCount + neutralCount + negativeCount;
  let rollingEffectBalance = 0;
  let historicalRankAdjustment = 0;

  if (sampleCount >= 3) {
    rollingEffectBalance = (positiveCount - negativeCount) / sampleCount;
    const shrinkage = sampleCount / (sampleCount + 5);
    const raw = -10 * rollingEffectBalance * shrinkage;
    const rounded = Math.round(raw);
    historicalRankAdjustment = rounded === 0
      ? 0
      : Math.max(-10, Math.min(10, rounded));
  }

  const oldest = ordered[0]!;
  const newest = ordered[ordered.length - 1]!;

  return {
    orderedEvidenceIds: ordered.map((item) => item.id),
    sampleCount,
    positiveCount,
    neutralCount,
    negativeCount,
    rollingEffectBalance,
    historicalRankAdjustment,
    oldestEvidenceCutoffAt: oldest.inputCutoffAt,
    newestEvidenceCutoffAt: newest.inputCutoffAt
  };
}
