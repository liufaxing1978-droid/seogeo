import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { OptimizationOrchestrationRepository } from '../../src/modules/optimization-orchestration/orchestration.repository.js';
import { OptimizationOrchestrationService } from '../../src/modules/optimization-orchestration/orchestration.service.js';

const projectIds: string[] = [];

class CoordinatedAutomationRepository extends OptimizationOrchestrationRepository {
  private activeReads = 0;
  private releaseBoth!: () => void;
  private readonly bothReadsCompleted = new Promise<void>((resolve) => {
    this.releaseBoth = resolve;
  });

  override async findActiveAutomationRun(definitionId: string) {
    const active = await super.findActiveAutomationRun(definitionId);
    this.activeReads += 1;
    if (this.activeReads === 2) this.releaseBoth();
    await this.bothReadsCompleted;
    return active;
  }
}

afterEach(async () => {
  for (const projectId of projectIds.splice(0).reverse()) {
    const definitions = await prisma.automationDefinition.findMany({
      where: { projectId },
      select: { id: true },
    });
    const definitionIds = definitions.map((definition) => definition.id);
    await prisma.automationRun.deleteMany({
      where: { definitionId: { in: definitionIds } },
    });
    await prisma.automationDefinition.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
  }
});

describe('OL-3 automation SKIP_IF_RUNNING concurrency', () => {
  it('allows at most one active run when different request keys start concurrently', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'Automation Concurrency Fixture',
        slug: `automation-concurrency-${Date.now()}`,
        primaryDomain: 'example.com',
      },
    });
    projectIds.push(project.id);

    const definition = await prisma.automationDefinition.create({
      data: {
        projectId: project.id,
        key: 'concurrent-search-refresh',
        actionType: 'SEARCH_REFRESH',
        actionConfig: {
          version: 'SEARCH_REFRESH_V1',
          bindingId: '44444444-4444-4444-8444-444444444444',
          lookbackDays: 7,
          lagDays: 1,
        },
        enabled: true,
        overlapPolicy: 'SKIP_IF_RUNNING',
        maxAttempts: 3,
        timeoutMs: 300_000,
      },
    });

    const repository = new CoordinatedAutomationRepository();
    const automationQueue = {
      enqueueRun: vi.fn().mockResolvedValue(undefined),
    };
    const service = new OptimizationOrchestrationService({
      repository,
      planningQueue: { enqueueRun: vi.fn().mockResolvedValue(undefined) },
      projects: {
        list: vi.fn().mockResolvedValue([]),
        findById: vi.fn().mockResolvedValue(null),
      },
      automationRuns: repository,
      automationQueue,
    });

    const [left, right] = await Promise.all([
      service.startAutomationRun({
        projectId: project.id,
        definitionId: definition.id,
        source: 'MANUAL',
        requestKey: 'concurrent-request-left',
      }),
      service.startAutomationRun({
        projectId: project.id,
        definitionId: definition.id,
        source: 'MANUAL',
        requestKey: 'concurrent-request-right',
      }),
    ]);

    expect([left.status, right.status].sort()).toEqual(['QUEUED', 'SKIPPED']);

    const activeRuns = await prisma.automationRun.findMany({
      where: {
        definitionId: definition.id,
        status: { in: ['QUEUED', 'RUNNING'] },
      },
    });
    expect(activeRuns).toHaveLength(1);

    const queued = [left, right].find((run) => run.status === 'QUEUED');
    const skipped = [left, right].find((run) => run.status === 'SKIPPED');
    expect(queued).toBeDefined();
    expect(skipped).toMatchObject({ blockedByRunId: queued!.id });
    expect(automationQueue.enqueueRun).toHaveBeenCalledTimes(1);
  });
});
