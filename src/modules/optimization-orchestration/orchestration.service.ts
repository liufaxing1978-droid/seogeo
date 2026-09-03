import type {
  AutomationDefinition,
  AutomationRun,
  AutomationRunSource,
  OptimizationRun,
  PlanLevel
} from '@prisma/client';
import { defaultRepeatStrategy } from 'bullmq';
import { hasFeature } from '../../auth/feature-flags.js';
import { OPTIMIZATION_PLAN_VERSION } from '../optimization/optimization.types.js';
import type {
  CreateAutomationDefinitionInput,
  UpdateAutomationDefinitionInput
} from './orchestration.automation-definition.repository.js';
import { parseSearchRefreshConfig } from './orchestration.automation.actions.js';
import {
  buildDailyTriggerKey,
  buildGrowthTriggerKey,
  buildManualTriggerKey
} from './orchestration.identity.js';
import type { AutomationScheduleDefinition } from './orchestration.queue.js';
import { OPTIMIZATION_RUN_VERSION, type GrowthTriggerInput } from './orchestration.types.js';
import type {
  CreateAutomationRunInput,
  CreateRunInput,
  GuardedAutomationRunTransition,
  ListAutomationRunsInput
} from './orchestration.repository.js';

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

export type AutomationRunRepositoryPort = {
  findAutomationDefinition(definitionId: string): Promise<AutomationDefinition | null>;
  findActiveAutomationRun(definitionId: string): Promise<AutomationRun | null>;
  createAutomationRun(input: CreateAutomationRunInput): Promise<AutomationRun>;
  getAutomationRun(runId: string): Promise<AutomationRun | null>;
  getAutomationRunForProject?(input: {
    projectId: string;
    runId: string;
  }): Promise<AutomationRun | null>;
  transitionAutomationRun(input: GuardedAutomationRunTransition): Promise<boolean>;
  listTimedOutAutomationRuns(asOf: Date): Promise<AutomationRun[]>;
  listAutomationRuns?(input: ListAutomationRunsInput): Promise<AutomationRun[]>;
};

export type AutomationRunQueuePort = {
  enqueueRun(runId: string, projectId: string): Promise<unknown>;
};

export type AutomationDefinitionRepositoryPort = {
  listAutomationDefinitions(projectId: string): Promise<AutomationDefinition[]>;
  createAutomationDefinition(input: CreateAutomationDefinitionInput): Promise<AutomationDefinition>;
  updateAutomationDefinition(
    input: UpdateAutomationDefinitionInput
  ): Promise<AutomationDefinition | null>;
};

export type AutomationScheduleQueuePort = {
  syncDefinitionSchedule(definition: AutomationScheduleDefinition): Promise<unknown>;
};

export type OptimizationOrchestrationServiceDeps = {
  repository: OrchestrationTriggerRepositoryPort;
  planningQueue: OptimizationPlanningQueuePort;
  projects: OrchestrationProjectPort;
  automationRuns?: AutomationRunRepositoryPort;
  automationQueue?: AutomationRunQueuePort;
  automationDefinitions?: AutomationDefinitionRepositoryPort;
  automationSchedules?: AutomationScheduleQueuePort;
  now?: () => Date;
};

export type StartAutomationRunInput = {
  definitionId: string;
  projectId: string;
  source: AutomationRunSource;
  requestKey: string;
};

export type RetryAutomationRunInput = {
  runId: string;
  projectId: string;
};

export type CreateManagedAutomationDefinitionInput = {
  projectId: string;
  key: string;
  actionType: string;
  actionConfig: unknown;
  enabled: boolean;
  scheduleCron: string | null;
  maxAttempts: number;
  timeoutMs: number;
};

export type UpdateManagedAutomationDefinitionInput = {
  definitionId: string;
  projectId: string;
  patch: {
    key?: string;
    actionType?: string;
    actionConfig?: unknown;
    enabled?: boolean;
    scheduleCron?: string | null;
    maxAttempts?: number;
    timeoutMs?: number;
  };
};

const MAX_AUTOMATION_ATTEMPTS = 10;
const MIN_AUTOMATION_TIMEOUT_MS = 1_000;
const MAX_AUTOMATION_TIMEOUT_MS = 3_600_000;

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

function deadlineFrom(now: Date, timeoutMs: number): Date {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error('Automation definition timeout must be a positive integer');
  }
  return new Date(now.getTime() + timeoutMs);
}

function assertAutomationExecutionPolicy(maxAttempts: number, timeoutMs: number): void {
  if (
    !Number.isInteger(maxAttempts)
    || maxAttempts < 1
    || maxAttempts > MAX_AUTOMATION_ATTEMPTS
  ) {
    throw new Error(`Automation maxAttempts must be an integer between 1 and ${MAX_AUTOMATION_ATTEMPTS}`);
  }
  if (
    !Number.isInteger(timeoutMs)
    || timeoutMs < MIN_AUTOMATION_TIMEOUT_MS
    || timeoutMs > MAX_AUTOMATION_TIMEOUT_MS
  ) {
    throw new Error(
      `Automation timeoutMs must be an integer between ${MIN_AUTOMATION_TIMEOUT_MS} and ${MAX_AUTOMATION_TIMEOUT_MS}`
    );
  }
}

