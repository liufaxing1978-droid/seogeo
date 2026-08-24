export type AutopilotGateResult =
  | { allowed: true }
  | {
      allowed: false;
      status:
        | 'P8_PREPARATION_REQUIRED'
        | 'MANUAL_REQUIRED'
        | 'POLICY_BLOCKED'
        | 'DEFERRED_CONFLICT'
        | 'STALE'
        | 'P8_VALIDATION_BLOCKED';
      reasonCode: string;
    };

export type AutopilotP8GateFacts = {
  projectMatches: boolean;
  preparationMatches: boolean;
  riskClass: 'LOW' | 'MEDIUM' | 'HIGH';
  operationTypes: readonly string[];
  blockingCodes: readonly string[];
  warningCodes: readonly string[];
  gitDraftPrAvailable: boolean;
  targetBindingCurrent: boolean;
};

export type AutopilotStaticGateInput = {
  recommendedActionType: string;
  evidenceCoverage: number;
  minimumEvidenceCoverage: number;
  requireFreshEvidence: boolean;
  candidateGrowthSnapshotId: string;
  latestGrowthSnapshotId: string | null;
  growthScoreState: string;
  growthRankingEligible: boolean;
  growthLifecycleStatus: string | null;
  pauseOnVerificationFailure: boolean;
  verificationPaused: boolean;
  hasConflict: boolean;
  p8: AutopilotP8GateFacts | null;
};

function blocked(
  status: Exclude<AutopilotGateResult, { allowed: true }>['status'],
  reasonCode: string
): AutopilotGateResult {
  return { allowed: false, status, reasonCode };
}

function terminalLifecycle(status: string | null): boolean {
  return status === 'DONE' || status === 'DISMISSED' || status === 'RESOLVED';
}

function exactAutomaticOperationAllowed(types: readonly string[]): boolean {
  return types.length === 1 && types[0] === 'CREATE_CONTENT_PAGE';
}

export function evaluateStaticAutopilotGates(
  input: AutopilotStaticGateInput
): AutopilotGateResult {
  if (input.recommendedActionType !== 'CONTENT_CREATION') {
    return blocked('MANUAL_REQUIRED', 'AUTOPILOT_ACTION_NOT_SUPPORTED');
  }

  if (
    !Number.isFinite(input.evidenceCoverage)
    || input.evidenceCoverage < input.minimumEvidenceCoverage
  ) {
    return blocked('POLICY_BLOCKED', 'AUTOPILOT_EVIDENCE_INSUFFICIENT');
  }

  if (
    input.growthScoreState !== 'KNOWN'
    || !input.growthRankingEligible
    || terminalLifecycle(input.growthLifecycleStatus)
    || (
      input.requireFreshEvidence
      && (
        input.latestGrowthSnapshotId === null
        || input.candidateGrowthSnapshotId !== input.latestGrowthSnapshotId
      )
    )
  ) {
    return blocked('STALE', 'AUTOPILOT_SOURCE_STALE');
  }

  if (input.pauseOnVerificationFailure && input.verificationPaused) {
    return blocked('POLICY_BLOCKED', 'AUTOPILOT_VERIFICATION_PAUSED');
  }

  if (input.hasConflict) {
    return blocked('DEFERRED_CONFLICT', 'AUTOPILOT_CONFLICT');
  }

  if (input.p8 === null) {
    return blocked('P8_PREPARATION_REQUIRED', 'AUTOPILOT_P8_PREPARATION_REQUIRED');
  }

  if (!input.p8.projectMatches || !input.p8.preparationMatches) {
    return blocked('MANUAL_REQUIRED', 'AUTOPILOT_P8_PLAN_MISMATCH');
  }

  if (input.p8.riskClass !== 'LOW') {
    return blocked('MANUAL_REQUIRED', 'AUTOPILOT_P8_RISK_NOT_LOW');
  }

  if (!exactAutomaticOperationAllowed(input.p8.operationTypes)) {
    return blocked('MANUAL_REQUIRED', 'AUTOPILOT_OPERATION_NOT_ALLOWED');
  }

  if (input.p8.blockingCodes.length > 0) {
    return blocked('P8_VALIDATION_BLOCKED', 'AUTOPILOT_P8_VALIDATION_BLOCKED');
  }

  if (input.p8.warningCodes.length > 0) {
    return blocked('MANUAL_REQUIRED', 'AUTOPILOT_P8_WARNING_REQUIRES_HUMAN');
  }

  if (!input.p8.gitDraftPrAvailable) {
    return blocked('MANUAL_REQUIRED', 'AUTOPILOT_GIT_DRAFT_PR_UNAVAILABLE');
  }

  if (!input.p8.targetBindingCurrent) {
    return blocked('STALE', 'AUTOPILOT_TARGET_REVISION_CHANGED');
  }

  return { allowed: true };
}
