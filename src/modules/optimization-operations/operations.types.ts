export type EffectiveAutopilotState =
  | 'GLOBAL_KILL_SWITCH'
  | 'PROJECT_KILL_SWITCH'
  | 'FEATURE_BLOCKED'
  | 'DISABLED'
  | 'ACTIVE';

export type OperationsPipelineStage =
  | 'DISCOVERED'
  | 'ELIGIBLE'
  | 'PLANNED'
  | 'AUTOPILOT_DECIDED'
  | 'P8_HANDOFF'
  | 'DRAFT_PR'
  | 'VERIFIED'
  | 'OBSERVING'
  | 'EVALUATED';

export type OperationsInboxCategory =
  | 'AWAITING_HUMAN_MERGE'
  | 'POLICY_BLOCKED'
  | 'P8_VALIDATION_BLOCKED'
  | 'VERIFICATION_FAILED'
  | 'STALE'
  | 'EXECUTION_FAILED';

export type OperationsInboxSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export type OperationsTodayPriority = 'P0' | 'P1' | 'P2';

export type OperationsTodayActionKind =
  | 'INVESTIGATE_VERIFICATION'
  | 'INVESTIGATE_EXECUTION'
  | 'REVIEW_POLICY'
  | 'REVIEW_P8_HANDOFF'
  | 'REFRESH_EVIDENCE'
  | 'REVIEW_DRAFT_PR';

export type OperationsAlertPriority = 'P0' | 'P1';

export type OperationsAlertSource = 'OPERATIONS_INBOX' | 'AUTOMATION_RUN';

export type OperationsAlertKind =
  | 'VERIFICATION_FAILED'
  | 'EXECUTION_FAILED'
  | 'STALE'
  | 'POLICY_BLOCKED'
  | 'P8_VALIDATION_BLOCKED'
  | 'AUTOMATION_FAILED'
  | 'AUTOMATION_TIMED_OUT';

export type AutopilotDecisionProjectionStatus =
  | 'AUTOPILOT_READY'
  | 'P8_PREPARATION_REQUIRED'
  | 'MANUAL_REQUIRED'
  | 'POLICY_BLOCKED'
  | 'DEFERRED_QUOTA'
  | 'DEFERRED_CONFLICT'
  | 'STALE'
  | 'P8_VALIDATION_BLOCKED';

export type PublicationExecutionProjectionStatus =
  | 'PENDING'
  | 'READY'
  | 'PLANNED'
  | 'PREVIEW_READY'
  | 'APPROVED'
  | 'AUTOMATION_AUTHORIZED'
  | 'QUEUED'
  | 'EXECUTING'
  | 'PR_CREATED'
  | 'DEPLOYED'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'APPROVAL_STALE'
  | 'TARGET_REVISION_CHANGED'
  | 'VERIFICATION_FAILED'
  | 'STALE_REVIEW_REQUIRED'
  | 'FAILED'
  | 'ROLLBACK_PROPOSED'
  | 'ROLLED_BACK';

export type PublicationVerificationProjectionStatus =
  | 'PENDING'
  | 'VERIFIED'
  | 'FAILED'
  | 'UNKNOWN';

export type OperationsEffectState =
  | 'POSITIVE'
  | 'NEUTRAL'
  | 'NEGATIVE'
  | 'INCONCLUSIVE';

export type OperationsAutopilotDecisionAuthority = {
  id: string;
  status: AutopilotDecisionProjectionStatus;
  reasonCode: string;
  updatedAt: Date;
};

export type OperationsPublicationExecutionAuthority = {
  id: string;
  status: PublicationExecutionProjectionStatus;
  pullRequestNo: number | null;
  updatedAt: Date;
};

export type OperationsPublicationVerificationAuthority = {
  id: string;
  status: PublicationVerificationProjectionStatus;
  updatedAt: Date;
};

