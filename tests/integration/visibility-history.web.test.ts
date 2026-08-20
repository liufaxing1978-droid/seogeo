import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';

const projectIds: string[] = [];

async function project(planLevel: 'STANDARD' | 'ADVANCED', label: string) {
  const suffix = `${label}-${Date.now()}-${Math.random()}`;
  const value = await prisma.project.create({
    data: {
      name: `P6-D Web ${label}`,
      slug: `p6d-web-${suffix}`,
      primaryDomain: `p6d-web-${suffix}.example.com`,
      planLevel
    }
  });
  projectIds.push(value.id);
  return value;
}

async function snapshot(projectId: string, start: string, end: string) {
  return prisma.visibilityMetricSnapshot.create({
    data: {
      projectId,
      status: 'COMPLETED',
      formulaVersion: 'VISIBILITY_METRICS_V1',
      extractorVersion: 'VISIBILITY_EXTRACTION_V1',
      subjectSetHash: 'web-subject-set',
      subjectSnapshotJson: { privateMarker: 'PRIVATE SUBJECT SNAPSHOT' },
      windowStart: new Date(start),
      windowEnd: new Date(end),
      inputCutoffAt: new Date(end),
      scopeJson: { privateMarker: 'PRIVATE SCOPE JSON' },
      scopeHash: 'web-scope',
      inputFingerprint: `web-${start}`,
      candidateObservationCount: 10,
      completedExtractionCount: 8,
      missingExtractionCount: 2,
      failedExtractionCount: 0,
      completedAt: new Date(end)
    }
  });
}

async function metric(projectId: string, snapshotId: string, type: 'MENTION_RATE' | 'CITATION_RATE' | 'MENTION_SHARE_OF_VOICE', status: 'CALCULATED' | 'UNKNOWN', numerator: number, denominator: number) {
  return prisma.visibilityMetricRow.create({
    data: {
      visibilityMetricSnapshotId: snapshotId,
      projectId,
      metricType: type,
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

describe('P6-D history and alerts web UI', () => {
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

  it('renders deterministic history with UNKNOWN gaps and no private snapshot JSON', async () => {
    const p = await project('ADVANCED', 'history');
    const previous = await snapshot(p.id, '2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z');
    const current = await snapshot(p.id, '2026-07-08T00:00:00.000Z', '2026-07-15T00:00:00.000Z');
    await metric(p.id, previous.id, 'MENTION_RATE', 'CALCULATED', 2, 10);
    await metric(p.id, current.id, 'MENTION_RATE', 'UNKNOWN', 0, 0);
    await metric(p.id, current.id, 'CITATION_RATE', 'CALCULATED', 3, 10);
    await metric(p.id, current.id, 'MENTION_SHARE_OF_VOICE', 'CALCULATED', 4, 10);
    const before = await prisma.visibilityMetricSnapshot.count({ where: { projectId: p.id } });

    const response = await request(createApp()).get(`/projects/${p.id}/visibility/history`).expect(200);

    expect(response.text).toContain('Visibility 历史趋势');
    expect(response.text).toContain('UNKNOWN');
    expect(response.text).toContain('Evidence Coverage');
    expect(response.text).toContain('VISIBILITY_METRICS_V1');
    expect(response.text).toContain('尚无可比前序快照');
    expect(response.text).not.toContain('PRIVATE SUBJECT SNAPSHOT');
    expect(response.text).not.toContain('PRIVATE SCOPE JSON');
    expect(await prisma.visibilityMetricSnapshot.count({ where: { projectId: p.id } })).toBe(before);
  });

  it('renders alert lifecycle and acknowledge form without external delivery claims', async () => {
    const p = await project('ADVANCED', 'alerts');
    const previous = await snapshot(p.id, '2026-07-01T00:00:00.000Z', '2026-07-08T00:00:00.000Z');
    const current = await snapshot(p.id, '2026-07-08T00:00:00.000Z', '2026-07-15T00:00:00.000Z');
    const comparison = await prisma.visibilityMetricComparison.create({
      data: { projectId: p.id, comparisonVersion: 'VISIBILITY_COMPARISON_V1', currentSnapshotId: current.id, previousSnapshotId: previous.id, windowDurationMs: 604_800_000n, gapDurationMs: 0n }
    });
    const rule = await prisma.visibilityAlertRule.create({
      data: { projectId: p.id, ruleType: 'OWNED_MENTION_RATE_DROP', name: 'Owned mention drop', severity: 'WARNING', thresholdBasisPoints: 500 }
    });
    const event = await prisma.visibilityAlertEvent.create({
      data: { projectId: p.id, alertRuleId: rule.id, comparisonId: comparison.id, actorKey: 'OWNED_ROLLUP', eventFingerprint: `web-${p.id}`, severity: 'WARNING', reasonCode: 'OWNED_MENTION_RATE_DROP', deltaBasisPoints: -600, previousMetricStatus: 'CALCULATED', currentMetricStatus: 'CALCULATED', triggeredAt: new Date('2026-07-15T00:00:00.000Z') }
    });

    const response = await request(createApp()).get(`/projects/${p.id}/visibility/alerts`).expect(200);
    expect(response.text).toContain('Visibility 告警');
    expect(response.text).toContain('站内告警');
    expect(response.text).toContain('Owned mention drop');
    expect(response.text).toContain('-600 bp');
    expect(response.text).toContain(`/projects/${p.id}/visibility/alerts/${event.id}/acknowledge`);
    expect(response.text).not.toContain('邮件已发送');
  });

  it('blocks Standard history and alert pages before restricted rendering', async () => {
    const p = await project('STANDARD', 'standard');
    await request(createApp()).get(`/projects/${p.id}/visibility/history`).expect(403);
    await request(createApp()).get(`/projects/${p.id}/visibility/alerts`).expect(403);
  });
});
