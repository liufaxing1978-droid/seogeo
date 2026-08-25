import type {
  EffectiveAutopilotState,
  OperationsActivityItem,
  OperationsFeedbackEvidenceAuthority,
  OperationsInboxAuthority,
  OperationsInboxCategory,
  OperationsInboxItem,
  OperationsInboxSeverity,
  OperationsOutcomeObservation,
  OperationsOutcomeSummary,
  OperationsOutcomeWindow,
  OperationsPipelineAuthority,
  OperationsPipelineStage,
  OperationsQuota,
  OperationsReservationAuthority,
} from './operations.types.js';

export function deriveEffectiveAutopilotState(input: {
  globalKillSwitch: boolean;
  projectKillSwitch: boolean;
  featureEnabled: boolean;
  policyEnabled: boolean;
}): EffectiveAutopilotState {
  if (input.globalKillSwitch) return 'GLOBAL_KILL_SWITCH';
  if (input.projectKillSwitch) return 'PROJECT_KILL_SWITCH';
  if (!input.featureEnabled) return 'FEATURE_BLOCKED';
  if (!input.policyEnabled) return 'DISABLED';
  return 'ACTIVE';
}

const executionStatesAfterDraftPr = new Set([
  'PR_CREATED',
  'DEPLOYED',
  'VERIFYING',
  'VERIFIED',
  'APPROVAL_STALE',
  'TARGET_REVISION_CHANGED',
  'VERIFICATION_FAILED',
  'STALE_REVIEW_REQUIRED',
  'ROLLBACK_PROPOSED',
  'ROLLED_BACK',
]);

export function derivePipelineStage(input: OperationsPipelineAuthority): OperationsPipelineStage {
  if (input.terminalObservation) return 'EVALUATED';
  if (input.experiment) return 'OBSERVING';

  if (
    input.publicationExecution?.status === 'VERIFIED'
    && input.publicationVerification?.status === 'VERIFIED'
  ) {
    return 'VERIFIED';
  }

  if (
    input.publicationExecution
    && (
      input.publicationExecution.pullRequestNo !== null
      || executionStatesAfterDraftPr.has(input.publicationExecution.status)
    )
    && input.publicationExecution.status !== 'FAILED'
  ) {
    return 'DRAFT_PR';
  }

  if (input.p8Authority || input.publicationExecution || input.publicationVerification) {
    return 'P8_HANDOFF';
  }
  if (input.autopilotDecision) return 'AUTOPILOT_DECIDED';
  if (input.optimizationPlanId) return 'PLANNED';
  if (input.candidate?.eligibilityState === 'ELIGIBLE') return 'ELIGIBLE';
  return 'DISCOVERED';
}

const inboxCategoryMetadata: Record<OperationsInboxCategory, { severity: OperationsInboxSeverity }> = {
  VERIFICATION_FAILED: { severity: 'HIGH' },
  EXECUTION_FAILED: { severity: 'HIGH' },
  POLICY_BLOCKED: { severity: 'MEDIUM' },
  P8_VALIDATION_BLOCKED: { severity: 'MEDIUM' },
  STALE: { severity: 'MEDIUM' },
  AWAITING_HUMAN_MERGE: { severity: 'LOW' },
};

function mapInboxCategory(authority: OperationsInboxAuthority): OperationsInboxCategory | null {
  if (authority.authorityType === 'AUTOPILOT_DECISION') {
    if (authority.status === 'POLICY_BLOCKED') return 'POLICY_BLOCKED';
    if (authority.status === 'P8_VALIDATION_BLOCKED') return 'P8_VALIDATION_BLOCKED';
    if (authority.status === 'STALE') return 'STALE';
    return null;
  }

  if (authority.status === 'VERIFICATION_FAILED') return 'VERIFICATION_FAILED';
  if (authority.status === 'FAILED') return 'EXECUTION_FAILED';
  if (
    authority.status === 'STALE_REVIEW_REQUIRED'
    || authority.status === 'APPROVAL_STALE'
    || authority.status === 'TARGET_REVISION_CHANGED'
  ) {
    return 'STALE';
  }
  if (authority.status === 'PR_CREATED') return 'AWAITING_HUMAN_MERGE';
  return null;
}

