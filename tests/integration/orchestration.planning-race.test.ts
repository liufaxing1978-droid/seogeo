import { randomUUID } from 'node:crypto';
import { afterAll, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { OptimizationOrchestrationRepository } from '../../src/modules/optimization-orchestration/orchestration.repository.js';
import { processOptimizationPlanningJob } from '../../src/modules/optimization-orchestration/orchestration.worker.js';

const repository = new OptimizationOrchestrationRepository();
const NOW = new Date('2026-08-23T07:00:00.000Z');
let projectId: string | null = null;

afterAll(async () => {
  if (!projectId) return;
  await prisma.optimizationRunItem.deleteMany({ where: { projectId } });
  await prisma.optimizationRun.deleteMany({ where: { projectId } });
  await prisma.project.delete({ where: { id: projectId } });
});

it('treats a concurrent planning checkpoint winner as idempotent success', async () => {
  const nonce = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: 'P9-B planning checkpoint race',
      slug: `p9b-planning-race-${nonce}`,
      primaryDomain: `p9b-planning-race-${nonce}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectId = project.id;

  const run = await repository.createOrGetRun({
    projectId: project.id,
    runVersion: 'OPTIMIZATION_RUN_V1',
    triggerType: 'MANUAL',
    triggerSource: 'MANUAL_REQUEST',
    triggerKey: 'e'.repeat(64),
    triggerPayload: {
      version: 'P9_B_MANUAL_TRIGGER_V1',
      manualRequestId: randomUUID(),
      requestedBy: 'planning-race-test'
    }
  });

  let arrivals = 0;
  let release!: () => void;
  const barrier = new Promise<void>((resolve) => {
    release = resolve;
  });
  const materializeProject = vi.fn().mockImplementation(async () => {
    arrivals += 1;
    if (arrivals === 2) release();
    await barrier;
    return { candidates: [], plans: [], aiTaskId: null };
  });
  const enqueueRun = vi.fn().mockResolvedValue({ id: 'continuation' });
  const deps = {
    repository,
    materializeProject,
    orchestrationQueue: { enqueueRun },
    orchestrationService: { reconcileUtcDate: vi.fn() },
    advisoryRootDir: '/tmp/p9b-advisory-test',
    now: () => NOW
  };
  const job = {
    name: 'materialize-run',
    data: {
      kind: 'MATERIALIZE_RUN' as const,
      runId: run.id,
      projectId: project.id
    }
  };

  await expect(
    Promise.all([
      processOptimizationPlanningJob(job, deps),
      processOptimizationPlanningJob(job, deps)
    ])
  ).resolves.toEqual([undefined, undefined]);

  expect(materializeProject).toHaveBeenCalledTimes(2);
  expect(enqueueRun).toHaveBeenCalledTimes(2);
  expect(await repository.getRun(run.id)).toMatchObject({
    status: 'RUNNING',
    planningCompletedAt: NOW,
    lastErrorCode: null
  });
});
