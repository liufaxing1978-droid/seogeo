import {
  Prisma,
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
