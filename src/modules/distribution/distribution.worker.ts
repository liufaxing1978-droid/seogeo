import type { Job } from 'bullmq';
import { DistributionService } from './distribution.service.js';
import type { DistributionPreparationJobData } from './distribution.queue.js';

export interface DistributionPreparationJobLike {
  name: string;
  data: DistributionPreparationJobData;
}

export type DistributionPreparationWorkerDependencies = {
  service?: Pick<DistributionService, 'prepareTargetNow'>;
};

export async function processDistributionPreparationJob(
  job: DistributionPreparationJobLike | Pick<Job<DistributionPreparationJobData>, 'name' | 'data'>,
  dependencies: DistributionPreparationWorkerDependencies = {}
): Promise<void> {
  if (job.name !== 'prepare') throw new Error(`Unsupported distribution preparation job: ${job.name}`);
  const targetId = job.data?.targetId;
  const sourceContentVersion = job.data?.sourceContentVersion;
  if (typeof targetId !== 'string' || !targetId.trim()) {
    throw new Error('targetId is required for distribution preparation');
  }
  if (!Number.isInteger(sourceContentVersion) || sourceContentVersion < 1) {
    throw new Error('sourceContentVersion must be a positive integer');
  }

  const service = dependencies.service ?? new DistributionService();
  await service.prepareTargetNow({ targetId, sourceContentVersion });
}
