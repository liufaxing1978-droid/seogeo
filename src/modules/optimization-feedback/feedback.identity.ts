import { createHash } from 'node:crypto';
import {
  OPTIMIZATION_FEEDBACK_EVIDENCE_VERSION,
  OPTIMIZATION_FEEDBACK_PROFILE_VERSION,
  OPTIMIZATION_FEEDBACK_SCOPE_VERSION,
  type FeedbackMarketScopeMode
} from './feedback.types.js';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

function sha256(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

export function buildFeedbackScopeKey(input: {
  projectId: string;
  marketScopeMode: FeedbackMarketScopeMode;
  marketCode: string | null;
  locale: string | null;
  recommendedActionType: string;
}): string {
  return sha256({
    feedbackScopeVersion: OPTIMIZATION_FEEDBACK_SCOPE_VERSION,
    projectId: input.projectId,
    marketScopeMode: input.marketScopeMode,
    marketCode: input.marketCode,
    locale: input.locale,
    recommendedActionType: input.recommendedActionType
  });
}

export function buildFeedbackEvidenceKey(input: {
  projectId: string;
  experimentId: string;
  observationId: string;
  scopeKey: string;
}): string {
  return sha256({
    feedbackEvidenceVersion: OPTIMIZATION_FEEDBACK_EVIDENCE_VERSION,
    projectId: input.projectId,
    experimentId: input.experimentId,
    observationId: input.observationId,
    scopeKey: input.scopeKey
  });
}

export function buildFeedbackProfileIdentity(input: {
  projectId: string;
  scopeKey: string;
  orderedEvidenceIds: readonly string[];
}): { inputFingerprint: string; profileKey: string } {
  const inputFingerprint = sha256({
    feedbackProfileVersion: OPTIMIZATION_FEEDBACK_PROFILE_VERSION,
    scopeKey: input.scopeKey,
    orderedEvidenceIds: [...input.orderedEvidenceIds]
  });

  return {
    inputFingerprint,
    profileKey: sha256({
      feedbackProfileVersion: OPTIMIZATION_FEEDBACK_PROFILE_VERSION,
      projectId: input.projectId,
      scopeKey: input.scopeKey,
      inputFingerprint
    })
  };
}
