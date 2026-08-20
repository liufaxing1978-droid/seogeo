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

  async add(name: string, data: Record<string, unknown>, options: { jobId: string; attempts: number }) {
    this.calls.push({ name, data, options });
    return { id: options.jobId };
  }
}

describe('P6-C metrics and SOV web UI', () => {
  const projectIds: string[] = [];
  const subjectService = new VisibilitySubjectService();

  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.visibilityMetricRow.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilityMetricSnapshot.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.citationObservation.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.mentionObservation.deleteMany({ where: { projectId } }).catch(() => undefined);
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
        name: `Metrics UI ${label}`,
        slug: `metrics-ui-${suffix}`,
        primaryDomain: `metrics-ui-${suffix}.example.com`,
        planLevel
      }
    });
    projectIds.push(project.id);
    return project;
  }

  async function createSnapshot(projectId: string, subjectSetHash: string, createdAt = new Date()) {
    return prisma.visibilityMetricSnapshot.create({
      data: {
        projectId,
        status: 'COMPLETED',
        formulaVersion: 'VISIBILITY_METRICS_V1',
        extractorVersion: 'P6B_EXTRACTION_V1',
        subjectSetHash,
        subjectSnapshotJson: { private: 'PRIVATE SUBJECT SNAPSHOT MUST NOT RENDER' },
        windowStart: new Date('2026-08-01T00:00:00.000Z'),
        windowEnd: new Date('2026-08-08T00:00:00.000Z'),
        inputCutoffAt: new Date('2026-08-08T12:00:00.000Z'),
        scopeJson: { providers: [], promptSetIds: [], private: 'PRIVATE SCOPE MUST NOT RENDER' },
        scopeHash: '1'.repeat(64),
        inputFingerprint: '2'.repeat(64),
        candidateObservationCount: 10,
        completedExtractionCount: 9,
        missingExtractionCount: 1,
        failedExtractionCount: 0,
        completedAt: createdAt,
        createdAt
      }
    });
  }

  async function seedMetricRows(projectId: string, snapshotId: string) {
    const shared = {
      visibilityMetricSnapshotId: snapshotId,
      projectId,
      candidateObservationCount: 10,
      notEligibleObservationCount: 0
    } as const;

    await prisma.visibilityMetricRow.createMany({
      data: [
        {
          ...shared,
          metricType: 'MENTION_RATE', metricStatus: 'CALCULATED', dimensionType: 'OVERALL',
          dimensionKey: 'OVERALL', dimensionLabelSnapshot: null, actorType: 'OWNED_ROLLUP',
          actorSubjectId: null, actorKey: 'OWNED_ROLLUP', numerator: 0, denominator: 10,
          eligibleObservationCount: 10, unknownObservationCount: 0
        },
        {
          ...shared,
          metricType: 'CITATION_RATE', metricStatus: 'UNKNOWN', dimensionType: 'OVERALL',
          dimensionKey: 'OVERALL', dimensionLabelSnapshot: null, actorType: 'OWNED_ROLLUP',
          actorSubjectId: null, actorKey: 'OWNED_ROLLUP', numerator: 0, denominator: 0,
          eligibleObservationCount: 9, unknownObservationCount: 1
        },
        {
          ...shared,
          metricType: 'MENTION_SHARE_OF_VOICE', metricStatus: 'CALCULATED', dimensionType: 'OVERALL',
          dimensionKey: 'OVERALL', dimensionLabelSnapshot: null, actorType: 'OWNED_ROLLUP',
          actorSubjectId: null, actorKey: 'OWNED_ROLLUP', numerator: 2, denominator: 5,
          eligibleObservationCount: 10, unknownObservationCount: 0
        },
        {
          ...shared,
          metricType: 'MENTION_SHARE_OF_VOICE', metricStatus: 'CALCULATED', dimensionType: 'OVERALL',
          dimensionKey: 'OVERALL', dimensionLabelSnapshot: null, actorType: 'COMPETITOR',
          actorSubjectId: null, actorKey: 'COMPETITOR:fixture', numerator: 3, denominator: 5,
          eligibleObservationCount: 10, unknownObservationCount: 0
        },
        {
          ...shared,
          metricType: 'MENTION_RATE', metricStatus: 'CALCULATED', dimensionType: 'PROVIDER',
          dimensionKey: 'OPENAI', dimensionLabelSnapshot: 'OPENAI', actorType: 'OWNED_ROLLUP',
          actorSubjectId: null, actorKey: 'OWNED_ROLLUP', numerator: 1, denominator: 4,
          eligibleObservationCount: 4, unknownObservationCount: 0
        },
        {
          ...shared,
          metricType: 'MENTION_SHARE_OF_VOICE', metricStatus: 'NO_SIGNAL', dimensionType: 'PROMPT_SET',
          dimensionKey: '11111111-1111-4111-8111-111111111111', dimensionLabelSnapshot: 'Discovery Set',
          actorType: 'OWNED_ROLLUP', actorSubjectId: null, actorKey: 'OWNED_ROLLUP',
          numerator: 0, denominator: 0, eligibleObservationCount: 2, unknownObservationCount: 0
        }
      ]
    });
  }

  it('renders owned rates/SOV, coverage, competitor/provider/prompt breakdowns and provenance safely', async () => {
    const project = await createProject('ADVANCED', 'render');
    const snapshot = await createSnapshot(project.id, 'a'.repeat(64));
    await seedMetricRows(project.id, snapshot.id);
    const app = createApp({ visibilityMetricsQueue: new VisibilityMetricsQueue(new FakeMetricsQueuePort()) });

    const response = await request(app)
      .get(`/projects/${project.id}/visibility/metrics?snapshotId=${snapshot.id}`)
      .expect(200);

    expect(response.text).toContain('Visibility 指标');
    expect(response.text).toContain('Owned Mention Rate');
    expect(response.text).toContain('Owned Citation Rate');
    expect(response.text).toContain('Owned Mention SOV');
    expect(response.text).toContain('0.0%');
    expect(response.text).toContain('UNKNOWN');
    expect(response.text).toContain('40.0%');
    expect(response.text).toContain('COMPETITOR:fixture');
    expect(response.text).toContain('60.0%');
    expect(response.text).toContain('OPENAI');
    expect(response.text).toContain('Discovery Set');
    expect(response.text).toContain('NO_SIGNAL');
    expect(response.text).toContain('VISIBILITY_METRICS_V1');
    expect(response.text).toContain('P6B_EXTRACTION_V1');
    expect(response.text).toContain('aaaaaaaaaaaa');
    expect(response.text).toContain('候选 observations');
    expect(response.text).toContain('缺失 extraction');
    expect(response.text).not.toContain('PRIVATE SUBJECT SNAPSHOT MUST NOT RENDER');
    expect(response.text).not.toContain('PRIVATE SCOPE MUST NOT RENDER');
    const mainMatch = response.text.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
    expect(mainMatch).not.toBeNull();
    expect(mainMatch?.[1] ?? '').not.toMatch(/趋势|趋势线|delta|alert|告警|历史曲线|AI narrative/i);
  });

  it('gates Standard before restricted metric reads', async () => {
    const standard = await createProject('STANDARD', 'standard');
    const snapshot = await createSnapshot(standard.id, 'b'.repeat(64));
    await seedMetricRows(standard.id, snapshot.id);
    const app = createApp();

    await request(app)
      .get(`/projects/${standard.id}/visibility/metrics`)
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('FEATURE_NOT_AVAILABLE'));
  });

  it('generates an unfiltered snapshot from a safe recent extractor/hash contract and redirects to it', async () => {
    const project = await createProject('ADVANCED', 'generate');
    await subjectService.bootstrapOwnedDomain(project.id);
    const contract = await subjectService.buildActiveSnapshot(project.id);
    const port = new FakeMetricsQueuePort();
    const app = createApp({ visibilityMetricsQueue: new VisibilityMetricsQueue(port) });

    const response = await request(app)
      .post(`/projects/${project.id}/visibility/metrics/snapshots`)
      .type('form')
      .send({
        windowStart: '2026-08-01T00:00:00.000Z',
        windowEnd: '2026-08-08T00:00:00.000Z',
        extractorVersion: 'P6B_EXTRACTION_V1',
        subjectSetHash: contract.subjectSetHash
      })
      .expect(303);

    const snapshot = await prisma.visibilityMetricSnapshot.findFirstOrThrow({
      where: { projectId: project.id },
      orderBy: { createdAt: 'desc' }
    });
    expect(response.headers.location).toBe(`/projects/${project.id}/visibility/metrics?snapshotId=${snapshot.id}`);
    expect(snapshot.scopeJson).toEqual({ providers: [], promptSetIds: [] });
    expect(port.calls).toHaveLength(1);
    expect(port.calls[0]).toMatchObject({
      name: 'materialize-metric-snapshot',
      data: { projectId: project.id, snapshotId: snapshot.id },
      options: { attempts: 2 }
    });
  });

  it('shows an empty state and generation form without exposing private extraction content', async () => {
    const project = await createProject('ENTERPRISE', 'empty');
    const app = createApp();
    const response = await request(app)
      .get(`/projects/${project.id}/visibility/metrics`)
      .expect(200);

    expect(response.text).toContain('尚无 Visibility 指标快照');
    expect(response.text).toContain('生成指标快照');
    expect(response.text).not.toMatch(/promptText|answerText|citationUrl|reasoning/i);
  });
});
