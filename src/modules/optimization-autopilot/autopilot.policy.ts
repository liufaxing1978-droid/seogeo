import {
  CONTROLLED_AUTOPILOT_POLICY_VERSION,
  P9C_AUTOMATIC_OPERATION,
  type AutopilotPolicyMutation,
  type AutopilotPolicySnapshot,
  type NormalizedAutopilotPolicy
} from './autopilot.types.js';

function policyError(field: string): never {
  throw new Error(`Invalid controlled autopilot policy: ${field}`);
}

function boundedInteger(value: number, min: number, max: number, field: string): number {
  if (!Number.isInteger(value) || value < min || value > max) return policyError(field);
  return value;
}

function normalizeOperations(value: readonly string[] | undefined): readonly ['CREATE_CONTENT_PAGE'] {
  const operations = [...new Set(value ?? [P9C_AUTOMATIC_OPERATION])].sort();
  if (operations.length !== 1 || operations[0] !== P9C_AUTOMATIC_OPERATION) {
    return policyError('allowedOperationClasses');
  }
  return [P9C_AUTOMATIC_OPERATION];
}

export function normalizeAutopilotPolicy(input: AutopilotPolicyMutation): NormalizedAutopilotPolicy {
  if (input.allowedRiskClass !== undefined && input.allowedRiskClass !== 'LOW') {
    return policyError('allowedRiskClass');
  }

  return {
    enabled: input.enabled,
    allowedRiskClass: 'LOW',
    allowedOperationClasses: normalizeOperations(input.allowedOperationClasses),
    dailyDraftPrLimit: boundedInteger(input.dailyDraftPrLimit ?? 3, 1, 10, 'dailyDraftPrLimit'),
    maxConcurrentRuns: boundedInteger(input.maxConcurrentRuns ?? 1, 1, 3, 'maxConcurrentRuns'),
    requireFreshEvidence: input.requireFreshEvidence ?? true,
    minimumEvidenceCoverage: boundedInteger(
      input.minimumEvidenceCoverage ?? 70,
      70,
      100,
      'minimumEvidenceCoverage'
    ),
    pauseOnVerificationFailure: input.pauseOnVerificationFailure ?? true,
    killSwitch: input.killSwitch ?? false
  };
}

export function toAutopilotPolicySnapshot(
  policy: NormalizedAutopilotPolicy
): AutopilotPolicySnapshot {
  return {
    version: CONTROLLED_AUTOPILOT_POLICY_VERSION,
    enabled: policy.enabled,
    allowedRiskClass: policy.allowedRiskClass,
    allowedOperationClasses: [...policy.allowedOperationClasses] as ['CREATE_CONTENT_PAGE'],
    dailyDraftPrLimit: policy.dailyDraftPrLimit,
    maxConcurrentRuns: policy.maxConcurrentRuns,
    requireFreshEvidence: policy.requireFreshEvidence,
    minimumEvidenceCoverage: policy.minimumEvidenceCoverage,
    pauseOnVerificationFailure: policy.pauseOnVerificationFailure,
    killSwitch: policy.killSwitch
  };
}
