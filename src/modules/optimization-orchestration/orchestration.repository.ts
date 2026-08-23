import {
  Prisma,
  type OptimizationRun,
  type OptimizationRunItem,
  type OptimizationRunItemStage,
  type OptimizationRunItemStatus,
  type OptimizationRunStatus,
  type OptimizationTriggerSource,
  type OptimizationTriggerType,
  type PrismaClient
} from '@prisma/client';
import { prisma } from '../../db/prisma.js';

export type OrchestrationDbClient = Pick<
  PrismaClient,
  'optimizationRun' | 'optimizationRunItem' | 'optimizationPlan'
>;

export type CreateRunInput = {
  projectId: string;
  runVersion: string;
  triggerType: OptimizationTriggerType;
  triggerSource: OptimizationTriggerSource;
  triggerKey: string;
  triggerPayload: unknown;
};

export type GuardedRunTransition = {
  runId: string;
  from: OptimizationRunStatus;
  to: OptimizationRunStatus;
  patch?: {
    candidateCount?: number;
    plannedCount?: number;
    itemCount?: number;
    completedCount?: number;
    failureCount?: number;
    startedAt?: Date | null;
    planningCompletedAt?: Date | null;
    completedAt?: Date | null;
    lastErrorCode?: string | null;
  };
};

export type PlanningCompletionInput = {
  runId: string;
  candidateCount: number;
  plannedCount: number;
  itemCount: number;
  planningCompletedAt: Date;
};

export type CreateRunItemInput = {
  runId: string;
  projectId: string;
  optimizationPlanId: string;
  itemKey: string;
};

export type GuardedItemTransition = {
  itemId: string;
  from: OptimizationRunItemStatus;
  to: OptimizationRunItemStatus;
  patch?: {
    currentStage?: OptimizationRunItemStage;
    reasonCode?: string | null;
    completedAt?: Date | null;
  };
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return canonicalize(value) as Prisma.InputJsonValue;
}