function normalizeAutomationKey(key: string): string {
  const normalized = key.trim();
  if (!normalized) throw new Error('Automation definition key is required');
  return normalized;
}

function normalizeActionType(actionType: string): string {
  const normalized = actionType.trim();
  if (!normalized) throw new Error('Automation action type is required');
  if (normalized !== 'SEARCH_REFRESH') {
    throw new Error(`Unsupported automation action type: ${normalized}`);
  }
  return normalized;
}

function normalizeScheduleCron(scheduleCron: string | null): string | null {
  if (scheduleCron === null) return null;
  const normalized = scheduleCron.trim();
  if (!normalized) return null;

  try {
    const nextRunAt = defaultRepeatStrategy(Date.now(), {
      pattern: normalized,
      tz: 'UTC'
    });
    if (nextRunAt === undefined) {
      throw new Error('Automation schedule has no future run');
    }
  } catch {
    throw new Error('Automation schedule cron is invalid');
  }

  return normalized;
}

export class OptimizationOrchestrationService {
  constructor(private readonly deps: OptimizationOrchestrationServiceDeps) {}

  private async enqueueIfQueued(run: OptimizationRun): Promise<void> {
    if (run.status !== 'QUEUED') return;
    await this.deps.planningQueue.enqueueRun(run.id, run.projectId);
  }

  private automationDeps(): {
    repository: AutomationRunRepositoryPort;
    queue: AutomationRunQueuePort;
  } {
    if (!this.deps.automationRuns || !this.deps.automationQueue) {
      throw new Error('Automation orchestration dependencies are not configured');
    }
    return {
      repository: this.deps.automationRuns,
      queue: this.deps.automationQueue
    };
  }