const severityRank: Record<OperationsInboxSeverity, number> = {
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

export function deriveInboxItems(authorities: OperationsInboxAuthority[]): OperationsInboxItem[] {
  const items: OperationsInboxItem[] = [];

  for (const authority of authorities) {
    const category = mapInboxCategory(authority);
    if (!category) continue;

    items.push({
      id: `${authority.authorityType}:${authority.authorityId}:${category}`,
      authorityType: authority.authorityType,
      authorityId: authority.authorityId,
      category,
      severity: inboxCategoryMetadata[category].severity,
      reasonCode: authority.reasonCode,
      optimizationPlanId: authority.optimizationPlanId ?? null,
      targetUrl: authority.targetUrl ?? null,
      updatedAt: authority.updatedAt,
      authorityUrl: authority.authorityUrl,
    });
  }

  return items.sort((left, right) => {
    const severityDifference = severityRank[right.severity] - severityRank[left.severity];
    if (severityDifference !== 0) return severityDifference;

    const waitDifference = left.updatedAt.getTime() - right.updatedAt.getTime();
    if (waitDifference !== 0) return waitDifference;

    return left.id.localeCompare(right.id);
  });
}

function emptyOutcomeWindow(): OperationsOutcomeWindow {
  return {
    positive: 0,
    neutral: 0,
    negative: 0,
    inconclusive: 0,
    feedbackAccepted: 0,
    feedbackDeferred: 0,
  };
}

function deriveOutcomeWindow(input: {
  now: Date;
  days: number;
  observations: OperationsOutcomeObservation[];
  feedbackEvidence: OperationsFeedbackEvidenceAuthority[];
}): OperationsOutcomeWindow {
  const start = input.now.getTime() - input.days * 24 * 60 * 60 * 1000;
  const end = input.now.getTime();
  const window = emptyOutcomeWindow();
  const acceptedObservationIds = new Set(
    input.feedbackEvidence.map((evidence) => evidence.observationId),
  );

  for (const observation of input.observations) {
    const cutoff = observation.inputCutoffAt.getTime();
    if (cutoff < start || cutoff > end) continue;

    if (observation.effectState === 'POSITIVE') window.positive += 1;
    else if (observation.effectState === 'NEUTRAL') window.neutral += 1;
    else if (observation.effectState === 'NEGATIVE') window.negative += 1;
    else window.inconclusive += 1;

    if (acceptedObservationIds.has(observation.id)) window.feedbackAccepted += 1;
    else window.feedbackDeferred += 1;
  }

  return window;
}

export function deriveOutcomeSummary(input: {
  now: Date;
  observations: OperationsOutcomeObservation[];
  feedbackEvidence: OperationsFeedbackEvidenceAuthority[];
}): OperationsOutcomeSummary {
  return {
    last7Days: deriveOutcomeWindow({ ...input, days: 7 }),
    last30Days: deriveOutcomeWindow({ ...input, days: 30 }),
  };
}

export function deriveQuota(input: {
  configuredLimit: number;
  reservations: OperationsReservationAuthority[];
}): OperationsQuota {
  const reserved = input.reservations.filter((reservation) => reservation.status === 'RESERVED').length;
  const consumed = input.reservations.filter((reservation) => reservation.status === 'CONSUMED').length;

  return {
    configuredLimit: input.configuredLimit,
    reserved,
    consumed,
    remaining: Math.max(0, input.configuredLimit - reserved - consumed),
  };
}

export function sortActivity(items: OperationsActivityItem[]): OperationsActivityItem[] {
  return [...items].sort((left, right) => {
    const occurredAtDifference = right.occurredAt.getTime() - left.occurredAt.getTime();
    if (occurredAtDifference !== 0) return occurredAtDifference;

    const authorityDifference = left.authorityId.localeCompare(right.authorityId);
    if (authorityDifference !== 0) return authorityDifference;

    const sourceDifference = left.sourceModule.localeCompare(right.sourceModule);
    if (sourceDifference !== 0) return sourceDifference;
    return left.eventType.localeCompare(right.eventType);
  });
}
