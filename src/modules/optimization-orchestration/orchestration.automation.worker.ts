import type { AutomationDefinition, AutomationRun } from '@prisma/client';
import type { OptimizationAutomationJobData } from './orchestration.queue.js';
import type { GuardedAutomationRunTransition } from './orchestration.repository.js';
import type { StartAutomationRunInput } from './orchestration.service.js';

export class OptimizationAutomationWorkerError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'OptimizationAutomationWorkerError';
  }
}

export type AutomationWorkerRepositoryPort = {
  getAutomationRun(runId: string): Promise<AutomationRun | null>;
  findAutomationDefinition(definitionId: string): Promise<AutomationDefinition | null>;
  transitionAutomationRun(input: GuardedAutomationRunTransition): Promise<boolean>;
};

export type AutomationActionDispatcherPort = {
  execute(input: {
    actionType: string;
    actionConfig: unknown;
    projectId: string;
    runId: string;
    definitionId: string;
  }): Promise<void>;
};

export type OptimizationAutomationWorkerDeps = {
  repository: AutomationWorkerRepositoryPort;
  service: {
    startAutomationRun(input: StartAutomationRunInput): Promise<AutomationRun>;
    expireTimedOutAutomationRuns(asOf?: Date): Promise<unknown>;
  };
  actions: AutomationActionDispatcherPort;
  now?: () => Date;
};

type AutomationJob = {
  id?: string | number | null;
  name: string;
  data: OptimizationAutomationJobData;
};

const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'TIMED_OUT', 'SKIPPED']);

function workerError(code: string, message: string): OptimizationAutomationWorkerError {
  return new OptimizationAutomationWorkerError(code, message);
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code.trim().length > 0) return code;
  }
  return 'AUTOMATION_ACTION_FAILED';
}

function requireScheduledJobId(job: AutomationJob): string {
  if (typeof job.id !== 'string' || job.id.trim().length === 0) {
    throw workerError(
      'AUTOMATION_SCHEDULER_JOB_ID_REQUIRED',
      'Scheduled automation requires a durable scheduler job id'
    );
  }
  return job.id;
}

async function startScheduledAutomation(
  job: AutomationJob,
  deps: OptimizationAutomationWorkerDeps
): Promise<void> {
  if (job.name !== 'start-scheduled-automation') {
    throw workerError('INVALID_AUTOMATION_JOB', 'Unexpected scheduled automation job name');
  }
  if (job.data.kind !== 'START_SCHEDULED') {
    throw workerError('INVALID_AUTOMATION_JOB', 'Scheduled automation payload is invalid');
  }

  const schedulerJobId = requireScheduledJobId(job);
  await deps.service.startAutomationRun({
    definitionId: job.data.definitionId,
    projectId: job.data.projectId,
    source: 'SCHEDULED',
    requestKey: `scheduler:${schedulerJobId}`
  });
}

async function repairTimedOutAutomationRuns(
  job: AutomationJob,
  deps: OptimizationAutomationWorkerDeps
): Promise<void> {
  if (job.name !== 'repair-timed-out-automation-runs') {
    throw workerError('INVALID_AUTOMATION_JOB', 'Unexpected automation timeout repair job name');
  }
  if (job.data.kind !== 'REPAIR_TIMEOUTS') {
    throw workerError('INVALID_AUTOMATION_JOB', 'Automation timeout repair payload is invalid');
  }

  const now = deps.now ?? (() => new Date());
  await deps.service.expireTimedOutAutomationRuns(now());
}

async function transitionOrReload(input: {
  deps: OptimizationAutomationWorkerDeps;
  run: AutomationRun;
  transition: GuardedAutomationRunTransition;
}): Promise<AutomationRun | null> {
  const transitioned = await input.deps.repository.transitionAutomationRun(input.transition);
  if (transitioned) {
    return {
      ...input.run,
      status: input.transition.to,
      ...(input.transition.patch ?? {})
    } as AutomationRun;
  }

  return input.deps.repository.getAutomationRun(input.run.id);
}