  private automationDefinitionDeps(): {
    repository: AutomationDefinitionRepositoryPort;
    schedules: AutomationScheduleQueuePort;
  } {
    if (!this.deps.automationDefinitions || !this.deps.automationSchedules) {
      throw new Error('Automation definition management dependencies are not configured');
    }
    return {
      repository: this.deps.automationDefinitions,
      schedules: this.deps.automationSchedules
    };
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  private async requireAutomationDefinition(
    definitionId: string,
    projectId: string
  ): Promise<AutomationDefinition> {
    const { repository } = this.automationDeps();
    const definition = await repository.findAutomationDefinition(definitionId);
    if (!definition) throw new Error('Automation definition not found');
    if (definition.projectId !== projectId) {
      throw new Error('Automation definition project mismatch');
    }
    return definition;
  }

  async listAutomationDefinitions(projectId: string): Promise<AutomationDefinition[]> {
    const { repository } = this.automationDefinitionDeps();
    return repository.listAutomationDefinitions(projectId);
  }

  async createAutomationDefinition(
    input: CreateManagedAutomationDefinitionInput
  ): Promise<AutomationDefinition> {
    const { repository, schedules } = this.automationDefinitionDeps();
    assertAutomationExecutionPolicy(input.maxAttempts, input.timeoutMs);
    const actionType = normalizeActionType(input.actionType);
    parseSearchRefreshConfig(input.actionConfig);

    const created = await repository.createAutomationDefinition({
      projectId: input.projectId,
      key: normalizeAutomationKey(input.key),
      actionType,
      actionConfig: input.actionConfig,
      enabled: input.enabled,
      scheduleCron: normalizeScheduleCron(input.scheduleCron),
      overlapPolicy: 'SKIP_IF_RUNNING',
      maxAttempts: input.maxAttempts,
      timeoutMs: input.timeoutMs
    });
    await schedules.syncDefinitionSchedule(created);
    return created;
  }

  async updateAutomationDefinition(
    input: UpdateManagedAutomationDefinitionInput
  ): Promise<AutomationDefinition> {
    const { repository, schedules } = this.automationDefinitionDeps();
    const patch = { ...input.patch };

    if (patch.key !== undefined) patch.key = normalizeAutomationKey(patch.key);
    if (patch.actionType !== undefined) patch.actionType = normalizeActionType(patch.actionType);
    if (patch.actionConfig !== undefined) parseSearchRefreshConfig(patch.actionConfig);
    if (patch.scheduleCron !== undefined) {
      patch.scheduleCron = normalizeScheduleCron(patch.scheduleCron);
    }

    const currentDefinitions = await repository.listAutomationDefinitions(input.projectId);
    const current = currentDefinitions.find((candidate) => candidate.id === input.definitionId);
    if (!current) throw new Error('Automation definition not found');

    const candidate = {
      ...current,
      ...patch
    };
    normalizeAutomationKey(candidate.key);
    assertAutomationExecutionPolicy(candidate.maxAttempts, candidate.timeoutMs);
    normalizeActionType(candidate.actionType);
    parseSearchRefreshConfig(candidate.actionConfig);
    normalizeScheduleCron(candidate.scheduleCron);

    const updated = await repository.updateAutomationDefinition({
      definitionId: input.definitionId,
      projectId: input.projectId,
      patch
    });
    if (!updated) throw new Error('Automation definition not found');

    await schedules.syncDefinitionSchedule(updated);
    return updated;
  }

  async reconcileAutomationSchedules(
    projectId: string
  ): Promise<{ considered: number; synced: number }> {
    const { repository, schedules } = this.automationDefinitionDeps();
    const definitions = await repository.listAutomationDefinitions(projectId);
    for (const definition of definitions) {
      assertAutomationExecutionPolicy(definition.maxAttempts, definition.timeoutMs);
      normalizeActionType(definition.actionType);
      parseSearchRefreshConfig(definition.actionConfig);
      normalizeScheduleCron(definition.scheduleCron);
    }

    let synced = 0;
    for (const definition of definitions) {
      await schedules.syncDefinitionSchedule(definition);
      synced += 1;
    }
    return { considered: definitions.length, synced };
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

  async listAutomationRuns(input: ListAutomationRunsInput): Promise<AutomationRun[]> {
    const { repository } = this.automationDeps();
    if (!repository.listAutomationRuns) {
      throw new Error('Automation run listing is not configured');
    }
    return repository.listAutomationRuns(input);
  }

  async getAutomationRun(input: {
    projectId: string;
    runId: string;
  }): Promise<AutomationRun | null> {
    const { repository } = this.automationDeps();
    if (!repository.getAutomationRunForProject) {
      throw new Error('Automation run detail lookup is not configured');
    }
    return repository.getAutomationRunForProject(input);
  }

  async startAutomationRun(input: StartAutomationRunInput): Promise<AutomationRun> {
    if (!input.requestKey.trim()) throw new Error('Automation request key is required');
    const { repository, queue } = this.automationDeps();
    const definition = await this.requireAutomationDefinition(input.definitionId, input.projectId);
    if (!definition.enabled) throw new Error('Automation definition is disabled');

    const active = await repository.findActiveAutomationRun(definition.id);
    if (active && definition.overlapPolicy === 'SKIP_IF_RUNNING') {
      return repository.createAutomationRun({
        definitionId: definition.id,
        projectId: definition.projectId,
        source: input.source,
        requestKey: input.requestKey,
        status: 'SKIPPED',
        attempt: 1,
        deadlineAt: null,
        blockedByRunId: active.id
      });
    }

    const now = this.now();
    const run = await repository.createAutomationRun({
      definitionId: definition.id,
      projectId: definition.projectId,
      source: input.source,
      requestKey: input.requestKey,
      status: 'QUEUED',
      attempt: 1,
      deadlineAt: deadlineFrom(now, definition.timeoutMs),
      blockedByRunId: null
    });

    if (run.status === 'QUEUED') {
      await queue.enqueueRun(run.id, run.projectId);
    }
    return run;
  }

  async retryAutomationRun(input: RetryAutomationRunInput): Promise<AutomationRun> {
    const { repository, queue } = this.automationDeps();
    const run = await repository.getAutomationRun(input.runId);
    if (!run) throw new Error('Automation run not found');
    if (run.projectId !== input.projectId) {
      throw new Error('Automation run project mismatch');
    }
    if (run.status !== 'FAILED') {
      throw new Error('Only failed automation runs can be retried');
    }

    const definition = await this.requireAutomationDefinition(run.definitionId, run.projectId);
    if (run.attempt >= definition.maxAttempts) {
      throw new Error('Automation retry attempt budget exhausted');
    }

    const transitioned = await repository.transitionAutomationRun({
      runId: run.id,
      from: 'FAILED',
      to: 'QUEUED',
      patch: {
        attempt: run.attempt + 1,
        deadlineAt: deadlineFrom(this.now(), definition.timeoutMs),
        startedAt: null,
        completedAt: null,
        lastErrorCode: null
      }
    });
    if (!transitioned) throw new Error('Automation retry transition conflict');

    const newDeadline = deadlineFrom(this.now(), definition.timeoutMs);
    await queue.enqueueRun(run.id, run.projectId);
    return {
      ...run,
      status: 'QUEUED',
      attempt: run.attempt + 1,
      deadlineAt: newDeadline,
      startedAt: null,
      completedAt: null,
      lastErrorCode: null
    };
  }

  async expireTimedOutAutomationRuns(
    asOf: Date = this.now()
  ): Promise<{ considered: number; timedOut: number }> {
    const { repository } = this.automationDeps();
    const runs = await repository.listTimedOutAutomationRuns(asOf);
    let timedOut = 0;

    for (const run of runs) {
      const transitioned = await repository.transitionAutomationRun({
        runId: run.id,
        from: 'RUNNING',
        to: 'TIMED_OUT',
        patch: {
          completedAt: asOf,
          lastErrorCode: 'AUTOMATION_TIMEOUT'
        }
      });
      if (transitioned) timedOut += 1;
    }

    return { considered: runs.length, timedOut };
  }
}
