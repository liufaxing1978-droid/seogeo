import type {
  AutopilotPolicy,
  OptimizationAutopilotDecisionStatus,
  PublicationRiskClass
} from '@prisma/client';

export const CONTROLLED_AUTOPILOT_POLICY_VERSION = 'CONTROLLED_AUTOPILOT_POLICY_V1' as const;
export const OPTIMIZATION_AUTOPILOT_DECISION_VERSION = 'OPTIMIZATION_AUTOPILOT_DECISION_V1' as const;
export const P9C_AUTOMATIC_OPERATION = 'CREATE_CONTENT_PAGE' as const;

export type AutopilotPolicyMutation = {
  enabled: boolean;
  allowedRiskClass?: PublicationRiskClass;
  allowedOperationClasses?: readonly string[];
  dailyDraftPrLimit?: number;
  maxConcurrentRuns?: number;
  requireFreshEvidence?: boolean;
  minimumEvidenceCoverage?: number;
  pauseOnVerificationFailure?: boolean;
  killSwitch?: boolean;
};

export type NormalizedAutopilotPolicy = {
  enabled: boolean;
  allowedRiskClass: 'LOW';
  allowedOperationClasses: readonly ['CREATE_CONTENT_PAGE'];
  dailyDraftPrLimit: number;
  maxConcurrentRuns: number;
  requireFreshEvidence: boolean;
  minimumEvidenceCoverage: number;
  pauseOnVerificationFailure: boolean;
  killSwitch: boolean;
};

export type AutopilotPolicySnapshot = NormalizedAutopilotPolicy & {
  version: typeof CONTROLLED_AUTOPILOT_POLICY_VERSION;
};

export type AutopilotSourceSnapshot = Record<string, unknown>;

export type CreateAutopilotDecisionInput = {
  projectId: string;
  runId: string;
  runItemId: string;
  optimizationPlanId: string;
  policyId: string;
  policyVersion: string;
  policySnapshot: AutopilotPolicySnapshot | Record<string, unknown>;
  sourceSnapshot: AutopilotSourceSnapshot;
  status: OptimizationAutopilotDecisionStatus;
  reasonCodes: readonly string[];
  p8PlanId: string | null;
  p8PreviewId: string | null;
  decisionKey: string;
};

export type AutopilotRunItemContext = {
  runItemId: string;
  projectId: string;
  runId: string;
  optimizationPlanId: string;
};

export type StoredAutopilotPolicy = AutopilotPolicy;
