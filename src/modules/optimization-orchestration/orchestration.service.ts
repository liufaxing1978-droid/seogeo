import type { OptimizationRun, PlanLevel } from '@prisma/client';
import { hasFeature } from '../../auth/feature-flags.js';
import { OPTIMIZATION_PLAN_VERSION } from '../optimization/optimization.types.js';
import {
  buildDailyTriggerKey,
  buildGrowthTriggerKey,
  buildManualTriggerKey
} from './orchestration.identity.js';
import { OPTIMIZATION_RUN_VERSION, type GrowthTriggerInput } from './orchestration.types.js';
import type { CreateRunInput } from './orchestration.repository.js';

export type OrchestrationTriggerRepositoryPort = {
  createOrGetRun(input: CreateRunInput): Promise<OptimizationRun>;
  getRun(runId: string): Promise<OptimizationRun | null>;
};

export type OptimizationPlanningQueuePort = {
  enqueueRun(runId: string, projectId: string): Promise<unknown>;
};

export type OrchestrationProjectPort = {
  list(): Promise<Array<{ id: string; planLevel: PlanLevel }>>;
  findById(projectId: string): Promise<{ id: string; planLevel: PlanLevel } | null>;
};

export type OptimizationOrchestrationServiceDeps = {
  repository: OrchestrationTriggerRepositoryPort;
  planningQueue: OptimizationPlanningQueuePort;
  projects: OrchestrationProjectPort;
};

function normalizeSnapshotIds(snapshotIds: readonly string[]): string[] {
  return [...new Set(snapshotIds)].sort();
}

function assertUtcDate(utcDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(utcDate)) {
    throw new Error('UTC date must use exact YYYY-MM-DD format');
  }

  const parsed = new Date(`${utcDate}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== utcDate) {
    throw new Error('UTC date must be a valid YYYY-MM-DD date');
  }
}

export class OptimizationOrchestrationService {
  constructor(private readonly deps: OptimizationOrchestrationServiceDeps) {}

  private async enqueueIfQueued(run: OptimizationRun): Promise<void> {
    if (run.status !== 'QUEUED') return;
    await this.deps.planningQueue.enqueueRun(run.id, run.projectId);
  }

  async triggerGrowth(input: GrowthTriggerInput): Promise<OptimizationRun> {
    const project = await this.deps.projects.findById(input.projectId);
    if (!project) throw new Error('Optimization orchestration project not found');
    if (!hasFeature(project.planLevel, 'OPTIMIZATION_ORCHESTRATION')) {
      throw new Error('Optimization orchestration feature entitlement required');
    }

    const selectedGscSnapshotIds = normalizeSnapshotIds(input.selectedGscSnapshotIds);
    const run = await this.deps.repository.createOrGetRun({
      projectId: input.projectId,
      runVersion: OPTIMIZATION_RUN_VERSION,
      triggerType: 'EVENT',
      triggerSource: 'GROWTH_MATERIALIZATION',
      triggerKey: buildGrowthTriggerKey({
        ...input,
        selectedGscSnapshotIds
      }),
      triggerPayload: {
        version: 'P9_B_GROWTH_TRIGGER_V1',
        asOfDate: input.asOfDate,
        growthMaterializationVersion: input.materializationVersion,
        growthFormulaVersion: input.formulaVersion,
        growthState: input.state,
        selectedGscSnapshotIds
      }
    });

    await this.enqueueIfQueued(run);
    return run;
  }

  async triggerManual(input: {
    projectId: string;
    manualRequestId: string;
    requestedBy: string;
  }): Promise<OptimizationRun> {
    const run = await this.deps.repository.createOrGetRun({
      projectId: input.projectId,
      runVersion: OPTIMIZATION_RUN_VERSION,
      triggerType: 'MANUAL',
      triggerSource: 'MANUAL_REQUEST',
      triggerKey: buildManualTriggerKey({
        projectId: input.projectId,
        manualRequestId: input.manualRequestId
      }),
      triggerPayload: {
        version: 'P9_B_MANUAL_TRIGGER_V1',
        manualRequestId: input.manualRequestId,
        requestedBy: input.requestedBy
      }
    });

    await this.enqueueIfQueued(run);
    return run;
  }

  async reconcileUtcDate(utcDate: string): Promise<{ considered: number; queued: number }> {
    assertUtcDate(utcDate);
    const projects = await this.deps.projects.list();
    let queued = 0;

    for (const project of projects) {
      if (!hasFeature(project.planLevel, 'OPTIMIZATION_ORCHESTRATION')) continue;

      const run = await this.deps.repository.createOrGetRun({
        projectId: project.id,
        runVersion: OPTIMIZATION_RUN_VERSION,
        triggerType: 'DAILY_RECONCILIATION',
        triggerSource: 'DAILY_SCHEDULER',
        triggerKey: buildDailyTriggerKey({
          projectId: project.id,
          utcDate,
          plannerVersion: OPTIMIZATION_PLAN_VERSION
        }),
        triggerPayload: {
          version: 'P9_B_DAILY_TRIGGER_V1',
          utcDate,
          plannerVersion: OPTIMIZATION_PLAN_VERSION
        }
      });

      if (run.status === 'QUEUED') {
        await this.deps.planningQueue.enqueueRun(run.id, run.projectId);
        queued += 1;
      }
    }

    return { considered: projects.length, queued };
  }

  async requeueRun(runId: string): Promise<OptimizationRun> {
    const run = await this.deps.repository.getRun(runId);
    if (!run) throw new Error('Optimization orchestration run not found');
    await this.enqueueIfQueued(run);
    return run;
  }
}
