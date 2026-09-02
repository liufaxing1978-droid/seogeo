import type {
  EffectiveAutopilotState,
  OperationsActivityItem,
  OperationsAlert,
  OperationsAlertKind,
  OperationsAlertPriority,
  OperationsAutomationAlertAuthority,
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
  OperationsTodayAction,
  OperationsTodayActionKind,
  OperationsTodayPriority,
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

const todayPriorityBySeverity: Record<OperationsInboxSeverity, OperationsTodayPriority> = {
  HIGH: 'P0',
  MEDIUM: 'P1',
  LOW: 'P2',
};

const todayActionMetadata: Record<
  OperationsInboxCategory,
  {
    kind: OperationsTodayActionKind;
    title: string;
    recommendedAction: string;
  }
> = {
  VERIFICATION_FAILED: {
    kind: 'INVESTIGATE_VERIFICATION',
    title: '发布后验证失败',
    recommendedAction: '检查验证证据并修复失败原因',
  },
  EXECUTION_FAILED: {
    kind: 'INVESTIGATE_EXECUTION',
    title: '优化执行失败',
    recommendedAction: '检查执行错误并在既有安全边界内修复后重试',
  },
  POLICY_BLOCKED: {
    kind: 'REVIEW_POLICY',
    title: '策略阻止自动优化',
    recommendedAction: '检查当前 Autopilot Policy 与阻止原因',
  },
  P8_VALIDATION_BLOCKED: {
    kind: 'REVIEW_P8_HANDOFF',
    title: '发布交接验证受阻',
    recommendedAction: '检查 P8 交接证据并解决验证阻塞',
  },
  STALE: {
    kind: 'REFRESH_EVIDENCE',
    title: '优化证据已过期',
    recommendedAction: '刷新相关证据后再继续决策或执行',
  },
  AWAITING_HUMAN_MERGE: {
    kind: 'REVIEW_DRAFT_PR',
    title: 'Draft PR 等待人工复核',
    recommendedAction: '按既有人工合并流程复核 Draft PR',
  },
};

export function deriveTodayActions(
  inboxItems: readonly OperationsInboxItem[],
  limit = 7,
): OperationsTodayAction[] {
  const result: OperationsTodayAction[] = [];
  const seen = new Set<string>();
  const cappedLimit = Math.max(0, Math.trunc(limit));

  for (const item of inboxItems) {
    if (result.length >= cappedLimit) break;
    if (seen.has(item.id)) continue;
    seen.add(item.id);

    const metadata = todayActionMetadata[item.category];
    result.push({
      id: `today:${item.id}`,
      priority: todayPriorityBySeverity[item.severity],
      kind: metadata.kind,
      title: metadata.title,
      recommendedAction: metadata.recommendedAction,
      reasonCode: item.reasonCode,
      optimizationPlanId: item.optimizationPlanId,
      targetUrl: item.targetUrl,
      updatedAt: item.updatedAt,
      authorityUrl: item.authorityUrl,
    });
  }

  return result;
}

const alertTitleByKind: Record<OperationsAlertKind, string> = {
  VERIFICATION_FAILED: '发布后验证失败',
  EXECUTION_FAILED: '优化执行失败',
  STALE: '优化证据已过期',
  POLICY_BLOCKED: '策略阻止自动优化',
  P8_VALIDATION_BLOCKED: '发布交接验证受阻',
  AUTOMATION_FAILED: 'Automation Run 执行失败',
  AUTOMATION_TIMED_OUT: 'Automation Run 执行超时',
};

const alertPriorityRank: Record<OperationsAlertPriority, number> = {
  P0: 2,
  P1: 1,
};

export function deriveAlertCenter(input: {
  inboxItems: readonly OperationsInboxItem[];
  automationRuns: readonly OperationsAutomationAlertAuthority[];
}, limit = 20): OperationsAlert[] {
  const alerts: OperationsAlert[] = [];
  const seen = new Set<string>();

  for (const item of input.inboxItems) {
    if (item.category === 'AWAITING_HUMAN_MERGE' || item.severity === 'LOW') continue;
    const kind = item.category as Exclude<OperationsAlertKind, 'AUTOMATION_FAILED' | 'AUTOMATION_TIMED_OUT'>;
    const id = `alert:inbox:${item.id}:${kind}`;
    if (seen.has(id)) continue;
    seen.add(id);
    alerts.push({
      id,
      priority: item.severity === 'HIGH' ? 'P0' : 'P1',
      source: 'OPERATIONS_INBOX',
      kind,
      title: alertTitleByKind[kind],
      reasonCode: item.reasonCode,
      optimizationPlanId: item.optimizationPlanId,
      targetUrl: item.targetUrl,
      updatedAt: item.updatedAt,
      authorityUrl: item.authorityUrl,
    });
  }

  for (const run of input.automationRuns) {
    const kind: OperationsAlertKind = run.status === 'TIMED_OUT'
      ? 'AUTOMATION_TIMED_OUT'
      : 'AUTOMATION_FAILED';
    const id = `alert:automation:${run.id}:${kind}`;
    if (seen.has(id)) continue;
    seen.add(id);
    alerts.push({
      id,
      priority: 'P0',
      source: 'AUTOMATION_RUN',
      kind,
      title: alertTitleByKind[kind],
      reasonCode: run.lastErrorCode ?? kind,
      optimizationPlanId: null,
      targetUrl: null,
      updatedAt: run.updatedAt,
      authorityUrl: run.authorityUrl,
    });
  }

  alerts.sort((left, right) => {
    const priorityDifference = alertPriorityRank[right.priority] - alertPriorityRank[left.priority];
    if (priorityDifference !== 0) return priorityDifference;
    const waitDifference = left.updatedAt.getTime() - right.updatedAt.getTime();
    if (waitDifference !== 0) return waitDifference;
    return left.id.localeCompare(right.id);
  });

  return alerts.slice(0, Math.max(0, Math.trunc(limit)));
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