async function executeAutomationRun(
  job: AutomationJob,
  deps: OptimizationAutomationWorkerDeps
): Promise<void> {
  if (job.name !== 'execute-automation-run') {
    throw workerError('INVALID_AUTOMATION_JOB', 'Unexpected automation execution job name');
  }
  if (job.data.kind !== 'EXECUTE_RUN') {
    throw workerError('INVALID_AUTOMATION_JOB', 'Automation execution payload is invalid');
  }

  const now = deps.now ?? (() => new Date());
  let run = await deps.repository.getAutomationRun(job.data.runId);
  if (!run) throw workerError('AUTOMATION_RUN_NOT_FOUND', 'Automation run does not exist');
  if (run.projectId !== job.data.projectId) {
    throw workerError('AUTOMATION_RUN_PROJECT_MISMATCH', 'Automation run project mismatch');
  }
  if (TERMINAL_STATUSES.has(run.status)) return;

  const currentTime = now();
  if (run.deadlineAt && run.deadlineAt.getTime() <= currentTime.getTime()) {
    const from = run.status === 'RUNNING' ? 'RUNNING' : 'QUEUED';
    await deps.repository.transitionAutomationRun({
      runId: run.id,
      from,
      to: 'TIMED_OUT',
      patch: {
        completedAt: currentTime,
        lastErrorCode: 'AUTOMATION_TIMEOUT'
      }
    });
    return;
  }

  if (run.status === 'QUEUED') {
    const transitioned = await transitionOrReload({
      deps,
      run,
      transition: {
        runId: run.id,
        from: 'QUEUED',
        to: 'RUNNING',
        patch: {
          startedAt: currentTime,
          lastErrorCode: null
        }
      }
    });
    if (!transitioned) {
      throw workerError('AUTOMATION_RUN_TRANSITION_CONFLICT', 'Automation run disappeared during start');
    }
    if (TERMINAL_STATUSES.has(transitioned.status)) return;
    if (transitioned.status !== 'RUNNING') {
      throw workerError('AUTOMATION_RUN_TRANSITION_CONFLICT', 'Automation run could not enter RUNNING');
    }
    run = transitioned;
  }

  if (run.status !== 'RUNNING') {
    throw workerError('AUTOMATION_RUN_INVALID_STATE', 'Automation run is not executable');
  }

  try {
    const definition = await deps.repository.findAutomationDefinition(run.definitionId);
    if (!definition) {
      throw workerError('AUTOMATION_DEFINITION_NOT_FOUND', 'Automation definition does not exist');
    }
    if (definition.projectId !== run.projectId) {
      throw workerError('AUTOMATION_DEFINITION_PROJECT_MISMATCH', 'Automation definition project mismatch');
    }
    if (!definition.enabled) {
      throw workerError('AUTOMATION_DEFINITION_DISABLED', 'Automation definition is disabled');
    }

    await deps.actions.execute({
      actionType: definition.actionType,
      actionConfig: definition.actionConfig,
      projectId: run.projectId,
      runId: run.id,
      definitionId: definition.id
    });
  } catch (error) {
    await deps.repository.transitionAutomationRun({
      runId: run.id,
      from: 'RUNNING',
      to: 'FAILED',
      patch: {
        completedAt: now(),
        lastErrorCode: errorCode(error)
      }
    });
    return;
  }

  const completedAt = now();
  const transitioned = await deps.repository.transitionAutomationRun({
    runId: run.id,
    from: 'RUNNING',
    to: 'SUCCEEDED',
    patch: {
      completedAt,
      lastErrorCode: null
    }
  });
  if (!transitioned) {
    const latest = await deps.repository.getAutomationRun(run.id);
    if (latest && TERMINAL_STATUSES.has(latest.status)) return;
    throw workerError(
      'AUTOMATION_RUN_TERMINAL_TRANSITION_CONFLICT',
      'Automation run terminal transition was not applied'
    );
  }
}

export async function processOptimizationAutomationJob(
  job: AutomationJob,
  deps?: OptimizationAutomationWorkerDeps
): Promise<void> {
  if (!deps) {
    throw workerError(
      'AUTOMATION_WORKER_DEPENDENCIES_MISSING',
      'Automation worker dependencies are required'
    );
  }

  if (job.data.kind === 'START_SCHEDULED') {
    await startScheduledAutomation(job, deps);
    return;
  }

  if (job.data.kind === 'REPAIR_TIMEOUTS') {
    await repairTimedOutAutomationRuns(job, deps);
    return;
  }

  await executeAutomationRun(job, deps);
}
