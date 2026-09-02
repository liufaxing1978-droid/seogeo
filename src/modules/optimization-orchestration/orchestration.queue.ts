import type { JobsOptions, Queue } from 'bullmq';

export const OPTIMIZATION_PLANNING_QUEUE_NAME = 'optimization-planning' as const;
export const OPTIMIZATION_ORCHESTRATION_QUEUE_NAME = 'optimization-orchestration' as const;
export const OPTIMIZATION_AUTOMATION_QUEUE_NAME = 'optimization-automation' as const;
export const OPTIMIZATION_QUEUE_ATTEMPTS = 2;
export const OPTIMIZATION_AUTOMATION_QUEUE_ATTEMPTS = 2;

export type OptimizationPlanningJobData =
  | {
      kind: 'MATERIALIZE_RUN';
      runId: string;
      projectId: string;
    }
  | {
      kind: 'RECONCILE_DAILY';
    };

export type OptimizationOrchestrationJobData = {
  runId: string;
  projectId: string;
};

export type OptimizationAutomationJobData =
  | {
      kind: 'EXECUTE_RUN';
      runId: string;
      projectId: string;
    }
  | {
      kind: 'START_SCHEDULED';
      definitionId: string;
      projectId: string;
    };

export type AutomationScheduleDefinition = {
  id: string;
  projectId: string;
  enabled: boolean;
  scheduleCron: string | null;
};

type QueueAdder = Pick<Queue, 'add'>;
type AutomationQueuePort = Pick<Queue, 'add' | 'upsertJobScheduler' | 'removeJobScheduler'>;

function boundedOptions(jobId: string): JobsOptions {
  return {
    jobId,
    attempts: OPTIMIZATION_QUEUE_ATTEMPTS,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: 100,
    removeOnFail: 200
  };
}

export function buildOptimizationPlanningJobOptions(runId: string): JobsOptions {
  return boundedOptions(`optimization-planning-${runId}`);
}

export function buildOptimizationOrchestrationJobOptions(runId: string): JobsOptions {
  return boundedOptions(`optimization-orchestration-${runId}`);
}

export function buildOptimizationAutomationJobOptions(runId: string): JobsOptions {
  return {
    jobId: `optimization-automation-${runId}`,
    attempts: OPTIMIZATION_AUTOMATION_QUEUE_ATTEMPTS,
    backoff: { type: 'exponential', delay: 5_000 },
    removeOnComplete: true,
    removeOnFail: 200
  };
}

export function buildOptimizationAutomationSchedulerId(definitionId: string): string {
  return `optimization-automation-definition-${definitionId}`;
}

export class OptimizationPlanningQueue {
  constructor(private readonly queue: QueueAdder) {}

  enqueueRun(runId: string, projectId: string): Promise<unknown> {
    const payload: OptimizationPlanningJobData = {
      kind: 'MATERIALIZE_RUN',
      runId,
      projectId
    };
    return this.queue.add(
      'materialize-run',
      payload,
      buildOptimizationPlanningJobOptions(runId)
    );
  }
}

export class OptimizationOrchestrationQueue {
  constructor(private readonly queue: QueueAdder) {}

  enqueueRun(runId: string, projectId: string): Promise<unknown> {
    const payload: OptimizationOrchestrationJobData = { runId, projectId };
    return this.queue.add(
      'advance-run',
      payload,
      buildOptimizationOrchestrationJobOptions(runId)
    );
  }
}

export class OptimizationAutomationQueue {
  constructor(private readonly queue: AutomationQueuePort) {}

  enqueueRun(runId: string, projectId: string): Promise<unknown> {
    const payload: OptimizationAutomationJobData = {
      kind: 'EXECUTE_RUN',
      runId,
      projectId
    };
    return this.queue.add(
      'execute-automation-run',
      payload,
      buildOptimizationAutomationJobOptions(runId)
    );
  }

  async syncDefinitionSchedule(definition: AutomationScheduleDefinition): Promise<unknown> {
    const schedulerId = buildOptimizationAutomationSchedulerId(definition.id);
    const scheduleCron = definition.scheduleCron?.trim() ?? '';
    if (!definition.enabled || scheduleCron.length === 0) {
      return this.queue.removeJobScheduler(schedulerId);
    }

    const payload: OptimizationAutomationJobData = {
      kind: 'START_SCHEDULED',
      definitionId: definition.id,
      projectId: definition.projectId
    };
    return this.queue.upsertJobScheduler(
      schedulerId,
      { pattern: scheduleCron, tz: 'UTC' },
      {
        name: 'start-scheduled-automation',
        data: payload,
        opts: {
          removeOnComplete: 100,
          removeOnFail: 200
        }
      }
    );
  }
}
