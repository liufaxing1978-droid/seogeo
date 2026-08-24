import { describe, expect, it } from 'vitest';
import {
  evaluateStaticAutopilotGates,
  type AutopilotStaticGateInput
} from '../../src/modules/optimization-autopilot/autopilot.gates.js';

const baseP8 = {
  projectMatches: true,
  preparationMatches: true,
  riskClass: 'LOW' as const,
  operationTypes: ['CREATE_CONTENT_PAGE'],
  blockingCodes: [] as string[],
  warningCodes: [] as string[],
  gitDraftPrAvailable: true,
  targetBindingCurrent: true
};

const base: AutopilotStaticGateInput = {
  recommendedActionType: 'CONTENT_CREATION',
  evidenceCoverage: 85,
  minimumEvidenceCoverage: 70,
  requireFreshEvidence: true,
  candidateGrowthSnapshotId: 'snapshot-current',
  latestGrowthSnapshotId: 'snapshot-current',
  growthScoreState: 'KNOWN',
  growthRankingEligible: true,
  growthLifecycleStatus: 'NEW',
  pauseOnVerificationFailure: true,
  verificationPaused: false,
  hasConflict: false,
  p8: baseP8
};

describe('controlled autopilot static gates', () => {
  it('allows only the exact V1 automatic path', () => {
    expect(evaluateStaticAutopilotGates(base)).toEqual({ allowed: true });
  });

  it('requires P8 preparation when exact artifacts are not available', () => {
    expect(evaluateStaticAutopilotGates({ ...base, p8: null })).toEqual({
      allowed: false,
      status: 'P8_PREPARATION_REQUIRED',
      reasonCode: 'AUTOPILOT_P8_PREPARATION_REQUIRED'
    });
  });

  it.each([
    [{ recommendedActionType: 'CONTENT_REFRESH' }, 'AUTOPILOT_ACTION_NOT_SUPPORTED'],
    [{ evidenceCoverage: 69 }, 'AUTOPILOT_EVIDENCE_INSUFFICIENT'],
    [{ latestGrowthSnapshotId: 'snapshot-newer' }, 'AUTOPILOT_SOURCE_STALE'],
    [{ growthScoreState: 'UNKNOWN' }, 'AUTOPILOT_SOURCE_STALE'],
    [{ growthRankingEligible: false }, 'AUTOPILOT_SOURCE_STALE'],
    [{ growthLifecycleStatus: 'DONE' }, 'AUTOPILOT_SOURCE_STALE'],
    [{ verificationPaused: true }, 'AUTOPILOT_VERIFICATION_PAUSED'],
    [{ hasConflict: true }, 'AUTOPILOT_CONFLICT']
  ])('fails before P8 evaluation for persisted source/policy fact %j', (patch, reasonCode) => {
    const input = { ...base, ...patch, p8: null } as AutopilotStaticGateInput;
    expect(evaluateStaticAutopilotGates(input)).toMatchObject({
      allowed: false,
      reasonCode
    });
  });

  it('keeps deterministic first-failure ordering', () => {
    expect(evaluateStaticAutopilotGates({
      ...base,
      recommendedActionType: 'CONTENT_REFRESH',
      evidenceCoverage: 0,
      latestGrowthSnapshotId: 'snapshot-newer',
      verificationPaused: true,
      hasConflict: true,
      p8: null
    })).toMatchObject({
      allowed: false,
      reasonCode: 'AUTOPILOT_ACTION_NOT_SUPPORTED'
    });
  });

  it.each([
    [{ projectMatches: false }, 'AUTOPILOT_P8_PLAN_MISMATCH'],
    [{ preparationMatches: false }, 'AUTOPILOT_P8_PLAN_MISMATCH'],
    [{ riskClass: 'MEDIUM' }, 'AUTOPILOT_P8_RISK_NOT_LOW'],
    [{ riskClass: 'HIGH' }, 'AUTOPILOT_P8_RISK_NOT_LOW'],
    [{ operationTypes: ['UPDATE_CONTENT_PAGE'] }, 'AUTOPILOT_OPERATION_NOT_ALLOWED'],
    [{ operationTypes: ['CREATE_CONTENT_PAGE', 'SET_TITLE'] }, 'AUTOPILOT_OPERATION_NOT_ALLOWED'],
    [{ blockingCodes: ['PATH_NOT_ALLOWED'] }, 'AUTOPILOT_P8_VALIDATION_BLOCKED'],
    [{ warningCodes: ['SOURCE_GAP'] }, 'AUTOPILOT_P8_WARNING_REQUIRES_HUMAN'],
    [{ gitDraftPrAvailable: false }, 'AUTOPILOT_GIT_DRAFT_PR_UNAVAILABLE'],
    [{ targetBindingCurrent: false }, 'AUTOPILOT_TARGET_REVISION_CHANGED']
  ])('fails closed for exact P8 fact %j', (patch, reasonCode) => {
    expect(evaluateStaticAutopilotGates({
      ...base,
      p8: { ...baseP8, ...patch } as AutopilotStaticGateInput['p8']
    })).toMatchObject({
      allowed: false,
      reasonCode
    });
  });

  it('does not pause on an old verification failure when policy disables that gate', () => {
    expect(evaluateStaticAutopilotGates({
      ...base,
      pauseOnVerificationFailure: false,
      verificationPaused: true
    })).toEqual({ allowed: true });
  });

  it('does not require latest-snapshot equality when fresh evidence is disabled', () => {
    expect(evaluateStaticAutopilotGates({
      ...base,
      requireFreshEvidence: false,
      latestGrowthSnapshotId: 'snapshot-newer'
    })).toEqual({ allowed: true });
  });
});