export type OperationsTerminalObservationAuthority = {
  id: string;
  effectState: OperationsEffectState;
  inputCutoffAt: Date;
  createdAt: Date;
};

export type OperationsPipelineAuthority = {
  growthOpportunityId?: string | null;
  candidate?: {
    id: string;
    eligibilityState: string;
  } | null;
  optimizationPlanId?: string | null;
  autopilotDecision?: OperationsAutopilotDecisionAuthority | null;
  p8Authority?: {
    proposalId?: string | null;
    planId?: string | null;
    previewId?: string | null;
  } | null;
  publicationExecution?: OperationsPublicationExecutionAuthority | null;
  publicationVerification?: OperationsPublicationVerificationAuthority | null;
  experiment?: {
    id: string;
    createdAt: Date;
  } | null;
  terminalObservation?: OperationsTerminalObservationAuthority | null;
};

export type OperationsInboxAuthority =
  | {
      authorityType: 'AUTOPILOT_DECISION';
      authorityId: string;
      status: AutopilotDecisionProjectionStatus;
      reasonCode: string;
      updatedAt: Date;
      authorityUrl: string | null;
      optimizationPlanId?: string | null;
      targetUrl?: string | null;
    }
  | {
      authorityType: 'PUBLICATION_EXECUTION';
      authorityId: string;
      status: PublicationExecutionProjectionStatus;
      reasonCode: string;
      updatedAt: Date;
      authorityUrl: string | null;
      optimizationPlanId?: string | null;
      targetUrl?: string | null;
    };

export type OperationsInboxItem = {
  id: string;
  authorityType: OperationsInboxAuthority['authorityType'];
  authorityId: string;
  category: OperationsInboxCategory;
  severity: OperationsInboxSeverity;
  reasonCode: string;
  optimizationPlanId: string | null;
  targetUrl: string | null;
  updatedAt: Date;
  authorityUrl: string | null;
};

export type OperationsTodayAction = {
  id: string;
  priority: OperationsTodayPriority;
  kind: OperationsTodayActionKind;
  title: string;
  recommendedAction: string;
  reasonCode: string;
  optimizationPlanId: string | null;
  targetUrl: string | null;
  updatedAt: Date;
  authorityUrl: string | null;
};

export type OperationsAutomationAlertAuthority = {
  id: string;
  status: 'FAILED' | 'TIMED_OUT';
  lastErrorCode: string | null;
  updatedAt: Date;
  authorityUrl: string | null;
};

export type OperationsAlert = {
  id: string;
  priority: OperationsAlertPriority;
  source: OperationsAlertSource;
  kind: OperationsAlertKind;
  title: string;
  reasonCode: string;
  optimizationPlanId: string | null;
  targetUrl: string | null;
  updatedAt: Date;
  authorityUrl: string | null;
};

export type OperationsOutcomeObservation = OperationsTerminalObservationAuthority;

export type OperationsFeedbackEvidenceAuthority = {
  observationId: string;
  inputCutoffAt: Date;
};

export type OperationsOutcomeWindow = {
  positive: number;
  neutral: number;
  negative: number;
  inconclusive: number;
  feedbackAccepted: number;
  feedbackDeferred: number;
};

export type OperationsOutcomeSummary = {
  last7Days: OperationsOutcomeWindow;
  last30Days: OperationsOutcomeWindow;
};

export type OperationsQuota = {
  configuredLimit: number;
  reserved: number;
  consumed: number;
  remaining: number;
};

export type OperationsReservationAuthority = {
  status: 'RESERVED' | 'CONSUMED' | 'RELEASED';
};

export type OperationsActivityItem = {
  occurredAt: Date;
  sourceModule: 'P9_A' | 'P9_B' | 'P9_C' | 'P8' | 'P9_D' | 'P9_E' | 'P9_F';
  eventType: string;
  title: string;
  summary: string;
  authorityId: string;
  authorityUrl: string | null;
  severity: 'INFO' | 'WARNING' | 'ERROR';
};
