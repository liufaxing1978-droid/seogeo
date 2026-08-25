import { describe, expect, it } from 'vitest';
import {
  deriveEffectiveAutopilotState,
  deriveInboxItems,
  deriveOutcomeSummary,
  derivePipelineStage,
  deriveQuota,
  sortActivity,
} from '../../src/modules/optimization-operations/operations.derive.js';
import type {
  OperationsActivityItem,
  OperationsPipelineAuthority,
} from '../../src/modules/optimization-operations/operations.types.js';

describe('P9-F pure operations projection rules', () => {
  describe('effective Autopilot state', () => {
    it.each([
      [
        'GLOBAL_KILL_SWITCH',
        { globalKillSwitch: true, projectKillSwitch: true, featureEnabled: false, policyEnabled: false },
      ],
      [
        'PROJECT_KILL_SWITCH',
        { globalKillSwitch: false, projectKillSwitch: true, featureEnabled: false, policyEnabled: false },
      ],
      [
        'FEATURE_BLOCKED',
        { globalKillSwitch: false, projectKillSwitch: false, featureEnabled: false, policyEnabled: true },
      ],
      [
        'DISABLED',
        { globalKillSwitch: false, projectKillSwitch: false, featureEnabled: true, policyEnabled: false },
      ],
      [
        'ACTIVE',
        { globalKillSwitch: false, projectKillSwitch: false, featureEnabled: true, policyEnabled: true },
      ],
    ] as const)('enforces precedence for %s', (expected, input) => {
      expect(deriveEffectiveAutopilotState(input)).toBe(expected);
    });
  });

  describe('farthest confirmed pipeline stage', () => {
    const discovered: OperationsPipelineAuthority = {
      growthOpportunityId: 'growth-1',
    };

    const eligible: OperationsPipelineAuthority = {
      ...discovered,
      candidate: { id: 'candidate-1', eligibilityState: 'ELIGIBLE' },
    };

    const planned: OperationsPipelineAuthority = {
      ...eligible,
      optimizationPlanId: 'plan-1',
    };

    const decided: OperationsPipelineAuthority = {
      ...planned,
      autopilotDecision: {
        id: 'decision-1',
        status: 'AUTOPILOT_READY',
        reasonCode: 'READY',
        updatedAt: new Date('2026-08-25T00:01:00.000Z'),
      },
    };

    const handedOff: OperationsPipelineAuthority = {
      ...decided,
      p8Authority: { proposalId: 'proposal-1', planId: 'p8-plan-1', previewId: 'preview-1' },
    };

    const draftPr: OperationsPipelineAuthority = {
      ...handedOff,
      publicationExecution: {
        id: 'execution-1',
        status: 'PR_CREATED',
        pullRequestNo: 42,
        updatedAt: new Date('2026-08-25T00:02:00.000Z'),
      },
    };

    const verified: OperationsPipelineAuthority = {
      ...draftPr,
      publicationExecution: {
        ...draftPr.publicationExecution!,
        status: 'VERIFIED',
      },
      publicationVerification: {
        id: 'verification-1',
        status: 'VERIFIED',
        updatedAt: new Date('2026-08-25T00:03:00.000Z'),
      },
    };

    const observing: OperationsPipelineAuthority = {
      ...verified,
      experiment: { id: 'experiment-1', createdAt: new Date('2026-08-25T00:04:00.000Z') },
    };

    const evaluated: OperationsPipelineAuthority = {
      ...observing,
      terminalObservation: {
        id: 'observation-1',
        effectState: 'POSITIVE',
        inputCutoffAt: new Date('2026-08-25T00:05:00.000Z'),
        createdAt: new Date('2026-08-25T00:06:00.000Z'),
      },
    };

    it.each([
      ['DISCOVERED', discovered],
      ['ELIGIBLE', eligible],
      ['PLANNED', planned],
      ['AUTOPILOT_DECIDED', decided],
      ['P8_HANDOFF', handedOff],
      ['DRAFT_PR', draftPr],
      ['VERIFIED', verified],
      ['OBSERVING', observing],
      ['EVALUATED', evaluated],
    ] as const)('projects one current stage: %s', (expected, input) => {
      expect(derivePipelineStage(input)).toBe(expected);
    });

    it('uses exact P8 execution facts without promoting failed verification to VERIFIED', () => {
      expect(derivePipelineStage({
        ...draftPr,
        publicationExecution: {
          ...draftPr.publicationExecution!,
          status: 'VERIFICATION_FAILED',
        },
        publicationVerification: {
          id: 'verification-failed',
          status: 'FAILED',
          updatedAt: new Date('2026-08-25T00:03:00.000Z'),
        },
      })).toBe('DRAFT_PR');

      expect(derivePipelineStage({
        ...handedOff,
        publicationExecution: {
          id: 'execution-failed-before-pr',
          status: 'FAILED',
          pullRequestNo: null,
          updatedAt: new Date('2026-08-25T00:02:00.000Z'),
        },
      })).toBe('P8_HANDOFF');
    });
  });

  describe('human-attention inbox', () => {
    it('maps persisted decision/execution states and sorts by severity, wait, then stable id', () => {
      const items = deriveInboxItems([
        {
          authorityType: 'AUTOPILOT_DECISION',
          authorityId: 'decision-policy',
          status: 'POLICY_BLOCKED',
          reasonCode: 'POLICY_DISABLED',
          updatedAt: new Date('2026-08-25T00:03:00.000Z'),
          authorityUrl: '/decisions/policy',
        },
        {
          authorityType: 'AUTOPILOT_DECISION',
          authorityId: 'decision-p8',
          status: 'P8_VALIDATION_BLOCKED',
          reasonCode: 'P8_INVALID',
          updatedAt: new Date('2026-08-25T00:02:00.000Z'),
          authorityUrl: '/decisions/p8',
        },
        {
          authorityType: 'AUTOPILOT_DECISION',
          authorityId: 'decision-stale',
          status: 'STALE',
          reasonCode: 'SOURCE_STALE',
          updatedAt: new Date('2026-08-25T00:01:00.000Z'),
          authorityUrl: '/decisions/stale',
        },
        {
          authorityType: 'PUBLICATION_EXECUTION',
          authorityId: 'execution-verify-b',
          status: 'VERIFICATION_FAILED',
          reasonCode: 'VERIFY_FAILED',
          updatedAt: new Date('2026-08-25T00:04:00.000Z'),
          authorityUrl: '/executions/verify-b',
        },
        {
          authorityType: 'PUBLICATION_EXECUTION',
          authorityId: 'execution-verify-a',
          status: 'VERIFICATION_FAILED',
          reasonCode: 'VERIFY_FAILED',
          updatedAt: new Date('2026-08-25T00:04:00.000Z'),
          authorityUrl: '/executions/verify-a',
        },
        {
          authorityType: 'PUBLICATION_EXECUTION',
          authorityId: 'execution-failed',
          status: 'FAILED',
          reasonCode: 'GIT_FAILED',
          updatedAt: new Date('2026-08-25T00:05:00.000Z'),
          authorityUrl: '/executions/failed',
        },
        {
          authorityType: 'PUBLICATION_EXECUTION',
          authorityId: 'execution-stale-review',
          status: 'STALE_REVIEW_REQUIRED',
          reasonCode: 'STALE_REVIEW',
          updatedAt: new Date('2026-08-25T00:00:00.000Z'),
          authorityUrl: '/executions/stale',
        },
        {
          authorityType: 'PUBLICATION_EXECUTION',
          authorityId: 'execution-pr',
          status: 'PR_CREATED',
          reasonCode: 'HUMAN_MERGE_REQUIRED',
          updatedAt: new Date('2026-08-25T00:00:00.000Z'),
          authorityUrl: '/executions/pr',
        },
      ]);

      expect(items.map((item) => [item.authorityId, item.category, item.severity])).toEqual([
        ['execution-verify-a', 'VERIFICATION_FAILED', 'HIGH'],
        ['execution-verify-b', 'VERIFICATION_FAILED', 'HIGH'],
        ['execution-failed', 'EXECUTION_FAILED', 'HIGH'],
        ['execution-stale-review', 'STALE', 'MEDIUM'],
        ['decision-stale', 'STALE', 'MEDIUM'],
        ['decision-p8', 'P8_VALIDATION_BLOCKED', 'MEDIUM'],
        ['decision-policy', 'POLICY_BLOCKED', 'MEDIUM'],
        ['execution-pr', 'AWAITING_HUMAN_MERGE', 'LOW'],
      ]);

      expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    });
  });

  describe('7/30 day outcome windows', () => {
    it('uses terminal business inputCutoffAt rather than delayed createdAt', () => {
      const now = new Date('2026-08-25T12:00:00.000Z');
      const summary = deriveOutcomeSummary({
        now,
        observations: [
          {
            id: 'within-7-positive',
            effectState: 'POSITIVE',
            inputCutoffAt: new Date('2026-08-20T12:00:00.000Z'),
            createdAt: new Date('2026-08-25T11:00:00.000Z'),
          },
          {
            id: 'within-30-negative',
            effectState: 'NEGATIVE',
            inputCutoffAt: new Date('2026-08-10T12:00:00.000Z'),
            createdAt: new Date('2026-08-25T11:30:00.000Z'),
          },
          {
            id: 'outside-30-recent-row',
            effectState: 'POSITIVE',
            inputCutoffAt: new Date('2026-07-20T12:00:00.000Z'),
            createdAt: new Date('2026-08-25T11:45:00.000Z'),
          },
          {
            id: 'within-7-inconclusive',
            effectState: 'INCONCLUSIVE',
            inputCutoffAt: new Date('2026-08-24T12:00:00.000Z'),
            createdAt: new Date('2026-08-24T13:00:00.000Z'),
          },
        ],
        feedbackEvidence: [
          { observationId: 'within-7-positive', inputCutoffAt: new Date('2026-08-20T12:00:00.000Z') },
          { observationId: 'within-30-negative', inputCutoffAt: new Date('2026-08-10T12:00:00.000Z') },
        ],
      });

      expect(summary.last7Days).toEqual({
        positive: 1,
        neutral: 0,
        negative: 0,
        inconclusive: 1,
        feedbackAccepted: 1,
        feedbackDeferred: 1,
      });
      expect(summary.last30Days).toEqual({
        positive: 1,
        neutral: 0,
        negative: 1,
        inconclusive: 1,
        feedbackAccepted: 2,
        feedbackDeferred: 1,
      });
    });
  });

  describe('quota projection', () => {
    it('subtracts only RESERVED and CONSUMED and clamps remaining at zero', () => {
      expect(deriveQuota({
        configuredLimit: 3,
        reservations: [
          { status: 'RESERVED' },
          { status: 'CONSUMED' },
          { status: 'RELEASED' },
        ],
      })).toEqual({ configuredLimit: 3, reserved: 1, consumed: 1, remaining: 1 });

      expect(deriveQuota({
        configuredLimit: 1,
        reservations: [
          { status: 'RESERVED' },
          { status: 'RESERVED' },
          { status: 'CONSUMED' },
        ],
      }).remaining).toBe(0);
    });
  });

  describe('activity ordering', () => {
    it('sorts by semantic occurredAt descending and stable authority id', () => {
      const items: OperationsActivityItem[] = [
        {
          occurredAt: new Date('2026-08-25T00:01:00.000Z'),
          sourceModule: 'P9_B',
          eventType: 'RUN_COMPLETED',
          title: 'run',
          summary: 'run completed',
          authorityId: 'z',
          authorityUrl: null,
          severity: 'INFO',
        },
        {
          occurredAt: new Date('2026-08-25T00:02:00.000Z'),
          sourceModule: 'P8',
          eventType: 'VERIFIED',
          title: 'verify',
          summary: 'verified',
          authorityId: 'b',
          authorityUrl: null,
          severity: 'INFO',
        },
        {
          occurredAt: new Date('2026-08-25T00:02:00.000Z'),
          sourceModule: 'P9_D',
          eventType: 'OBSERVED',
          title: 'observe',
          summary: 'observed',
          authorityId: 'a',
          authorityUrl: null,
          severity: 'INFO',
        },
      ];

      expect(sortActivity(items).map((item) => item.authorityId)).toEqual(['a', 'b', 'z']);
      expect(items.map((item) => item.authorityId)).toEqual(['z', 'b', 'a']);
    });
  });
});
