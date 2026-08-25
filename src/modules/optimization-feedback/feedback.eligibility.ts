import { OPTIMIZATION_EXPERIMENT_EVALUATOR_VERSION } from '../optimization-experiments/experiment.types.js';
import type { FeedbackEffect } from './feedback.types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = {
  '7D': 7,
  '14D': 14,
  '28D': 28,
  '56D': 56
} as const;

type FeedbackWindowType = keyof typeof WINDOW_DAYS;

export type FeedbackEligibilityReasonCode =
  | 'FEEDBACK_TERMINAL_OBSERVATION_PENDING'
  | 'FEEDBACK_EFFECT_INCONCLUSIVE'
  | 'FEEDBACK_COVERAGE_INSUFFICIENT'
  | 'FEEDBACK_CONTAMINATED'
  | 'FEEDBACK_P8_AUTHORITY_MISSING'
  | 'FEEDBACK_SCOPE_INVALID'
  | 'FEEDBACK_EVALUATOR_UNSUPPORTED'
  | 'FEEDBACK_ALREADY_ACCEPTED'
  | 'FEEDBACK_FEATURE_DISABLED';

export type FeedbackTerminalCandidate = {
  id: string;
  experimentId: string;
  observationKey: string;
  windowType: string;
  windowDays: number;
  dueAt: Date;
  inputCutoffAt: Date;
  effectState: string;
  coverageState: string;
  contaminationState: string;
  evaluatorVersion: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWindowType(value: unknown): value is FeedbackWindowType {
  return typeof value === 'string' && value in WINDOW_DAYS;
}

function terminalWindow(value: unknown): {
  windowType: FeedbackWindowType;
  windowDays: 7 | 14 | 28 | 56;
} | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const seen = new Set<FeedbackWindowType>();
  const windows: Array<{
    windowType: FeedbackWindowType;
    windowDays: 7 | 14 | 28 | 56;
  }> = [];

  for (const raw of value) {
    if (!isRecord(raw)) return null;
    const windowType = raw.windowType;
    const windowDays = raw.windowDays;
    if (
      !isWindowType(windowType)
      || windowDays !== WINDOW_DAYS[windowType]
      || seen.has(windowType)
    ) {
      return null;
    }
    seen.add(windowType);
    windows.push({ windowType, windowDays: WINDOW_DAYS[windowType] });
  }

  return windows.at(-1) ?? null;
}

function rejectionReason(
  observation: FeedbackTerminalCandidate
): FeedbackEligibilityReasonCode | null {
  if (observation.evaluatorVersion !== OPTIMIZATION_EXPERIMENT_EVALUATOR_VERSION) {
    return 'FEEDBACK_EVALUATOR_UNSUPPORTED';
  }
  if (
    observation.effectState !== 'POSITIVE'
    && observation.effectState !== 'NEUTRAL'
    && observation.effectState !== 'NEGATIVE'
  ) {
    return 'FEEDBACK_EFFECT_INCONCLUSIVE';
  }
  if (observation.coverageState !== 'SUFFICIENT') {
    return 'FEEDBACK_COVERAGE_INSUFFICIENT';
  }
  if (observation.contaminationState !== 'CLEAR') {
    return 'FEEDBACK_CONTAMINATED';
  }
  return null;
}

export function selectFeedbackObservation(input: {
  experimentId: string;
  verifiedAnchorAt: Date;
  observationScheduleJson: unknown;
  observations: readonly FeedbackTerminalCandidate[];
  acceptedExperimentId: string | null;
  p8AuthorityValid: boolean;
  scopeValid: boolean;
}):
  | { kind: 'ACCEPT'; observation: FeedbackTerminalCandidate }
  | { kind: 'DEFER'; reasonCode: FeedbackEligibilityReasonCode } {
  if (input.acceptedExperimentId !== null) {
    return { kind: 'DEFER', reasonCode: 'FEEDBACK_ALREADY_ACCEPTED' };
  }
  if (!input.p8AuthorityValid) {
    return { kind: 'DEFER', reasonCode: 'FEEDBACK_P8_AUTHORITY_MISSING' };
  }
  if (!input.scopeValid) {
    return { kind: 'DEFER', reasonCode: 'FEEDBACK_SCOPE_INVALID' };
  }

  const terminal = terminalWindow(input.observationScheduleJson);
  if (terminal === null || !Number.isFinite(input.verifiedAnchorAt.getTime())) {
    return { kind: 'DEFER', reasonCode: 'FEEDBACK_TERMINAL_OBSERVATION_PENDING' };
  }

  const dueAtMs = input.verifiedAnchorAt.getTime() + terminal.windowDays * DAY_MS;
  const candidates = input.observations
    .filter((observation) => (
      observation.experimentId === input.experimentId
      && observation.windowType === terminal.windowType
      && observation.windowDays === terminal.windowDays
      && Number.isFinite(observation.dueAt.getTime())
      && observation.dueAt.getTime() === dueAtMs
      && Number.isFinite(observation.inputCutoffAt.getTime())
    ))
    .sort((left, right) => (
      left.inputCutoffAt.getTime() - right.inputCutoffAt.getTime()
      || left.id.localeCompare(right.id)
    ));

  if (candidates.length === 0) {
    return { kind: 'DEFER', reasonCode: 'FEEDBACK_TERMINAL_OBSERVATION_PENDING' };
  }

  let firstReason: FeedbackEligibilityReasonCode | null = null;
  for (const observation of candidates) {
    const reasonCode = rejectionReason(observation);
    if (reasonCode === null) return { kind: 'ACCEPT', observation };
    firstReason ??= reasonCode;
  }

  return {
    kind: 'DEFER',
    reasonCode: firstReason ?? 'FEEDBACK_TERMINAL_OBSERVATION_PENDING'
  };
}

export function feedbackValueForEffect(effect: FeedbackEffect): -1 | 0 | 1 {
  if (effect === 'POSITIVE') return 1;
  if (effect === 'NEUTRAL') return 0;
  return -1;
}
