import { describe, expect, it } from 'vitest';
import {
  buildOptimizationAutopilotDecisionKey,
  canonicalJson,
  hashCanonicalJson
} from '../../src/modules/optimization-autopilot/autopilot.identity.js';

const baseIdentity = {
  projectId: '11111111-1111-4111-8111-111111111111',
  runItemId: '22222222-2222-4222-8222-222222222222',
  optimizationPlanId: '33333333-3333-4333-8333-333333333333',
  policyVersion: 'CONTROLLED_AUTOPILOT_POLICY_V1',
  policySnapshot: {
    version: 'CONTROLLED_AUTOPILOT_POLICY_V1',
    enabled: true,
    allowedRiskClass: 'LOW',
    allowedOperationClasses: ['CREATE_CONTENT_PAGE'],
    dailyDraftPrLimit: 3,
    maxConcurrentRuns: 1,
    requireFreshEvidence: true,
    minimumEvidenceCoverage: 70,
    pauseOnVerificationFailure: true,
    killSwitch: false
  },
  sourceSnapshot: {
    optimizationPlanId: '33333333-3333-4333-8333-333333333333',
    candidateId: '44444444-4444-4444-8444-444444444444',
    growthOpportunityIdentityId: '55555555-5555-4555-8555-555555555555',
    growthSnapshotId: '66666666-6666-4666-8666-666666666666',
    marketScopeMode: 'CONFIGURED_MARKET',
    marketCode: null,
    locale: 'zh-CN',
    recommendedActionType: 'CONTENT_CREATION',
    growthEvidenceCoverage: 85,
    growthScoreState: 'KNOWN',
    growthRankingEligible: true,
    growthLifecycleStatus: 'NEW',
    candidateCreatedAt: '2026-08-23T00:00:00.000Z',
    planCreatedAt: '2026-08-23T00:01:00.000Z'
  },
  p8PlanId: null,
  p8PreviewId: null
} as const;

describe('controlled autopilot deterministic identity', () => {
  it('canonicalizes object keys recursively while preserving explicit nulls and array order', () => {
    expect(canonicalJson({ z: null, a: { z: 2, a: 1 }, b: [2, 1] })).toBe(
      '{"a":{"a":1,"z":2},"b":[2,1],"z":null}'
    );
  });

  it('hashes semantically identical object-key order identically', () => {
    expect(hashCanonicalJson({ b: 2, a: { d: null, c: 1 } })).toBe(
      hashCanonicalJson({ a: { c: 1, d: null }, b: 2 })
    );
  });

  it('reuses one decision key for the same immutable inputs regardless of snapshot key order', () => {
    const reordered = {
      ...baseIdentity,
      policySnapshot: {
        killSwitch: false,
        pauseOnVerificationFailure: true,
        minimumEvidenceCoverage: 70,
        requireFreshEvidence: true,
        maxConcurrentRuns: 1,
        dailyDraftPrLimit: 3,
        allowedOperationClasses: ['CREATE_CONTENT_PAGE'],
        allowedRiskClass: 'LOW',
        enabled: true,
        version: 'CONTROLLED_AUTOPILOT_POLICY_V1'
      }
    } as const;

    expect(buildOptimizationAutopilotDecisionKey(baseIdentity)).toBe(
      buildOptimizationAutopilotDecisionKey(reordered)
    );
  });

  it('changes decision identity when the policy snapshot changes', () => {
    expect(buildOptimizationAutopilotDecisionKey(baseIdentity)).not.toBe(
      buildOptimizationAutopilotDecisionKey({
        ...baseIdentity,
        policySnapshot: { ...baseIdentity.policySnapshot, dailyDraftPrLimit: 2 }
      })
    );
  });

  it('changes decision identity when exact P8 artifacts become bound', () => {
    expect(buildOptimizationAutopilotDecisionKey(baseIdentity)).not.toBe(
      buildOptimizationAutopilotDecisionKey({
        ...baseIdentity,
        p8PlanId: '77777777-7777-4777-8777-777777777777',
        p8PreviewId: '88888888-8888-4888-8888-888888888888'
      })
    );
  });
});
