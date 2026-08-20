import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

const projectIds: string[] = [];

async function createProject(planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE', label: string) {
  const suffix = `${label}-${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: `P6-D ${label}`,
      slug: `p6d-api-${suffix}`,
      primaryDomain: `p6d-api-${suffix}.example.com`,
      planLevel
    }
  });
  projectIds.push(project.id);
  return project;
}

async function createSnapshot(projectId: string, start: string, end: string, label: string) {
  return prisma.visibilityMetricSnapshot.create({
    data: {
      projectId,
      status: 'COMPLETED',
      formulaVersion: 'VISIBILITY_METRICS_V1',
      extractorVersion: 'VISIBILITY_EXTRACTION_V1',
      subjectSetHash: `subject-${label}`,
      subjectSnapshotJson: { privateMarker: `PRIVATE SUBJECT ${label}` },
      windowStart: new Date(start),
      windowEnd: new Date(end),
      inputCutoffAt: new Date(end),
      scopeJson: { privateMarker: `PRIVATE SCOPE ${label}` },
      scopeHash: `scope-${label}`,
      inputFingerprint: `fingerprint-${label}`,
      candidateObservationCount: 10,
      completedExtractionCount: 8,
      missingExtractionCount: 1,
      failedExtractionCount: 1,
      completedAt: new Date(end),
      createdAt: new Date(end)
    }
  });
}

async function createOwnedRow(projectId: string, snapshotId: string, status: 'CALCULATED' | 'UNKNOWN', numerator: number, denominator: number) {
  return prisma.visibilityMetricRow.create({
    data: {
      visibilityMetricSnapshotId: snapshotId,
      projectId,
      metricType: 'MENTION_RATE',
      metricStatus: status,
      dimensionType: 'OVERALL',
      dimensionKey: 'OVERALL',
      actorType: 'OWNED_ROLLUP',
      actorKey: 'OWNED_ROLLUP',
      numerator,
      denominator,
      candidateObservationCount: 10,
      eligibleObservationCount: status === 'CALCULATED' ? 10 : 8,
      notEligibleObservationCount: 0,
      unknownObservationCount: status === 'UNKNOWN' ? 2 : 0
    }
  });
}

describe('P6-D history and alerts REST API', () => {
  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.visibilityAlertEvent.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilityAlertRule.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilityMetricComparison.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilityMetricRow.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.visibilityMetricSnapshot.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
  });

  it('gates Standard before restricted history reads', async () => {
    const project = await createProject('STANDARD', 'standard');
    const app = createApp();
    await request(app)
      .get(`/api/v1/projects/${project.id}/visibility/history/snapshots`)
      .expect(403)
      .expect(({ body }) => expect(body.error.code).toBe('FEATURE_NOT_AVAILABLE'));
  });

  it('returns bounded safe snapshot and series payloads and preserves UNKNOWN as null', async () => {
    const project = await createProject('ADVANCED', 'series');
    const first = await createSnapshot(project.id, '2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z', 'one');
    const second = await createSnapshot(project.id, '2026-07-08T00:00:00.000Z', '2026-07-15T00:00:00.000Z', 'two');
    await createOwnedRow(project.id, first.id, 'CALCULATED', 2, 10);
    await createOwnedRow(project.id, second.id, 'UNKNOWN', 0, 0);
    const app = createApp();

    const snapshots = await request(app)
      .get(`/api/v1/projects/${project.id}/visibility/history/snapshots?limit=1`)
      .expect(200);
    expect(snapshots.body.data).toHaveLength(1);
    expect(snapshots.body.data[0].evidenceCoverageRatio).toBe(0.8);
    expect(JSON.stringify(snapshots.body)).not.toContain('PRIVATE SUBJECT');
    expect(JSON.stringify(snapshots.body)).not.toContain('PRIVATE SCOPE');
    expect(snapshots.body.data[0]).not.toHaveProperty('subjectSnapshotJson');
    expect(snapshots.body.data[0]).not.toHaveProperty('scopeJson');

    const series = await request(app)
      .get(`/api/v1/projects/${project.id}/visibility/history/series`)
      .query({
        metricType: 'MENTION_RATE',
        dimensionType: 'OVERALL',
        dimensionKey: 'OVERALL',
        actorKey: 'OWNED_ROLLUP',
        limit: 30
      })
      .expect(200);
    expect(series.body.data).toHaveLength(2);
    const unknown = series.body.data.find((item: { metricStatus: string }) => item.metricStatus === 'UNKNOWN');
    const calculated = series.body.data.find((item: { metricStatus: string }) => item.metricStatus === 'CALCULATED');
    expect(unknown.ratio).toBeNull();
    expect(calculated.ratio).toBe(0.2);

    await request(app)
      .get(`/api/v1/projects/${project.id}/visibility/history/snapshots?limit=181`)
      .expect(400);
  });

  it('returns project-scoped comparison details with null nonnumeric deltas', async () => {
    const owner = await createProject('ENTERPRISE', 'comparison-owner');
    const foreign = await createProject('ADVANCED', 'comparison-foreign');
    const previous = await createSnapshot(owner.id, '2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z', 'cmp-prev');
    const current = await createSnapshot(owner.id, '2026-07-08T00:00:00.000Z', '2026-07-15T00:00:00.000Z', 'cmp-current');
    const comparison = await prisma.visibilityMetricComparison.create({
      data: {
        projectId: owner.id,
        comparisonVersion: 'VISIBILITY_COMPARISON_V1',
        currentSnapshotId: current.id,
        previousSnapshotId: previous.id,
        windowDurationMs: 604_800_000n,
        gapDurationMs: 0n
      }
    });
    await prisma.visibilityMetricDeltaRow.create({
      data: {
        visibilityMetricComparisonId: comparison.id,
        projectId: owner.id,
        metricType: 'MENTION_RATE',
        dimensionType: 'OVERALL',
        dimensionKey: 'OVERALL',
        actorType: 'OWNED_ROLLUP',
        actorKey: 'OWNED_ROLLUP',
        previousMetricStatus: 'CALCULATED',
        currentMetricStatus: 'UNKNOWN',
        previousNumerator: 2,
        previousDenominator: 10,
        currentNumerator: 0,
        currentDenominator: 0,
        deltaBasisPoints: null
      }
    });
    const app = createApp();

    const response = await request(app)
      .get(`/api/v1/projects/${owner.id}/visibility/history/comparisons/${comparison.id}`)
      .expect(200);
    expect(response.body.data.rows[0].deltaBasisPoints).toBeNull();
    expect(response.body.data.currentSnapshot.windowStart).toBeTruthy();
    expect(response.body.data.previousSnapshot.windowEnd).toBeTruthy();

    await request(app)
      .get(`/api/v1/projects/${foreign.id}/visibility/history/comparisons/${comparison.id}`)
      .expect(404);
  });

  it('creates, updates and acknowledges project-scoped alert records', async () => {
    const project = await createProject('ADVANCED', 'alerts');
    const previous = await createSnapshot(project.id, '2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z', 'alert-prev');
    const current = await createSnapshot(project.id, '2026-07-08T00:00:00.000Z', '2026-07-15T00:00:00.000Z', 'alert-current');
    const comparison = await prisma.visibilityMetricComparison.create({
      data: {
        projectId: project.id,
        comparisonVersion: 'VISIBILITY_COMPARISON_V1',
        currentSnapshotId: current.id,
        previousSnapshotId: previous.id,
        windowDurationMs: 604_800_000n,
        gapDurationMs: 0n
      }
    });
    const app = createApp();

    const created = await request(app)
      .post(`/api/v1/projects/${project.id}/visibility/history/alert-rules`)
      .send({
        ruleType: 'OWNED_MENTION_RATE_DROP',
        name: 'Mention drop',
        thresholdBasisPoints: 500,
        severity: 'WARNING'
      })
      .expect(201);

    await request(app)
      .patch(`/api/v1/projects/${project.id}/visibility/history/alert-rules/${created.body.data.id}`)
      .send({ severity: 'CRITICAL' })
      .expect(200)
      .expect(({ body }) => expect(body.data.severity).toBe('CRITICAL'));

    const event = await prisma.visibilityAlertEvent.create({
      data: {
        projectId: project.id,
        alertRuleId: created.body.data.id,
        comparisonId: comparison.id,
        actorKey: 'OWNED_ROLLUP',
        eventFingerprint: `api-${project.id}`,
        severity: 'CRITICAL',
        reasonCode: 'OWNED_MENTION_RATE_DROP',
        deltaBasisPoints: -600,
        previousMetricStatus: 'CALCULATED',
        currentMetricStatus: 'CALCULATED',
        triggeredAt: new Date('2026-07-15T00:00:00.000Z')
      }
    });

    await request(app)
      .post(`/api/v1/projects/${project.id}/visibility/history/alerts/${event.id}/acknowledge`)
      .send({})
      .expect(200)
      .expect(({ body }) => expect(body.data.status).toBe('ACKNOWLEDGED'));

    const inbox = await request(app)
      .get(`/api/v1/projects/${project.id}/visibility/history/alerts?status=ACKNOWLEDGED&limit=10`)
      .expect(200);
    expect(inbox.body.data).toHaveLength(1);
    expect(inbox.body.data[0].reasonCode).toBe('OWNED_MENTION_RATE_DROP');
  });
});
