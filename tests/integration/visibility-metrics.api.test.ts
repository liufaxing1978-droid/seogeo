import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import {
  VisibilityMetricsQueue,
  type VisibilityMetricsQueuePort
} from '../../src/modules/visibility/visibility-metrics.queue.js';
import { VisibilitySubjectService } from '../../src/modules/visibility/visibility-subject.service.js';

class FakeMetricsQueuePort implements VisibilityMetricsQueuePort {
  readonly calls: Array<{
    name: string;
    data: Record<string, unknown>;
    options: { jobId: string; attempts: number };
  }> = [];

  async add(
    name: string,
    data: Record<string, unknown>,
    options: { jobId: string; attempts: number }
  ) {
    this.calls.push({ name, data, options });
    return { id: options.jobId };
  }
}

const WINDOW_START = '2026-08-01T00:00:00.000Z';
const WINDOW_END = '2026-08-08T00:00:00.000Z';
const EXTRACTOR_VERSION = 'VISIBILITY_EXTRACTION_V1';

function postBody(subjectSetHash: string) {
  return {
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    extractorVersion: EXTRACTOR_VERSION,
    subjectSetHash,
    scope: { providers: [], promptSetIds: [] }
  };
}

describe('P6-C visibility metrics REST API', () => {
  const projectIds: string[] = [];
  const subjectService = new VisibilitySubjectService();

  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.visibilityMetricRow.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilityMetricSnapshot.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilityExtraction.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilitySubjectAlias.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilitySubject.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.platformObservation.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilityRun.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilityPrompt.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilityPromptSet.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
  });

  async function createProject(planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE', label: string) {
    const suffix = `${label}-${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({
      data: {
        name: `Visibility Metrics ${label}`,
        slug: `visibility-metrics-${suffix}`,
        primaryDomain: `visibility-metrics-${suffix}.example.com`,
        planLevel
      }
    });
    projectIds.push(project.id);
    return project;
  }

  async function activeSubjectHash(projectId: string) {
    await subjectService.bootstrapOwnedDomain(projectId);
    return (await subjectService.buildActiveSnapshot(projectId)).subjectSetHash;
  }

  async function seedCompletedSnapshot(projectId: string, label: string, createdAt: Date) {
    return prisma.visibilityMetricSnapshot.create({
      data: {
        projectId,
        status: 'COMPLETED',
        formulaVersion: 'VISIBILITY_METRICS_V1',
        extractorVersion: EXTRACTOR_VERSION,
        subjectSetHash: label.repeat(64).slice(0, 64),
        subjectSnapshotJson: {
          subjects: [{ canonicalValue: `PRIVATE SUBJECT ${label}`, alias: `PRIVATE ALIAS ${label}` }],
          secretMarker: `PRIVATE SNAPSHOT ${label}`
        },
        windowStart: new Date(WINDOW_START),
        windowEnd: new Date(WINDOW_END),
        inputCutoffAt: new Date('2026-08-08T12:00:00.000Z'),
        scopeJson: { providers: [], promptSetIds: [], privateMarker: `PRIVATE SCOPE ${label}` },
        scopeHash: label.padEnd(64, '0').slice(0, 64),
        inputFingerprint: label.padEnd(64, 'f').slice(0, 64),
        candidateObservationCount: 10,
        completedExtractionCount: 9,
        missingExtractionCount: 1,
        failedExtractionCount: 0,
        completedAt: createdAt,
        createdAt
      }
    });
  }

  it('queues an Advanced project snapshot with deterministic safe provenance and server cutoff', async () => {
    const project = await createProject('ADVANCED', 'queue');
    const subjectSetHash = await activeSubjectHash(project.id);
    const port = new FakeMetricsQueuePort();
    const app = createApp({ visibilityMetricsQueue: new VisibilityMetricsQueue(port) });

    const response = await request(app)
      .post(`/api/v1/projects/${project.id}/visibility/metrics/snapshots`)
      .send(postBody(subjectSetHash))
      .expect(202);

    expect(response.body.data.jobId).toMatch(/^visibility-metrics-[a-f0-9]{64}$/);
    expect(response.body.data.snapshot).toMatchObject({
      projectId: project.id,
      status: 'QUEUED',
      formulaVersion: 'VISIBILITY_METRICS_V1',
      extractorVersion: EXTRACTOR_VERSION,
      subjectSetHash
    });
    expect(new Date(response.body.data.snapshot.inputCutoffAt).getTime()).toBeGreaterThan(
      new Date(WINDOW_END).getTime()
    );
    expect(response.body.data.snapshot).not.toHaveProperty('subjectSnapshotJson');
    expect(response.body.data.snapshot).not.toHaveProperty('scopeJson');

    expect(port.calls).toHaveLength(1);
    expect(port.calls[0]).toMatchObject({
      name: 'materialize-metric-snapshot',
      data: {
        projectId: project.id,
        snapshotId: response.body.data.snapshot.id,
        formulaVersion: 'VISIBILITY_METRICS_V1',
        extractorVersion: EXTRACTOR_VERSION,
        subjectSetHash
      },
      options: { attempts: 2 }
    });
  });

  it('rejects strict malformed/oversized requests before snapshot writes or queue calls', async () => {
    const project = await createProject('ADVANCED', 'validation');
    const subjectSetHash = await activeSubjectHash(project.id);
    const port = new FakeMetricsQueuePort();
    const app = createApp({ visibilityMetricsQueue: new VisibilityMetricsQueue(port) });

    await request(app)
      .post(`/api/v1/projects/${project.id}/visibility/metrics/snapshots`)
      .send({ ...postBody(subjectSetHash), unexpected: true })
      .expect(400);

    await request(app)
      .post(`/api/v1/projects/${project.id}/visibility/metrics/snapshots`)
      .send({
        ...postBody(subjectSetHash),
        windowStart: '2026-06-01T00:00:00.000Z',
        windowEnd: '2026-08-01T00:00:00.000Z'
      })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('VISIBILITY_METRICS_WINDOW_TOO_LARGE'));

    expect(port.calls).toHaveLength(0);
    expect(await prisma.visibilityMetricSnapshot.count({ where: { projectId: project.id } })).toBe(0);
  });

  it('gates Standard before writes and fails closed for foreign Prompt Sets and snapshots', async () => {
    const standard = await createProject('STANDARD', 'standard');
    const target = await createProject('ADVANCED', 'target');
    const owner = await createProject('ADVANCED', 'owner');
    const targetHash = await activeSubjectHash(target.id);
    const ownerPromptSet = await prisma.visibilityPromptSet.create({
      data: { projectId: owner.id, name: 'Foreign Prompt Set' }
    });
    const foreignSnapshot = await seedCompletedSnapshot(owner.id, 'a', new Date('2026-08-09T00:00:00.000Z'));
    const port = new FakeMetricsQueuePort();
    const app = createApp({ visibilityMetricsQueue: new VisibilityMetricsQueue(port) });

    await request(app)
      .post(`/api/v1/projects/${standard.id}/visibility/metrics/snapshots`)
      .send(postBody('b'.repeat(64)))
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('FEATURE_NOT_AVAILABLE'));

    await request(app)
      .post(`/api/v1/projects/${target.id}/visibility/metrics/snapshots`)
      .send({
        ...postBody(targetHash),
        scope: { providers: [], promptSetIds: [ownerPromptSet.id] }
      })
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('VISIBILITY_METRICS_PROMPT_SET_NOT_FOUND'));

    await request(app)
      .get(`/api/v1/projects/${target.id}/visibility/metrics/snapshots/${foreignSnapshot.id}`)
      .expect(404)
      .expect(({ body }) => expect(body.error.code).toBe('VISIBILITY_METRICS_SNAPSHOT_NOT_FOUND'));

    expect(port.calls).toHaveLength(0);
    expect(await prisma.visibilityMetricSnapshot.count({ where: { projectId: standard.id } })).toBe(0);
    expect(await prisma.visibilityMetricSnapshot.count({ where: { projectId: target.id } })).toBe(0);
  });

  it('returns bounded safe list/detail/latest payloads with explicit ratio semantics', async () => {
    const project = await createProject('ENTERPRISE', 'read');
    const older = await seedCompletedSnapshot(project.id, 'c', new Date('2026-08-09T00:00:00.000Z'));
    const latest = await seedCompletedSnapshot(project.id, 'd', new Date('2026-08-10T00:00:00.000Z'));

    await prisma.visibilityMetricRow.createMany({
      data: [
        {
          visibilityMetricSnapshotId: latest.id,
          projectId: project.id,
          metricType: 'MENTION_RATE',
          metricStatus: 'CALCULATED',
          dimensionType: 'OVERALL',
          dimensionKey: 'OVERALL',
          dimensionLabelSnapshot: null,
          actorType: 'OWNED_ROLLUP',
          actorSubjectId: null,
          actorKey: 'OWNED_ROLLUP',
          numerator: 0,
          denominator: 10,
          candidateObservationCount: 10,
          eligibleObservationCount: 10,
          notEligibleObservationCount: 0,
          unknownObservationCount: 0
        },
        {
          visibilityMetricSnapshotId: latest.id,
          projectId: project.id,
          metricType: 'CITATION_RATE',
          metricStatus: 'UNKNOWN',
          dimensionType: 'OVERALL',
          dimensionKey: 'OVERALL',
          dimensionLabelSnapshot: null,
          actorType: 'OWNED_ROLLUP',
          actorSubjectId: null,
          actorKey: 'OWNED_ROLLUP',
          numerator: 0,
          denominator: 0,
          candidateObservationCount: 10,
          eligibleObservationCount: 9,
          notEligibleObservationCount: 0,
          unknownObservationCount: 1
        },
        {
          visibilityMetricSnapshotId: latest.id,
          projectId: project.id,
          metricType: 'MENTION_SHARE_OF_VOICE',
          metricStatus: 'CALCULATED',
          dimensionType: 'PROVIDER',
          dimensionKey: 'OPENAI',
          dimensionLabelSnapshot: 'OPENAI',
          actorType: 'OWNED_ROLLUP',
          actorSubjectId: null,
          actorKey: 'OWNED_ROLLUP',
          numerator: 1,
          denominator: 4,
          candidateObservationCount: 10,
          eligibleObservationCount: 10,
          notEligibleObservationCount: 0,
          unknownObservationCount: 0
        }
      ]
    });

    const app = createApp({ visibilityMetricsQueue: new VisibilityMetricsQueue(new FakeMetricsQueuePort()) });

    const list = await request(app)
      .get(`/api/v1/projects/${project.id}/visibility/metrics/snapshots?limit=1000`)
      .expect(200);
    expect(list.body.meta.limit).toBe(100);
    expect(list.body.data.map((item: { id: string }) => item.id).slice(0, 2)).toEqual([latest.id, older.id]);

    const detail = await request(app)
      .get(`/api/v1/projects/${project.id}/visibility/metrics/snapshots/${latest.id}`)
      .expect(200);
    expect(detail.body.data.snapshot.id).toBe(latest.id);
    const mention = detail.body.data.rows.find((row: { metricType: string }) => row.metricType === 'MENTION_RATE');
    const citation = detail.body.data.rows.find((row: { metricType: string }) => row.metricType === 'CITATION_RATE');
    const sov = detail.body.data.rows.find((row: { metricType: string }) => row.metricType === 'MENTION_SHARE_OF_VOICE');
    expect(mention).toMatchObject({ dimensionType: 'OVERALL', dimensionKey: null, numerator: 0, denominator: 10, ratio: 0 });
    expect(citation).toMatchObject({ dimensionType: 'OVERALL', dimensionKey: null, ratio: null, unknownObservationCount: 1 });
    expect(sov.ratio).toBe(0.25);

    const latestResponse = await request(app)
      .get(`/api/v1/projects/${project.id}/visibility/metrics/latest`)
      .expect(200);
    expect(latestResponse.body.data.snapshot.id).toBe(latest.id);
    expect(latestResponse.body.data.rows.every((row: { visibilityMetricSnapshotId?: string }) =>
      row.visibilityMetricSnapshotId === undefined || row.visibilityMetricSnapshotId === latest.id
    )).toBe(true);

    for (const response of [list, detail, latestResponse]) {
      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toMatch(/PRIVATE SNAPSHOT|PRIVATE SUBJECT|PRIVATE ALIAS|PRIVATE SCOPE/);
      expect(serialized).not.toMatch(/subjectSnapshotJson|scopeJson|promptText|answerText|citationUrl|reasoning|secret/i);
    }
  });
});
