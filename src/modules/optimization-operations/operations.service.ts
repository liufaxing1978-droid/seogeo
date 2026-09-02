import { hasFeature } from '../../auth/feature-flags.js';
import { parseControlledAutopilotGlobalKillSwitch } from '../optimization-autopilot/autopilot.config.js';
import {
  deriveAlertCenter,
  deriveEffectiveAutopilotState,
  deriveInboxItems,
  deriveOutcomeSummary,
  derivePipelineStage,
  deriveQuota,
  deriveTodayActions,
} from './operations.derive.js';
import {
  OptimizationOperationsRepository,
  type OperationsFeedbackProfileRead,
} from './operations.repository.js';
import type {
  EffectiveAutopilotState,
  OperationsActivityItem,
  OperationsAlert,
  OperationsInboxCategory,
  OperationsInboxItem,
  OperationsOutcomeSummary,
  OperationsPipelineAuthority,
  OperationsPipelineStage,
  OperationsQuota,
  OperationsTodayAction,
} from './operations.types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PERSISTED_CUTOFF = new Date('9999-12-31T23:59:59.999Z');

const PIPELINE_STAGES: readonly OperationsPipelineStage[] = [
  'DISCOVERED',
  'ELIGIBLE',
  'PLANNED',
  'AUTOPILOT_DECIDED',
  'P8_HANDOFF',
  'DRAFT_PR',
  'VERIFIED',
  'OBSERVING',
  'EVALUATED',
];

const INBOX_CATEGORIES: readonly OperationsInboxCategory[] = [
  'AWAITING_HUMAN_MERGE',
  'POLICY_BLOCKED',
  'P8_VALIDATION_BLOCKED',
  'VERIFICATION_FAILED',
  'STALE',
  'EXECUTION_FAILED',
];

export type OperationsPagination = {
  limit: number;
  offset: number;
};

export type GlobalKillSwitchReader = () => boolean;

export type OperationsPipelineItem = OperationsPipelineAuthority & {
  stage: OperationsPipelineStage;
};

export type OperationsFeedbackSummary = {
  sampleCount: number;
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  rollingEffectBalance: number;
  historicalRankAdjustment: number;
  newestEvidenceCutoffAt: Date | null;
  profileId: string | null;
};

export type OperationsOverview = {
  effectiveAutopilotState: EffectiveAutopilotState;
  todayRunCount: number;
  todayActions: OperationsTodayAction[];
  alerts?: OperationsAlert[];
  quota: OperationsQuota;
  pipelineCounts: Record<OperationsPipelineStage, number>;
  inboxCounts: Record<OperationsInboxCategory, number>;
  experimentSummary: OperationsOutcomeSummary;
  feedbackSummary: OperationsFeedbackSummary;
  recentActivity: OperationsActivityItem[];
  generatedAt: Date;
};

export const readControlledAutopilotGlobalKillSwitch: GlobalKillSwitchReader = () =>
  parseControlledAutopilotGlobalKillSwitch(
    process.env.CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH,
  );

