import {
  Prisma,
  type AutopilotExecutionReservation,
  type AutopilotPolicy,
  type OptimizationAutopilotDecision
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';
import { canonicalJson } from './autopilot.identity.js';
import {
  CONTROLLED_AUTOPILOT_POLICY_VERSION,
  type AutopilotRunItemContext,
  type CreateAutopilotDecisionInput,
  type NormalizedAutopilotPolicy
} from './autopilot.types.js';

function asJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(canonicalJson(value)) as Prisma.InputJsonValue;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: string }).code === 'P2002'
  );
}

function assertDecisionIdentity(
  existing: OptimizationAutopilotDecision,
  input: CreateAutopilotDecisionInput
): void {
  if (
    existing.projectId !== input.projectId
    || existing.runId !== input.runId
    || existing.runItemId !== input.runItemId
    || existing.optimizationPlanId !== input.optimizationPlanId
    || existing.policyId !== input.policyId
    || existing.policyVersion !== input.policyVersion
    || canonicalJson(existing.policySnapshot) !== canonicalJson(input.policySnapshot)
    || canonicalJson(existing.sourceSnapshot) !== canonicalJson(input.sourceSnapshot)
    || existing.status !== input.status
    || canonicalJson(existing.reasonCodes) !== canonicalJson([...input.reasonCodes])
    || existing.p8PlanId !== input.p8PlanId
    || existing.p8PreviewId !== input.p8PreviewId
    || existing.decisionKey !== input.decisionKey
  ) {
    throw new Error('AUTOPILOT_DECISION_IDENTITY_COLLISION');
  }
}

function operationPaths(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return [];
    const path = (item as Record<string, Prisma.JsonValue>)['path'];
    return typeof path === 'string' ? [path] : [];
  });
}

function operationTypes(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return [];
    const type = (item as Record<string, Prisma.JsonValue>)['type'];
    return typeof type === 'string' ? [type] : [];
  });
}

function validationCodes(
  value: Prisma.JsonValue | null
): { blockingCodes: string[]; warningCodes: string[] } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, Prisma.JsonValue>;
  const blockingCodes = record['blockingCodes'];
  const warningCodes = record['warningCodes'];
  if (!Array.isArray(blockingCodes) || !blockingCodes.every((code) => typeof code === 'string')) {
    return null;
  }
  if (!Array.isArray(warningCodes) || !warningCodes.every((code) => typeof code === 'string')) {
    return null;
  }
  return {
    blockingCodes: blockingCodes as string[],
    warningCodes: warningCodes as string[]
  };
}

export class OptimizationAutopilotRepository {
  constructor(private readonly db: typeof prisma = prisma) {}

  getPolicy(projectId: string): Promise<AutopilotPolicy | null> {
    return this.db.autopilotPolicy.findUnique({ where: { projectId } });
  }

  async upsertPolicy(
    projectId: string,
    input: NormalizedAutopilotPolicy,
    actorId: string
  ): Promise<AutopilotPolicy> {
    const existing = await this.getPolicy(projectId);
    const now = new Date();
    const enabling = input.enabled && existing?.enabled !== true;
    const enabledBy = enabling ? actorId : existing?.enabledBy ?? null;
    const enabledAt = enabling ? now : existing?.enabledAt ?? null;

    return this.db.autopilotPolicy.upsert({
      where: { projectId },
      create: {
        projectId,
        enabled: input.enabled,
        policyVersion: CONTROLLED_AUTOPILOT_POLICY_VERSION,
        allowedRiskClass: input.allowedRiskClass,
        allowedOperationClasses: asJson([...input.allowedOperationClasses]),
        dailyDraftPrLimit: input.dailyDraftPrLimit,
        maxConcurrentRuns: input.maxConcurrentRuns,
        requireFreshEvidence: input.requireFreshEvidence,
        minimumEvidenceCoverage: input.minimumEvidenceCoverage,
        pauseOnVerificationFailure: input.pauseOnVerificationFailure,
        killSwitch: input.killSwitch,
        enabledBy: input.enabled ? actorId : null,
        enabledAt: input.enabled ? now : null,
        updatedBy: actorId
      },
      update: {
        enabled: input.enabled,
        policyVersion: CONTROLLED_AUTOPILOT_POLICY_VERSION,
        allowedRiskClass: input.allowedRiskClass,
        allowedOperationClasses: asJson([...input.allowedOperationClasses]),
        dailyDraftPrLimit: input.dailyDraftPrLimit,
        maxConcurrentRuns: input.maxConcurrentRuns,
        requireFreshEvidence: input.requireFreshEvidence,
        minimumEvidenceCoverage: input.minimumEvidenceCoverage,
        pauseOnVerificationFailure: input.pauseOnVerificationFailure,
        killSwitch: input.killSwitch,
        enabledBy,
        enabledAt,
        updatedBy: actorId
      }
    });
  }

