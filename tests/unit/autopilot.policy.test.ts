import { describe, expect, it } from 'vitest';
import {
  normalizeAutopilotPolicy,
  toAutopilotPolicySnapshot
} from '../../src/modules/optimization-autopilot/autopilot.policy.js';

describe('controlled autopilot policy normalization', () => {
  it('applies the V1 safe defaults', () => {
    expect(normalizeAutopilotPolicy({ enabled: true })).toEqual({
      enabled: true,
      allowedRiskClass: 'LOW',
      allowedOperationClasses: ['CREATE_CONTENT_PAGE'],
      dailyDraftPrLimit: 3,
      maxConcurrentRuns: 1,
      requireFreshEvidence: true,
      minimumEvidenceCoverage: 70,
      pauseOnVerificationFailure: true,
      killSwitch: false
    });
  });

  it.each([
    [{ enabled: true, allowedRiskClass: 'MEDIUM' }, 'allowedRiskClass'],
    [{ enabled: true, allowedRiskClass: 'HIGH' }, 'allowedRiskClass'],
    [{ enabled: true, allowedOperationClasses: ['SET_TITLE'] }, 'allowedOperationClasses'],
    [{ enabled: true, dailyDraftPrLimit: 0 }, 'dailyDraftPrLimit'],
    [{ enabled: true, dailyDraftPrLimit: 11 }, 'dailyDraftPrLimit'],
    [{ enabled: true, maxConcurrentRuns: 0 }, 'maxConcurrentRuns'],
    [{ enabled: true, maxConcurrentRuns: 4 }, 'maxConcurrentRuns'],
    [{ enabled: true, minimumEvidenceCoverage: 69 }, 'minimumEvidenceCoverage'],
    [{ enabled: true, minimumEvidenceCoverage: 101 }, 'minimumEvidenceCoverage']
  ])('rejects out-of-contract policy input %j', (input, field) => {
    expect(() => normalizeAutopilotPolicy(input as never)).toThrow(field as string);
  });

  it('sorts and deduplicates operation values before snapshot identity', () => {
    const normalized = normalizeAutopilotPolicy({
      enabled: true,
      allowedOperationClasses: ['CREATE_CONTENT_PAGE', 'CREATE_CONTENT_PAGE'] as never
    });

    expect(normalized.allowedOperationClasses).toEqual(['CREATE_CONTENT_PAGE']);
    expect(toAutopilotPolicySnapshot(normalized)).toEqual({
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
    });
  });
});
