import { afterAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import {
  emitVisibilityMetricsEvent,
  serializeVisibilityMetricsEvent
} from '../../src/modules/visibility/visibility-metrics.observability.js';
import {
  VisibilityMetricsQueue,
  type VisibilityMetricsQueuePort
} from '../../src/modules/visibility/visibility-metrics.queue.js';
import { VisibilityMetricsService } from '../../src/modules/visibility/visibility-metrics.service.js';
import { processVisibilityMetricsJob } from '../../src/modules/visibility/visibility-metrics.worker.js';
import { VisibilitySubjectService } from '../../src/modules/visibility/visibility-subject.service.js';

class SuccessfulQueuePort implements VisibilityMetricsQueuePort {
  async add(
    _name: string,
    _data: Record<string, unknown>,
    options: { jobId: string; attempts: number }
  ) {
    return { id: options.jobId };
  }
}

class FailingQueuePort implements VisibilityMetricsQueuePort {
  async add(
    _name: string,
    _data: Record<string, unknown>,
    _options: { jobId: string; attempts: number }
  ): Promise<{ id?: string | null }> {
    throw new Error('queue unavailable');
  }
}

const JOB = {
  projectId: '11111111-1111-4111-8111-111111111111',
  snapshotId: '22222222-2222-4222-8222-222222222222',
  formulaVersion: 'VISIBILITY_METRICS_V1',
  extractorVersion: 'P6B_EXTRACTION_V1',
  subjectSetHash: 'a'.repeat(64),
  windowStart: '2026-08-01T00:00:00.000Z',
  windowEnd: '2026-08-08T00:00:00.000Z',
  inputCutoffAt: '2026-08-08T12:00:00.000Z',
  scopeHash: 'b'.repeat(64)
};

function jobSnapshot() {
  return {
    id: JOB.snapshotId,
    projectId: JOB.projectId,
    status: 'QUEUED',
    formulaVersion: JOB.formulaVersion,
    extractorVersion: JOB.extractorVersion,
    subjectSetHash: JOB.subjectSetHash,
    subjectSnapshotJson: {},
    windowStart: new Date(JOB.windowStart),
    windowEnd: new Date(JOB.windowEnd),
    inputCutoffAt: new Date(JOB.inputCutoffAt),
    scopeJson: { providers: [], promptSetIds: [] },
    scopeHash: JOB.scopeHash,
    inputFingerprint: null,
    candidateObservationCount: 0,
    completedExtractionCount: 0,
    missingExtractionCount: 0,
    failedExtractionCount: 0,
    errorCode: null,
    startedAt: null,
    completedAt: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
}

describe('P6-C visibility metrics observability', () => {
  const projectIds: string[] = [];

  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.visibilityMetricRow.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilityMetricSnapshot.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilitySubjectAlias.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilitySubject.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
  });

  it('serializes only safe lifecycle provenance/count fields', () => {
    const serialized = serializeVisibilityMetricsEvent('visibility.metrics.completed', {
      projectId: 'project-id',
      snapshotId: 'snapshot-id',
      formulaVersion: 'VISIBILITY_METRICS_V1',
      extractorVersion: 'P6B_EXTRACTION_V1',
      subjectSetHash: 'subject-hash',
      scopeHash: 'scope-hash',
      status: 'COMPLETED',
      candidateCount: 10,
      eligibleCount: 7,
      unknownCount: 2,
      notEligibleCount: 1,
      errorCode: null,
      durationMs: 42,
      promptText: 'SECRET PROMPT',
      answerText: 'SECRET ANSWER',
      alias: 'SECRET ALIAS',
      canonicalValue: 'SECRET SUBJECT',
      citationUrl: 'https://secret.example/private',
      providerBody: { secret: true },
      apiKey: 'sk-secret',
      cookie: 'session=secret',
      reasoning: 'SECRET REASONING',
      subjectSnapshotJson: { secret: 'PRIVATE SNAPSHOT' },
      rows: [{ secret: 'PRIVATE ROW' }]
    });

    expect(serialized).toEqual({
      event: 'visibility.metrics.completed',
      projectId: 'project-id',
      snapshotId: 'snapshot-id',
      formulaVersion: 'VISIBILITY_METRICS_V1',
      extractorVersion: 'P6B_EXTRACTION_V1',
      subjectSetHash: 'subject-hash',
      scopeHash: 'scope-hash',
      status: 'COMPLETED',
      candidateCount: 10,
      eligibleCount: 7,
      unknownCount: 2,
      notEligibleCount: 1,
      errorCode: null,
      durationMs: 42
    });
    expect(JSON.stringify(serialized)).not.toMatch(
      /SECRET|PRIVATE|promptText|answerText|alias|canonicalValue|citationUrl|providerBody|apiKey|cookie|reasoning|subjectSnapshotJson|rows/
    );
  });

  it('emits only serialized safe fields', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    emitVisibilityMetricsEvent('visibility.metrics.failed', {
      projectId: 'project-id',
      snapshotId: 'snapshot-id',
      errorCode: 'VISIBILITY_METRICS_SCOPE_INVALID',
      durationMs: 9,
      answerText: 'PRIVATE ANSWER'
    });
    expect(info).toHaveBeenCalledWith({
      event: 'visibility.metrics.failed',
      projectId: 'project-id',
      snapshotId: 'snapshot-id',
      errorCode: 'VISIBILITY_METRICS_SCOPE_INVALID',
      durationMs: 9
    });
    info.mockRestore();
  });

  it('emits queued only after a successful queue add', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const successful = new VisibilityMetricsQueue(new SuccessfulQueuePort());
    await successful.enqueueSnapshot(JOB);
    expect(info).toHaveBeenCalledWith(expect.objectContaining({
      event: 'visibility.metrics.queued',
      projectId: JOB.projectId,
      snapshotId: JOB.snapshotId,
      formulaVersion: JOB.formulaVersion,
      extractorVersion: JOB.extractorVersion,
      subjectSetHash: JOB.subjectSetHash,
      scopeHash: JOB.scopeHash,
      status: 'QUEUED'
    }));

    info.mockClear();
    const failing = new VisibilityMetricsQueue(new FailingQueuePort());
    await expect(failing.enqueueSnapshot(JOB)).rejects.toThrow('queue unavailable');
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it('emits started only after a valid same-project job identity is accepted', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const materializeSnapshot = vi.fn(async () => jobSnapshot());

    await processVisibilityMetricsJob(
      { name: 'materialize-metric-snapshot', data: JOB },
      {
        repository: { get: vi.fn(async () => jobSnapshot() as never) },
        metricsService: { materializeSnapshot: materializeSnapshot as never }
      }
    );
    expect(info).toHaveBeenCalledWith(expect.objectContaining({
      event: 'visibility.metrics.started',
      projectId: JOB.projectId,
      snapshotId: JOB.snapshotId,
      formulaVersion: JOB.formulaVersion,
      extractorVersion: JOB.extractorVersion,
      subjectSetHash: JOB.subjectSetHash,
      scopeHash: JOB.scopeHash,
      status: 'RUNNING'
    }));

    info.mockClear();
    await expect(processVisibilityMetricsJob(
      { name: 'materialize-metric-snapshot', data: { ...JOB, scopeHash: 'c'.repeat(64) } },
      {
        repository: { get: vi.fn(async () => jobSnapshot() as never) },
        metricsService: { materializeSnapshot: materializeSnapshot as never }
      }
    )).rejects.toMatchObject({ code: 'VISIBILITY_METRICS_SNAPSHOT_NOT_FOUND' });
    expect(info).not.toHaveBeenCalled();
    info.mockRestore();
  });

  it('emits completed and failed service lifecycle events without metric row/private bodies', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: 'Metrics observability',
        slug: `metrics-observability-${suffix}`,
        primaryDomain: `metrics-observability-${suffix}.example.com`,
        planLevel: 'ADVANCED'
      }
    });
    projectIds.push(project.id);
    const subjects = new VisibilitySubjectService();
    await subjects.bootstrapOwnedDomain(project.id);
    const contract = await subjects.buildActiveSnapshot(project.id);
    const service = new VisibilityMetricsService();
    const now = new Date();

    const completedShell = await service.prepareSnapshot({
      projectId: project.id,
      windowStart: new Date(now.getTime() - 2 * 60 * 60 * 1000),
      windowEnd: new Date(now.getTime() - 60 * 60 * 1000),
      inputCutoffAt: now,
      extractorVersion: 'P6B_EXTRACTION_V1',
      subjectSetHash: contract.subjectSetHash,
      scope: { providers: [], promptSetIds: [] }
    });

    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const completed = await service.materializeSnapshot(project.id, completedShell.id);
    expect(completed.status).toBe('COMPLETED');
    expect(info).toHaveBeenCalledWith(expect.objectContaining({
      event: 'visibility.metrics.completed',
      projectId: project.id,
      snapshotId: completed.id,
      formulaVersion: 'VISIBILITY_METRICS_V1',
      extractorVersion: 'P6B_EXTRACTION_V1',
      subjectSetHash: contract.subjectSetHash,
      status: 'COMPLETED',
      candidateCount: 0,
      durationMs: expect.any(Number)
    }));

    const failedShell = await prisma.visibilityMetricSnapshot.create({
      data: {
        projectId: project.id,
        status: 'QUEUED',
        formulaVersion: 'VISIBILITY_METRICS_V1',
        extractorVersion: 'P6B_EXTRACTION_V1',
        subjectSetHash: contract.subjectSetHash,
        subjectSnapshotJson: { subjects: [], ambiguousAliases: [] },
        windowStart: new Date(now.getTime() - 4 * 60 * 60 * 1000),
        windowEnd: new Date(now.getTime() - 3 * 60 * 60 * 1000),
        inputCutoffAt: now,
        scopeJson: { providers: ['INVALID_PROVIDER'], promptSetIds: [] },
        scopeHash: 'f'.repeat(64)
      }
    });

    info.mockClear();
    await expect(service.materializeSnapshot(project.id, failedShell.id)).rejects.toMatchObject({
      code: 'VISIBILITY_METRICS_SCOPE_INVALID'
    });
    expect(info).toHaveBeenCalledWith(expect.objectContaining({
      event: 'visibility.metrics.failed',
      projectId: project.id,
      snapshotId: failedShell.id,
      formulaVersion: 'VISIBILITY_METRICS_V1',
      extractorVersion: 'P6B_EXTRACTION_V1',
      subjectSetHash: contract.subjectSetHash,
      scopeHash: 'f'.repeat(64),
      status: 'FAILED',
      errorCode: 'VISIBILITY_METRICS_SCOPE_INVALID',
      durationMs: expect.any(Number)
    }));

    const serializedCalls = info.mock.calls.map(([payload]) => JSON.stringify(payload)).join('\n');
    expect(serializedCalls).not.toMatch(/subjectSnapshotJson|canonicalValue|alias|rows|promptText|answerText|citationUrl|reasoning/i);
    info.mockRestore();
  });
});
