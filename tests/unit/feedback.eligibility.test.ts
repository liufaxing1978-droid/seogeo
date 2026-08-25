import { describe, expect, it } from 'vitest';
import {
  feedbackValueForEffect,
  selectFeedbackObservation
} from '../../src/modules/optimization-feedback/feedback.eligibility.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const anchor = new Date('2026-07-01T00:00:00.000Z');

function due(days: number): Date {
  return new Date(anchor.getTime() + days * DAY_MS);
}

const schedule1456 = [
  { windowType: '14D', windowDays: 14 },
  { windowType: '28D', windowDays: 28 },
  { windowType: '56D', windowDays: 56 }
] as const;

const schedule728 = [
  { windowType: '7D', windowDays: 7 },
  { windowType: '14D', windowDays: 14 },
  { windowType: '28D', windowDays: 28 }
] as const;

type Candidate = {
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

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: 'observation-1',
    experimentId: 'experiment-1',
    observationKey: 'observation-key-1',
    windowType: '56D',
    windowDays: 56,
    dueAt: due(56),
    inputCutoffAt: new Date('2026-08-27T00:00:00.000Z'),
    effectState: 'POSITIVE',
    coverageState: 'SUFFICIENT',
    contaminationState: 'CLEAR',
    evaluatorVersion: 'OPTIMIZATION_EXPERIMENT_EVALUATOR_V1',
    ...overrides
  };
}

function select(input: {
  observationScheduleJson?: unknown;
  observations?: readonly Candidate[];
  acceptedExperimentId?: string | null;
  p8AuthorityValid?: boolean;
  scopeValid?: boolean;
} = {}) {
  return selectFeedbackObservation({
    experimentId: 'experiment-1',
    verifiedAnchorAt: anchor,
    observationScheduleJson: input.observationScheduleJson ?? schedule1456,
    observations: input.observations ?? [candidate()],
    acceptedExperimentId: input.acceptedExperimentId ?? null,
    p8AuthorityValid: input.p8AuthorityValid ?? true,
    scopeValid: input.scopeValid ?? true
  });
}

