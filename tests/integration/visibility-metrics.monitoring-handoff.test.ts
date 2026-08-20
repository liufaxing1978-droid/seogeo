import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { VisibilityMetricsService } from '../../src/modules/visibility/visibility-metrics.service.js';
import { VisibilitySubjectService } from '../../src/modules/visibility/visibility-subject.service.js';

const NOW = new Date('2026-08-10T00:00:00.000Z');
const projectIds: string[] = [];

async function createFixture(name: string) {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name,
      slug: `p6d-monitoring-handoff-${suffix}`,
      primaryDomain: `p6d-monitoring-handoff-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);
  await prisma.visibilitySubject.create({
    data: {
      projectId: project.id,
      subjectType: 'OWNED_DOMAIN',
      canonicalValue: project.primaryDomain,
      normalizedValue: project.primaryDomain,
      sourceType: 'PRIMARY_DOMAIN'
    }
  });
  const subjectSnapshot = await new VisibilitySubjectService().buildActiveSnapshot(project.id);
  return { project, subjectSnapshot };
}

async function prepare(service: VisibilityMetricsService, fixture: Awaited<ReturnType<typeof createFixture>>) {
  return service.prepareSnapshot({
    projectId: fixture.project.id,
    windowStart: new Date('2026-08-01T00:00:00.000Z'),
    windowEnd: new Date('2026-08-08T00:00:00.000Z'),
    inputCutoffAt: new Date('2026-08-08T12:00:00.000Z'),
    extractorVersion: 'VISIBILITY_EXTRACTION_V1',
    subjectSetHash: fixture.subjectSnapshot.subjectSetHash,
    scope: { providers: [], promptSetIds: [] }
  });
}

describe('P6-C completion to P6-D monitoring handoff', () => {
  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.visibilityMetricComparison.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
  });

  it('enqueues monitoring only after the P6-C snapshot is durably COMPLETED', async () => {
    const fixture = await createFixture('P6-D Monitoring After Completion');
    const calls: Array<{ projectId: string; snapshotId: string; statusAtEnqueue: string }> = [];
    const monitoringQueue = {
      async enqueueSnapshot(projectId: string, snapshotId: string) {
        const snapshot = await prisma.visibilityMetricSnapshot.findFirstOrThrow({
          where: { id: snapshotId, projectId },
          select: { status: true }
        });
        calls.push({ projectId, snapshotId, statusAtEnqueue: snapshot.status });
      }
    };
    const service = new VisibilityMetricsService({ now: () => NOW, monitoringQueue });
    const shell = await prepare(service, fixture);

    const completed = await service.materializeSnapshot(fixture.project.id, shell.id);

    expect(completed.status).toBe('COMPLETED');
    expect(calls).toEqual([{
      projectId: fixture.project.id,
      snapshotId: shell.id,
      statusAtEnqueue: 'COMPLETED'
    }]);
  });

  it('keeps the valid P6-C snapshot COMPLETED when the P6-D monitoring queue insertion fails', async () => {
    const fixture = await createFixture('P6-D Monitoring Queue Failure');
    let attempts = 0;
    const service = new VisibilityMetricsService({
      now: () => NOW,
      monitoringQueue: {
        async enqueueSnapshot() {
          attempts += 1;
          throw new Error('fixture monitoring queue unavailable');
        }
      }
    });
    const shell = await prepare(service, fixture);

    await expect(service.materializeSnapshot(fixture.project.id, shell.id)).resolves.toMatchObject({
      id: shell.id,
      status: 'COMPLETED'
    });
    expect(attempts).toBe(1);
    expect(await prisma.visibilityMetricSnapshot.findFirstOrThrow({
      where: { id: shell.id, projectId: fixture.project.id },
      select: { status: true, errorCode: true }
    })).toEqual({ status: 'COMPLETED', errorCode: null });
  });
});