function isUniqueViolation(error: unknown): boolean {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function assertRunIdentity(existing: OptimizationRun, input: CreateRunInput): void {
  if (
    existing.projectId !== input.projectId ||
    existing.runVersion !== input.runVersion ||
    existing.triggerType !== input.triggerType ||
    existing.triggerSource !== input.triggerSource ||
    existing.triggerKey !== input.triggerKey ||
    canonicalJson(existing.triggerPayload) !== canonicalJson(input.triggerPayload)
  ) {
    throw new Error('Optimization run identity conflict');
  }
}

function assertRunItemIdentity(existing: OptimizationRunItem, input: CreateRunItemInput): void {
  if (
    existing.runId !== input.runId ||
    existing.projectId !== input.projectId ||
    existing.optimizationPlanId !== input.optimizationPlanId ||
    existing.itemKey !== input.itemKey
  ) {
    throw new Error('Optimization run item identity conflict');
  }
}

export class OptimizationOrchestrationRepository {
  constructor(private readonly db: OrchestrationDbClient = prisma) {}

  async createOrGetRun(input: CreateRunInput): Promise<OptimizationRun> {
    const existing = await this.db.optimizationRun.findUnique({
      where: {
        projectId_triggerKey: {
          projectId: input.projectId,
          triggerKey: input.triggerKey
        }
      }
    });
    if (existing) {
      assertRunIdentity(existing, input);
      return existing;
    }

    try {
      return await this.db.optimizationRun.create({
        data: {
          projectId: input.projectId,
          runVersion: input.runVersion,
          triggerType: input.triggerType,
          triggerSource: input.triggerSource,
          triggerKey: input.triggerKey,
          triggerPayload: asJson(input.triggerPayload)
        }
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const collided = await this.db.optimizationRun.findUnique({
        where: {
          projectId_triggerKey: {
            projectId: input.projectId,
            triggerKey: input.triggerKey
          }
        }
      });
      if (!collided) throw error;
      assertRunIdentity(collided, input);
      return collided;
    }
  }

  getRun(runId: string): Promise<OptimizationRun | null> {
    return this.db.optimizationRun.findUnique({ where: { id: runId } });
  }

  listRunsByStatus(statuses: OptimizationRunStatus[]): Promise<OptimizationRun[]> {
    return this.db.optimizationRun.findMany({
      where: { status: { in: statuses } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
  }

  async transitionRun(input: GuardedRunTransition): Promise<boolean> {
    const patch = input.patch ?? {};
    const updated = await this.db.optimizationRun.updateMany({
      where: { id: input.runId, status: input.from },
      data: {
        status: input.to,
        ...(patch.candidateCount !== undefined ? { candidateCount: patch.candidateCount } : {}),
        ...(patch.plannedCount !== undefined ? { plannedCount: patch.plannedCount } : {}),
        ...(patch.itemCount !== undefined ? { itemCount: patch.itemCount } : {}),
        ...(patch.completedCount !== undefined ? { completedCount: patch.completedCount } : {}),
        ...(patch.failureCount !== undefined ? { failureCount: patch.failureCount } : {}),
        ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
        ...(patch.planningCompletedAt !== undefined
          ? { planningCompletedAt: patch.planningCompletedAt }
          : {}),
        ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {}),
        ...(patch.lastErrorCode !== undefined ? { lastErrorCode: patch.lastErrorCode } : {})
      }
    });
    return updated.count === 1;
  }

  async markPlanningComplete(input: PlanningCompletionInput): Promise<boolean> {
    const updated = await this.db.optimizationRun.updateMany({
      where: {
        id: input.runId,
        status: 'RUNNING',
        planningCompletedAt: null
      },
      data: {
        candidateCount: input.candidateCount,
        plannedCount: input.plannedCount,
        itemCount: input.itemCount,
        planningCompletedAt: input.planningCompletedAt,
        lastErrorCode: null
      }
    });
    return updated.count === 1;
  }

  async createOrGetRunItem(input: CreateRunItemInput): Promise<OptimizationRunItem> {
    const [run, plan] = await Promise.all([
      this.db.optimizationRun.findUnique({
        where: { id: input.runId },
        select: { id: true, projectId: true }
      }),
      this.db.optimizationPlan.findUnique({
        where: { id: input.optimizationPlanId },
        select: { id: true, projectId: true }
      })
    ]);

    if (!run) throw new Error('Optimization run not found');
    if (!plan) throw new Error('Optimization plan not found');
    if (run.projectId !== input.projectId || plan.projectId !== input.projectId) {
      throw new Error('Optimization run item project mismatch');
    }

    const existing = await this.db.optimizationRunItem.findUnique({
      where: {
        runId_optimizationPlanId: {
          runId: input.runId,
          optimizationPlanId: input.optimizationPlanId
        }
      }
    });
    if (existing) {
      assertRunItemIdentity(existing, input);
      return existing;
    }

    try {
      return await this.db.optimizationRunItem.create({ data: input });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const collided = await this.db.optimizationRunItem.findUnique({
        where: {
          runId_optimizationPlanId: {
            runId: input.runId,
            optimizationPlanId: input.optimizationPlanId
          }
        }
      });
      if (!collided) throw error;
      assertRunItemIdentity(collided, input);
      return collided;
    }
  }

  listRunItems(runId: string): Promise<OptimizationRunItem[]> {
    return this.db.optimizationRunItem.findMany({
      where: { runId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }]
    });
  }

  async transitionItem(input: GuardedItemTransition): Promise<boolean> {
    const patch = input.patch ?? {};
    const updated = await this.db.optimizationRunItem.updateMany({
      where: { id: input.itemId, status: input.from },
      data: {
        status: input.to,
        ...(patch.currentStage !== undefined ? { currentStage: patch.currentStage } : {}),
        ...(patch.reasonCode !== undefined ? { reasonCode: patch.reasonCode } : {}),
        ...(patch.completedAt !== undefined ? { completedAt: patch.completedAt } : {})
      }
    });
    return updated.count === 1;
  }

  async refreshRunCounters(runId: string): Promise<OptimizationRun> {
    const run = await this.getRun(runId);
    if (!run) throw new Error('Optimization run not found');

    const [itemCount, completedCount, failureCount] = await Promise.all([
      this.db.optimizationRunItem.count({ where: { runId } }),
      this.db.optimizationRunItem.count({ where: { runId, status: 'COMPLETED' } }),
      this.db.optimizationRunItem.count({ where: { runId, status: 'FAILED' } })
    ]);

    return this.db.optimizationRun.update({
      where: { id: runId },
      data: { itemCount, completedCount, failureCount }
    });
  }
}

export const optimizationOrchestrationRepository = new OptimizationOrchestrationRepository();