function utcDayBounds(now: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

function countPipeline(items: readonly OperationsPipelineItem[]): Record<OperationsPipelineStage, number> {
  const counts = Object.fromEntries(PIPELINE_STAGES.map((stage) => [stage, 0])) as Record<
    OperationsPipelineStage,
    number
  >;
  for (const item of items) counts[item.stage] += 1;
  return counts;
}

function countInbox(items: readonly OperationsInboxItem[]): Record<OperationsInboxCategory, number> {
  const counts = Object.fromEntries(INBOX_CATEGORIES.map((category) => [category, 0])) as Record<
    OperationsInboxCategory,
    number
  >;
  for (const item of items) counts[item.category] += 1;
  return counts;
}

function summarizeFeedback(profile: OperationsFeedbackProfileRead | undefined): OperationsFeedbackSummary {
  if (!profile) {
    return {
      sampleCount: 0,
      positiveCount: 0,
      neutralCount: 0,
      negativeCount: 0,
      rollingEffectBalance: 0,
      historicalRankAdjustment: 0,
      newestEvidenceCutoffAt: null,
      profileId: null,
    };
  }
  return {
    sampleCount: profile.sampleCount,
    positiveCount: profile.positiveCount,
    neutralCount: profile.neutralCount,
    negativeCount: profile.negativeCount,
    rollingEffectBalance: profile.rollingEffectBalance,
    historicalRankAdjustment: profile.historicalRankAdjustment,
    newestEvidenceCutoffAt: profile.newestEvidenceCutoffAt,
    profileId: profile.id,
  };
}

export class OptimizationOperationsService {
  constructor(
    private readonly repository = new OptimizationOperationsRepository(),
    private readonly globalKillSwitchReader: GlobalKillSwitchReader = readControlledAutopilotGlobalKillSwitch,
  ) {}

  async getOverview(projectId: string, now: Date = new Date()): Promise<OperationsOverview> {
    const { start: utcDayStart, end: utcDayEnd } = utcDayBounds(now);
    const cutoff30 = new Date(now.getTime() - 30 * DAY_MS);
    const automationAlertPromise = typeof (
      this.repository as unknown as { listAutomationAlertAuthority?: unknown }
    ).listAutomationAlertAuthority === 'function'
      ? this.repository.listAutomationAlertAuthority(projectId, 100)
      : Promise.resolve([]);

    const [
      planLevel,
      policy,
      todayRunCount,
      pipelineAuthority,
      inboxAuthority,
      automationAlertAuthority,
      observations,
      feedbackEvidence,
      feedbackProfiles,
      reservations,
      recentActivity,
    ] = await Promise.all([
      this.repository.getProjectPlanLevel(projectId),
      this.repository.getCurrentPolicy(projectId),
      this.repository.countTodayRuns(projectId, utcDayStart, utcDayEnd),
      this.repository.listPipelineAuthority(projectId, 100, 0),
      this.repository.listInboxAuthority(projectId, 100, 0),
      automationAlertPromise,
      this.repository.listTerminalObservations(projectId, cutoff30, now),
      this.repository.listFeedbackEvidence(projectId, cutoff30, now),
      this.repository.listFeedbackProfiles(projectId, 1, 0),
      this.repository.listReservations(projectId, utcDayStart),
      this.repository.listRecentActivityAuthority(projectId, 50),
    ]);

    const pipelineItems = pipelineAuthority.map((authority) => ({
      ...authority,
      stage: derivePipelineStage(authority),
    }));
    const inboxItems = deriveInboxItems(inboxAuthority);

    return {
      effectiveAutopilotState: deriveEffectiveAutopilotState({
        globalKillSwitch: this.globalKillSwitchReader(),
        projectKillSwitch: policy?.killSwitch ?? false,
        featureEnabled: planLevel !== null
          && hasFeature(planLevel, 'OPTIMIZATION_OPERATIONS_CENTER'),
        policyEnabled: policy?.enabled ?? false,
      }),
      todayRunCount,
      todayActions: deriveTodayActions(inboxItems),
      alerts: deriveAlertCenter({
        inboxItems,
        automationRuns: automationAlertAuthority,
      }),
      quota: deriveQuota({
        configuredLimit: policy?.dailyDraftPrLimit ?? 0,
        reservations,
      }),
      pipelineCounts: countPipeline(pipelineItems),
      inboxCounts: countInbox(inboxItems),
      experimentSummary: deriveOutcomeSummary({
        now,
        observations,
        feedbackEvidence,
      }),
      feedbackSummary: summarizeFeedback(feedbackProfiles[0]),
      recentActivity,
      generatedAt: new Date(now.getTime()),
    };
  }

  async listPipeline(
    projectId: string,
    pagination: OperationsPagination,
  ): Promise<OperationsPipelineItem[]> {
    const authority = await this.repository.listPipelineAuthority(
      projectId,
      pagination.limit,
      pagination.offset,
    );
    return authority.map((item) => ({ ...item, stage: derivePipelineStage(item) }));
  }

  async listInbox(
    projectId: string,
    pagination: OperationsPagination,
  ): Promise<OperationsInboxItem[]> {
    const authority = await this.repository.listInboxAuthority(
      projectId,
      pagination.limit,
      pagination.offset,
    );
    return deriveInboxItems(authority);
  }

  async listExperiments(projectId: string, pagination: OperationsPagination) {
    if (pagination.offset >= 100) return [];
    const rows = await this.repository.listTerminalObservations(
      projectId,
      new Date(0),
      MAX_PERSISTED_CUTOFF,
    );
    return rows.slice(pagination.offset, pagination.offset + pagination.limit);
  }

  async listFeedback(
    projectId: string,
    pagination: OperationsPagination,
  ): Promise<OperationsFeedbackProfileRead[]> {
    return this.repository.listFeedbackProfiles(
      projectId,
      pagination.limit,
      pagination.offset,
    );
  }

  async getPolicy(projectId: string) {
    return this.repository.getCurrentPolicy(projectId);
  }

  async listPolicyRevisions(projectId: string, pagination: OperationsPagination) {
    return this.repository.listPolicyRevisions(
      projectId,
      pagination.limit,
      pagination.offset,
    );
  }
}