describe('P9-E feedback terminal eligibility', () => {
  it('accepts only the 28D terminal window for a 7D/14D/28D schedule', () => {
    const earlier = candidate({
      id: 'observation-7d',
      observationKey: 'key-7d',
      windowType: '7D',
      windowDays: 7,
      dueAt: due(7),
      inputCutoffAt: new Date('2026-07-08T00:00:00.000Z')
    });
    const terminal = candidate({
      id: 'observation-28d',
      observationKey: 'key-28d',
      windowType: '28D',
      windowDays: 28,
      dueAt: due(28),
      inputCutoffAt: new Date('2026-07-29T00:00:00.000Z')
    });

    expect(select({ observationScheduleJson: schedule728, observations: [earlier, terminal] }))
      .toEqual({ kind: 'ACCEPT', observation: terminal });
  });

  it('accepts only the 56D terminal window for a 14D/28D/56D schedule', () => {
    const earlier = candidate({
      id: 'observation-14d',
      observationKey: 'key-14d',
      windowType: '14D',
      windowDays: 14,
      dueAt: due(14),
      effectState: 'POSITIVE'
    });
    const terminal = candidate({
      id: 'observation-56d',
      observationKey: 'key-56d',
      effectState: 'NEGATIVE'
    });

    expect(select({ observations: [earlier, terminal] }))
      .toEqual({ kind: 'ACCEPT', observation: terminal });
  });

  it('requires exact terminal dueAt derived from the frozen anchor and days', () => {
    const wrongDueAt = candidate({ dueAt: new Date(due(56).getTime() + 1) });

    expect(select({ observations: [wrongDueAt] })).toEqual({
      kind: 'DEFER',
      reasonCode: 'FEEDBACK_TERMINAL_OBSERVATION_PENDING'
    });
  });

  it('never lets an earlier positive window contribute', () => {
    const earlierPositive = candidate({
      id: 'positive-14d',
      observationKey: 'positive-14d-key',
      windowType: '14D',
      windowDays: 14,
      dueAt: due(14),
      effectState: 'POSITIVE'
    });
    const terminalNegative = candidate({
      id: 'negative-56d',
      observationKey: 'negative-56d-key',
      effectState: 'NEGATIVE'
    });

    expect(select({ observations: [earlierPositive, terminalNegative] }))
      .toEqual({ kind: 'ACCEPT', observation: terminalNegative });
  });

  it('orders terminal candidates by inputCutoffAt then observation id', () => {
    const laterCutoff = candidate({
      id: 'observation-a',
      observationKey: 'key-a',
      inputCutoffAt: new Date('2026-08-28T00:00:00.000Z')
    });
    const sameEarlyCutoffB = candidate({
      id: 'observation-b',
      observationKey: 'key-b',
      inputCutoffAt: new Date('2026-08-27T00:00:00.000Z')
    });
    const sameEarlyCutoffA = candidate({
      id: 'observation-a0',
      observationKey: 'key-a0',
      inputCutoffAt: new Date('2026-08-27T00:00:00.000Z')
    });

    expect(select({ observations: [laterCutoff, sameEarlyCutoffB, sameEarlyCutoffA] }))
      .toEqual({ kind: 'ACCEPT', observation: sameEarlyCutoffA });
  });

  it('skips an earlier inconclusive terminal observation and accepts a later eligible one', () => {
    const first = candidate({
      id: 'observation-1',
      effectState: 'INCONCLUSIVE',
      inputCutoffAt: new Date('2026-08-27T00:00:00.000Z')
    });
    const later = candidate({
      id: 'observation-2',
      observationKey: 'observation-key-2',
      inputCutoffAt: new Date('2026-08-28T00:00:00.000Z')
    });

    expect(select({ observations: [first, later] }))
      .toEqual({ kind: 'ACCEPT', observation: later });
  });

  it('skips an earlier contaminated terminal observation and accepts a later clear one', () => {
    const first = candidate({
      id: 'observation-1',
      contaminationState: 'CONFLICTING_MUTATION',
      inputCutoffAt: new Date('2026-08-27T00:00:00.000Z')
    });
    const later = candidate({
      id: 'observation-2',
      observationKey: 'observation-key-2',
      inputCutoffAt: new Date('2026-08-28T00:00:00.000Z')
    });

    expect(select({ observations: [first, later] }))
      .toEqual({ kind: 'ACCEPT', observation: later });
  });

  it('never accepts another observation after an experiment already contributed', () => {
    expect(select({ acceptedExperimentId: 'experiment-1' })).toEqual({
      kind: 'DEFER',
      reasonCode: 'FEEDBACK_ALREADY_ACCEPTED'
    });
  });

  it.each(['PARTIAL', 'INSUFFICIENT', 'UNKNOWN'])(
    'rejects %s coverage without converting it to a sample',
    (coverageState) => {
      expect(select({ observations: [candidate({ coverageState })] })).toEqual({
        kind: 'DEFER',
        reasonCode: 'FEEDBACK_COVERAGE_INSUFFICIENT'
      });
    }
  );

  it.each([
    'CONFLICTING_MUTATION',
    'TARGET_REVISION_CHANGED',
    'VERIFICATION_INVALIDATED',
    'SOURCE_IDENTITY_CHANGED',
    'UNKNOWN'
  ])('rejects contamination state %s', (contaminationState) => {
    expect(select({ observations: [candidate({ contaminationState })] })).toEqual({
      kind: 'DEFER',
      reasonCode: 'FEEDBACK_CONTAMINATED'
    });
  });

  it('rejects unsupported evaluator versions', () => {
    expect(select({
      observations: [candidate({ evaluatorVersion: 'OPTIMIZATION_EXPERIMENT_EVALUATOR_V2' })]
    })).toEqual({
      kind: 'DEFER',
      reasonCode: 'FEEDBACK_EVALUATOR_UNSUPPORTED'
    });
  });

  it('rejects missing or inconsistent frozen P8 authority', () => {
    expect(select({ p8AuthorityValid: false })).toEqual({
      kind: 'DEFER',
      reasonCode: 'FEEDBACK_P8_AUTHORITY_MISSING'
    });
  });

  it('rejects ambiguous or invalid feedback scope', () => {
    expect(select({ scopeValid: false })).toEqual({
      kind: 'DEFER',
      reasonCode: 'FEEDBACK_SCOPE_INVALID'
    });
  });

  it.each([
    { label: 'empty', observationScheduleJson: [] },
    { label: 'wrong day count', observationScheduleJson: [{ windowType: '56D', windowDays: 28 }] },
    { label: 'unknown window', observationScheduleJson: [{ windowType: 'BOGUS', windowDays: 56 }] },
    {
      label: 'duplicate window',
      observationScheduleJson: [
        { windowType: '56D', windowDays: 56 },
        { windowType: '56D', windowDays: 56 }
      ]
    }
  ])('fails closed for malformed frozen schedule: $label', ({ observationScheduleJson }) => {
    expect(select({ observationScheduleJson })).toEqual({
      kind: 'DEFER',
      reasonCode: 'FEEDBACK_TERMINAL_OBSERVATION_PENDING'
    });
  });

  it('returns the first sorted candidate rejection reason after scanning all candidates', () => {
    const first = candidate({
      id: 'observation-a',
      evaluatorVersion: 'UNSUPPORTED',
      effectState: 'INCONCLUSIVE',
      coverageState: 'UNKNOWN',
      contaminationState: 'UNKNOWN',
      inputCutoffAt: new Date('2026-08-27T00:00:00.000Z')
    });
    const later = candidate({
      id: 'observation-b',
      observationKey: 'observation-key-b',
      effectState: 'INCONCLUSIVE',
      inputCutoffAt: new Date('2026-08-28T00:00:00.000Z')
    });

    expect(select({ observations: [later, first] })).toEqual({
      kind: 'DEFER',
      reasonCode: 'FEEDBACK_EVALUATOR_UNSUPPORTED'
    });
  });

  it('uses evaluator then effect then coverage then contamination as rejection precedence', () => {
    expect(select({
      observations: [candidate({
        effectState: 'INCONCLUSIVE',
        coverageState: 'UNKNOWN',
        contaminationState: 'UNKNOWN'
      })]
    })).toEqual({
      kind: 'DEFER',
      reasonCode: 'FEEDBACK_EFFECT_INCONCLUSIVE'
    });

    expect(select({
      observations: [candidate({ coverageState: 'UNKNOWN', contaminationState: 'UNKNOWN' })]
    })).toEqual({
      kind: 'DEFER',
      reasonCode: 'FEEDBACK_COVERAGE_INSUFFICIENT'
    });
  });

  it('maps only conclusive effects to deterministic feedback values', () => {
    expect(feedbackValueForEffect('POSITIVE')).toBe(1);
    expect(feedbackValueForEffect('NEUTRAL')).toBe(0);
    expect(feedbackValueForEffect('NEGATIVE')).toBe(-1);
  });
});