  async loadRunItemContext(
    runItemId: string,
    projectId: string
  ): Promise<AutopilotRunItemContext | null> {
    const row = await this.db.optimizationRunItem.findFirst({
      where: {
        id: runItemId,
        projectId,
        run: { projectId }
      },
      select: {
        id: true,
        projectId: true,
        runId: true,
        optimizationPlanId: true
      }
    });

    if (!row) return null;
    return {
      runItemId: row.id,
      projectId: row.projectId,
      runId: row.runId,
      optimizationPlanId: row.optimizationPlanId
    };
  }

  async listReadyItemsWithoutEffectiveDecision(
    limit: number
  ): Promise<Array<{ id: string; projectId: string }>> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error('AUTOPILOT_RECONCILIATION_LIMIT_INVALID');
    }

    return this.db.$queryRaw<Array<{ id: string; projectId: string }>>(Prisma.sql`
      SELECT item."id", item."projectId"
      FROM "OptimizationRunItem" AS item
      WHERE item."currentStage" = 'READY_FOR_POLICY'::"OptimizationRunItemStage"
        AND item."status" = 'COMPLETED'::"OptimizationRunItemStatus"
        AND NOT EXISTS (
          SELECT 1
          FROM "OptimizationAutopilotDecision" AS decision
          WHERE decision."runItemId" = item."id"
            AND decision."optimizationPlanId" = item."optimizationPlanId"
        )
      ORDER BY item."createdAt" ASC, item."id" ASC
      LIMIT ${limit}
    `);
  }

  async loadGrowthAuthorityFacts(
    projectId: string,
    growthOpportunityIdentityId: string
  ): Promise<{
    latestGrowthSnapshotId: string;
    growthScoreState: string;
    growthRankingEligible: boolean;
    growthLifecycleStatus: string | null;
  } | null> {
    const latest = await this.db.growthOpportunitySnapshot.findFirst({
      where: {
        projectId,
        opportunityIdentityId: growthOpportunityIdentityId
      },
      orderBy: [
        { currentWindowEnd: 'desc' },
        { dataCutoffAt: 'desc' },
        { createdAt: 'desc' },
        { id: 'desc' }
      ],
      select: {
        id: true,
        scoreState: true,
        rankingEligible: true
      }
    });
    if (!latest) return null;

    const lifecycle = await this.db.growthOpportunityLifecycle.findUnique({
      where: { opportunityIdentityId: growthOpportunityIdentityId },
      select: { status: true }
    });

    return {
      latestGrowthSnapshotId: latest.id,
      growthScoreState: latest.scoreState,
      growthRankingEligible: latest.rankingEligible,
      growthLifecycleStatus: lifecycle?.status ?? null
    };
  }

  async loadLatestVerificationState(
    projectId: string
  ): Promise<'VERIFICATION_FAILED' | 'VERIFIED' | null> {
    const execution = await this.db.publicationExecution.findFirst({
      where: {
        projectId,
        status: { in: ['VERIFICATION_FAILED', 'VERIFIED'] }
      },
      orderBy: [
        { updatedAt: 'desc' },
        { createdAt: 'desc' },
        { id: 'desc' }
      ],
      select: { status: true }
    });

    if (execution?.status === 'VERIFICATION_FAILED' || execution?.status === 'VERIFIED') {
      return execution.status;
    }
    return null;
  }

  async hasActivePublicationConflict(input: {
    projectId: string;
    targetPublicUrl: string;
    targetRepository: string;
    repositoryPath: string;
  }): Promise<boolean> {
    const executions = await this.db.publicationExecution.findMany({
      where: {
        projectId: input.projectId,
        status: {
          in: ['APPROVED', 'AUTOMATION_AUTHORIZED', 'QUEUED', 'EXECUTING']
        },
        plan: {
          OR: [
            { targetPublicUrl: input.targetPublicUrl },
            { targetRepository: input.targetRepository }
          ]
        }
      },
      select: {
        plan: {
          select: {
            targetPublicUrl: true,
            targetRepository: true,
            operations: true
          }
        }
      }
    });

    return executions.some(({ plan }) => {
      if (plan.targetPublicUrl === input.targetPublicUrl) return true;
      if (plan.targetRepository !== input.targetRepository) return false;
      return operationPaths(plan.operations).includes(input.repositoryPath);
    });
  }

  async loadExactP8AuthorityFacts(input: {
    projectId: string;
    optimizationPlanId: string;
    runItemId: string;
  }): Promise<{
    proposalId: string;
    p8PlanId: string;
    p8PreviewId: string;
    siteId: string;
    channelId: string;
    draftId: string;
    draftVersion: number;
    contentHash: string;
    riskClass: string;
    operationTypes: string[];
    blockingCodes: string[];
    warningCodes: string[];
    gitDraftPrAvailable: boolean;
    targetPublicUrl: string;
    targetRepository: string;
    targetBranch: string;
    baseSha: string;
    targetBlobHashes: Prisma.JsonValue | null;
    planHash: string;
    previewHash: string;
  } | null> {
    const proposal = await this.db.publicationProposal.findFirst({
      where: {
        projectId: input.projectId,
        sourceType: 'P9_OPTIMIZATION_PLAN',
        sourceReferenceId: input.optimizationPlanId,
        sourceSnapshotId: input.runItemId
      },
      select: { id: true }
    });
    if (!proposal) return null;

    const plan = await this.db.publicationPlan.findFirst({
      where: {
        projectId: input.projectId,
        proposalId: proposal.id,
        preview: { isNot: null }
      },
      orderBy: [
        { version: 'desc' },
        { createdAt: 'desc' },
        { id: 'desc' }
      ],
      select: {
        id: true,
        siteId: true,
        channelId: true,
        draftId: true,
        draftVersion: true,
        riskClass: true,
        operations: true,
        targetPublicUrl: true,
        targetRepository: true,
        targetBranch: true,
        baseSha: true,
        targetBlobHashes: true,
        planHash: true,
        draft: {
          select: {
            projectId: true,
            sourceProposalId: true
          }
        },
        site: {
          select: {
            projectId: true,
            enabled: true,
            adapterType: true,
            writeCapability: true
          }
        },
        channel: {
          select: {
            id: true,
            siteId: true,
            enabled: true
          }
        },
        preview: {
          select: {
            id: true,
            projectId: true,
            previewHash: true,
            validationResult: true
          }
        }
      }
    });

    if (
      !plan
      || !plan.preview
      || !plan.channelId
      || !plan.channel
      || plan.site.projectId !== input.projectId
      || plan.channel.siteId !== plan.siteId
      || plan.draft.projectId !== input.projectId
      || plan.draft.sourceProposalId !== proposal.id
      || plan.preview.projectId !== input.projectId
    ) {
      return null;
    }

    const draftVersion = await this.db.contentDraftVersion.findUnique({
      where: {
        draftId_version: {
          draftId: plan.draftId,
          version: plan.draftVersion
        }
      },
      select: { contentHash: true }
    });
    if (!draftVersion?.contentHash) return null;

    const codes = validationCodes(plan.preview.validationResult);
    if (!codes) return null;

    return {
      proposalId: proposal.id,
      p8PlanId: plan.id,
      p8PreviewId: plan.preview.id,
      siteId: plan.siteId,
      channelId: plan.channelId,
      draftId: plan.draftId,
      draftVersion: plan.draftVersion,
      contentHash: draftVersion.contentHash,
      riskClass: plan.riskClass,
      operationTypes: operationTypes(plan.operations),
      blockingCodes: codes.blockingCodes,
      warningCodes: codes.warningCodes,
      gitDraftPrAvailable: plan.site.enabled
        && plan.channel.enabled
        && plan.site.adapterType === 'GITHUB_GIT'
        && plan.site.writeCapability === 'GIT_DRAFT_PR',
      targetPublicUrl: plan.targetPublicUrl,
      targetRepository: plan.targetRepository,
      targetBranch: plan.targetBranch,
      baseSha: plan.baseSha,
      targetBlobHashes: plan.targetBlobHashes,
      planHash: plan.planHash,
      previewHash: plan.preview.previewHash
    };
  }

  async hasExistingAutomaticHandoff(projectId: string, runItemId: string): Promise<boolean> {
    const decisions = await this.db.optimizationAutopilotDecision.findMany({
      where: { projectId, runItemId },
      select: { id: true }
    });
    if (decisions.length === 0) return false;

    const authorization = await this.db.publicationAutomationAuthorization.findFirst({
      where: {
        projectId,
        automationSource: 'CONTROLLED_AUTOPILOT',
        automationDecisionId: { in: decisions.map(({ id }) => id) }
      },
      select: { id: true }
    });
    return authorization !== null;
  }

  async reserveAutopilotCapacity(input: {
    projectId: string;
    decisionId: string;
    utcDate: string;
    utcDateValue: Date;
    dailyDraftPrLimit: number;
    maxConcurrentRuns: number;
  }): Promise<
    | { reserved: true; reservation: AutopilotExecutionReservation }
    | { reserved: false; reasonCode: 'AUTOPILOT_DAILY_QUOTA_EXHAUSTED' | 'AUTOPILOT_CONCURRENCY_LIMIT' }
  > {
    const lockKey = `p9c:${input.projectId}:${input.utcDate}`;

    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ lock: string }>>(Prisma.sql`
        SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))::text AS "lock"
      `);

      const decision = await tx.optimizationAutopilotDecision.findFirst({
        where: {
          id: input.decisionId,
          projectId: input.projectId
        },
        select: { id: true }
      });
      if (!decision) throw new Error('AUTOPILOT_DECISION_NOT_FOUND');

      const existing = await tx.autopilotExecutionReservation.findUnique({
        where: { decisionId: input.decisionId }
      });
      if (existing) {
        const existingDate = existing.utcDate.toISOString().slice(0, 10);
        if (existing.projectId !== input.projectId || existingDate !== input.utcDate) {
          throw new Error('AUTOPILOT_RESERVATION_IDENTITY_COLLISION');
        }
        if (existing.status === 'RELEASED') {
          throw new Error('AUTOPILOT_RESERVATION_RELEASED');
        }
        return { reserved: true as const, reservation: existing };
      }

      const dailyReservations = await tx.autopilotExecutionReservation.count({
        where: {
          projectId: input.projectId,
          utcDate: input.utcDateValue,
          status: { in: ['RESERVED', 'CONSUMED'] }
        }
      });
      if (dailyReservations >= input.dailyDraftPrLimit) {
        return {
          reserved: false as const,
          reasonCode: 'AUTOPILOT_DAILY_QUOTA_EXHAUSTED' as const
        };
      }

      const activeMachineExecutions = await tx.publicationExecution.count({
        where: {
          projectId: input.projectId,
          automationAuthorizationId: { not: null },
          status: { in: ['AUTOMATION_AUTHORIZED', 'QUEUED', 'EXECUTING'] }
        }
      });
      if (activeMachineExecutions >= input.maxConcurrentRuns) {
        return {
          reserved: false as const,
          reasonCode: 'AUTOPILOT_CONCURRENCY_LIMIT' as const
        };
      }

      const reservation = await tx.autopilotExecutionReservation.create({
        data: {
          projectId: input.projectId,
          decisionId: input.decisionId,
          utcDate: input.utcDateValue,
          reservationKey: `p9c:${input.projectId}:${input.utcDate}:${input.decisionId}`,
          status: 'RESERVED'
        }
      });

      return { reserved: true as const, reservation };
    });
  }

  async createOrGetDecision(
    input: CreateAutopilotDecisionInput
  ): Promise<OptimizationAutopilotDecision> {
    const existing = await this.db.optimizationAutopilotDecision.findUnique({
      where: { decisionKey: input.decisionKey }
    });
    if (existing) {
      assertDecisionIdentity(existing, input);
      return existing;
    }

    try {
      return await this.db.optimizationAutopilotDecision.create({
        data: {
          projectId: input.projectId,
          runId: input.runId,
          runItemId: input.runItemId,
          optimizationPlanId: input.optimizationPlanId,
          policyId: input.policyId,
          policyVersion: input.policyVersion,
          policySnapshot: asJson(input.policySnapshot),
          sourceSnapshot: asJson(input.sourceSnapshot),
          status: input.status,
          reasonCodes: asJson([...input.reasonCodes]),
          p8PlanId: input.p8PlanId,
          p8PreviewId: input.p8PreviewId,
          decisionKey: input.decisionKey
        }
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const collided = await this.db.optimizationAutopilotDecision.findUnique({
        where: { decisionKey: input.decisionKey }
      });
      if (!collided) throw error;
      assertDecisionIdentity(collided, input);
      return collided;
    }
  }
}
