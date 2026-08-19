import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';

export type VisibilityBudgetReason =
  | 'WITHIN_BUDGET'
  | 'RUN_BUDGET_EXCEEDED'
  | 'DAILY_BUDGET_EXCEEDED'
  | 'BUDGET_ESTIMATE_UNAVAILABLE';

export interface VisibilityBudgetInput {
  runCeilingMicros: number | null;
  dailyCeilingMicros: number | null;
  runRecordedSpendMicros: number;
  dailyRecordedSpendMicros: number;
  estimatedNextMicros: number | null;
}

export interface VisibilityBudgetDecision {
  allowed: boolean;
  reason: VisibilityBudgetReason;
  runRecordedSpendMicros: number;
  dailyRecordedSpendMicros: number;
  estimatedNextMicros: number | null;
}

export function checkVisibilityBudget(input: VisibilityBudgetInput): VisibilityBudgetDecision {
  const finiteBudgetConfigured = input.runCeilingMicros !== null || input.dailyCeilingMicros !== null;
  if (input.estimatedNextMicros === null) {
    return {
      allowed: !finiteBudgetConfigured,
      reason: finiteBudgetConfigured ? 'BUDGET_ESTIMATE_UNAVAILABLE' : 'WITHIN_BUDGET',
      runRecordedSpendMicros: input.runRecordedSpendMicros,
      dailyRecordedSpendMicros: input.dailyRecordedSpendMicros,
      estimatedNextMicros: null
    };
  }

  if (
    input.runCeilingMicros !== null &&
    input.runRecordedSpendMicros + input.estimatedNextMicros > input.runCeilingMicros
  ) {
    return {
      allowed: false,
      reason: 'RUN_BUDGET_EXCEEDED',
      runRecordedSpendMicros: input.runRecordedSpendMicros,
      dailyRecordedSpendMicros: input.dailyRecordedSpendMicros,
      estimatedNextMicros: input.estimatedNextMicros
    };
  }

  if (
    input.dailyCeilingMicros !== null &&
    input.dailyRecordedSpendMicros + input.estimatedNextMicros > input.dailyCeilingMicros
  ) {
    return {
      allowed: false,
      reason: 'DAILY_BUDGET_EXCEEDED',
      runRecordedSpendMicros: input.runRecordedSpendMicros,
      dailyRecordedSpendMicros: input.dailyRecordedSpendMicros,
      estimatedNextMicros: input.estimatedNextMicros
    };
  }

  return {
    allowed: true,
    reason: 'WITHIN_BUDGET',
    runRecordedSpendMicros: input.runRecordedSpendMicros,
    dailyRecordedSpendMicros: input.dailyRecordedSpendMicros,
    estimatedNextMicros: input.estimatedNextMicros
  };
}

function utcDayWindow(at: Date) {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

export class VisibilityBudgetService {
  async getDailyRecordedSpendMicros(projectId: string, at: Date = new Date()): Promise<number> {
    const { start, end } = utcDayWindow(at);
    const aggregate = await prisma.platformObservation.aggregate({
      where: {
        projectId,
        observedAt: { gte: start, lt: end },
        costMicros: { not: null }
      },
      _sum: { costMicros: true }
    });
    return aggregate._sum.costMicros ?? 0;
  }

  async getRunRecordedSpendMicros(visibilityRunId: string): Promise<number> {
    const aggregate = await prisma.platformObservation.aggregate({
      where: {
        visibilityRunId,
        costMicros: { not: null }
      },
      _sum: { costMicros: true }
    });
    return aggregate._sum.costMicros ?? 0;
  }

  async preflightObservation(
    observationId: string,
    estimatedNextMicros: number | null,
    at: Date = new Date()
  ): Promise<VisibilityBudgetDecision> {
    const observation = await prisma.platformObservation.findUnique({
      where: { id: observationId },
      include: { run: true }
    });
    if (!observation) {
      throw new NotFoundError('Visibility observation not found', 'VISIBILITY_OBSERVATION_NOT_FOUND');
    }

    const settings = await prisma.visibilityProjectSettings.findUnique({
      where: { projectId: observation.projectId }
    });
    const [runRecordedSpendMicros, dailyRecordedSpendMicros] = await Promise.all([
      this.getRunRecordedSpendMicros(observation.visibilityRunId),
      this.getDailyRecordedSpendMicros(observation.projectId, at)
    ]);

    return checkVisibilityBudget({
      runCeilingMicros: observation.run.budgetCeilingMicros,
      dailyCeilingMicros: settings?.dailyBudgetMicros ?? null,
      runRecordedSpendMicros,
      dailyRecordedSpendMicros,
      estimatedNextMicros
    });
  }

  async markBudgetSkipped(observationId: string, reason: VisibilityBudgetReason) {
    if (reason === 'WITHIN_BUDGET') {
      throw new AppError(
        'A within-budget observation cannot be marked as budget skipped',
        400,
        'INVALID_VISIBILITY_BUDGET_SKIP_REASON'
      );
    }
    const result = await prisma.platformObservation.updateMany({
      where: { id: observationId, status: 'RUNNING' },
      data: {
        status: 'BUDGET_SKIPPED',
        errorCode: reason
      }
    });
    if (result.count !== 1) {
      throw new NotFoundError(
        'Running visibility observation not found',
        'VISIBILITY_OBSERVATION_NOT_RUNNING'
      );
    }
  }
}

export const visibilityBudgetService = new VisibilityBudgetService();
