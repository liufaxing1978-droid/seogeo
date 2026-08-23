import {
  OptimizationAutopilotQueue,
  type OptimizationAutopilotJobData
} from './autopilot.queue.js';
import { OptimizationAutopilotRepository } from './autopilot.repository.js';

export const OPTIMIZATION_AUTOPILOT_RECONCILIATION_LIMIT = 100;

export type AutopilotRunItemQueuePort = Pick<OptimizationAutopilotQueue, 'enqueueRunItem'>;
export type AutopilotWorkerRepositoryPort = Pick<
  OptimizationAutopilotRepository,
  'listReadyItemsWithoutEffectiveDecision'
>;

export type OptimizationAutopilotWorkerDeps = {
  repository: AutopilotWorkerRepositoryPort;
  queue: AutopilotRunItemQueuePort;
};

function workerError(code: string, message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

export async function processOptimizationAutopilotJob(
  job: { name: string; data: OptimizationAutopilotJobData },
  deps?: OptimizationAutopilotWorkerDeps
): Promise<void> {
  if (!deps) {
    throw workerError(
      'AUTOPILOT_WORKER_DEPENDENCIES_MISSING',
      'Optimization autopilot worker dependencies are required'
    );
  }

  if (job.data.kind === 'RECONCILE_DAILY') {
    if (job.name !== 'reconcile-daily') {
      throw workerError('INVALID_AUTOPILOT_JOB', 'Unexpected autopilot reconciliation job name');
    }
    const readyItems = await deps.repository.listReadyItemsWithoutEffectiveDecision(
      OPTIMIZATION_AUTOPILOT_RECONCILIATION_LIMIT
    );
    for (const item of readyItems) {
      await deps.queue.enqueueRunItem(item.id, item.projectId);
    }
    return;
  }

  if (job.name !== 'evaluate-run-item') {
    throw workerError('INVALID_AUTOPILOT_JOB', 'Unexpected autopilot evaluation job name');
  }

  throw workerError(
    'AUTOPILOT_EVALUATION_NOT_IMPLEMENTED',
    'Autopilot policy evaluation is introduced by the later full worker task'
  );
}
