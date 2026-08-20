import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import {
  DashboardRepository,
  type DashboardVisibilityReader
} from '../../src/web/dashboard.repository.js';

const projectIds: string[] = [];
const ruleIds: string[] = [];

async function createProject(planLevel: 'STANDARD' | 'ADVANCED', label: string) {
  const suffix = `${label}-${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: `Dashboard ${label}`,
      slug: `dashboard-${suffix}`,
      primaryDomain: `dashboard-${suffix}.example.com`,
      planLevel
    }
  });
  projectIds.push(project.id);
  return project;
}

async function seedCoreFacts(projectId: string) {
  const crawl = await prisma.crawlRun.create({
    data: {
      projectId,
      runType: 'MANUAL',
      status: 'COMPLETED',
      seedUrl: 'https://example.com',
      crawlerVersion: 'dashboard-fixture-v1'
    }
  });
  const seoAudit = await prisma.seoAuditRun.create({
    data: {
      projectId,
      crawlRunId: crawl.id,
      status: 'COMPLETED',
      engineVersion: 'dashboard-seo-v1'
    }
  });
  await prisma.seoScore.create({
    data: {
      auditRunId: seoAudit.id,
      projectId,
      score: 88,
      engineVersion: 'dashboard-seo-v1'
    }
  });

  const geoAudit = await prisma.geoAuditRun.create({
    data: {
      projectId,
      crawlRunId: crawl.id,
      status: 'COMPLETED',
      engineVersion: 'dashboard-geo-v1'
    }
  });
  const geoScore = await prisma.geoScore.create({
    data: {
      geoAuditRunId: geoAudit.id,
      projectId,
      scoreType: 'GEO_READINESS_V1',
      score: 76,
      formulaVersion: 'GEO_READINESS_V1_NORMALIZED_AVAILABLE',
      engineVersion: 'dashboard-geo-v1'
    }
  });
  await prisma.geoScoreComponent.create({
    data: {
      geoScoreId: geoScore.id,
      componentCode: 'CITABILITY',
      componentName: 'Citability',
      rawScore: 72,
      weight: 30,
      weightedScore: 21.6,
      sourceType: 'CITABILITY_RESULTS'
    }
  });

  const rule = await prisma.seoRule.create({
    data: {
      ruleCode: `DASHBOARD_CRITICAL_${Date.now()}_${Math.random()}`,
      name: 'Dashboard critical fixture',
      category: 'TECHNICAL',
      description: 'fixture'
    }
  });
  ruleIds.push(rule.id);
  await prisma.seoIssue.create({
    data: {
      projectId,
      ruleId: rule.id,
      issueKey: 'dashboard-critical',
      title: 'Critical persisted issue',
      category: 'TECHNICAL',
      currentSeverity: 'CRITICAL',
      status: 'OPEN',
      firstSeenAt: new Date('2026-08-01T00:00:00.000Z'),
      lastSeenAt: new Date('2026-08-10T00:00:00.000Z')
    }
  });
}

async function seedVisibility(projectId: string) {
  const snapshot = await prisma.visibilityMetricSnapshot.create({
    data: {
      projectId,
      status: 'COMPLETED',
      formulaVersion: 'VISIBILITY_METRICS_V1',
      extractorVersion: 'P6B_EXTRACTION_V1',
      subjectSetHash: 'a'.repeat(64),
      subjectSnapshotJson: { private: 'DASHBOARD PRIVATE SUBJECT' },
      windowStart: new Date('2026-08-01T00:00:00.000Z'),
      windowEnd: new Date('2026-08-08T00:00:00.000Z'),
      inputCutoffAt: new Date('2026-08-08T12:00:00.000Z'),
      scopeJson: { private: 'DASHBOARD PRIVATE SCOPE' },
      scopeHash: 'b'.repeat(64),
      inputFingerprint: 'c'.repeat(64),
      candidateObservationCount: 10,
      completedExtractionCount: 10,
      missingExtractionCount: 0,
      failedExtractionCount: 0,
      completedAt: new Date('2026-08-09T00:00:00.000Z')
    }
  });
  const shared = {
    visibilityMetricSnapshotId: snapshot.id,
    projectId,
    candidateObservationCount: 10,
    eligibleObservationCount: 10,
    notEligibleObservationCount: 0,
    unknownObservationCount: 0,
    dimensionType: 'OVERALL' as const,
    dimensionKey: 'OVERALL',
    actorType: 'OWNED_ROLLUP' as const,
    actorKey: 'OWNED_ROLLUP'
  };
  await prisma.visibilityMetricRow.createMany({
    data: [
      { ...shared, metricType: 'MENTION_RATE', metricStatus: 'CALCULATED', numerator: 3, denominator: 10 },
      { ...shared, metricType: 'CITATION_RATE', metricStatus: 'UNKNOWN', numerator: 0, denominator: 0, unknownObservationCount: 1 },
      { ...shared, metricType: 'MENTION_SHARE_OF_VOICE', metricStatus: 'CALCULATED', numerator: 2, denominator: 5 }
    ]
  });
  return snapshot;
}

afterAll(async () => {
  for (const projectId of projectIds) {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
  for (const ruleId of ruleIds) {
    await prisma.seoRule.delete({ where: { id: ruleId } }).catch(() => undefined);
  }
});

describe('real dashboard repository', () => {
  it('loads persisted SEO/GEO/Citability/issues and one latest P6 snapshot without fabricating UNKNOWN as zero', async () => {
    const project = await createProject('ADVANCED', 'advanced');
    await seedCoreFacts(project.id);
    const snapshot = await seedVisibility(project.id);

    const model = await new DashboardRepository().getProjectFacts(project);

    expect(model.seoScore).toBe(88);
    expect(model.geoScore).toBe(76);
    expect(model.citability).toEqual({ status: 'CALCULATED', value: 72 });
    expect(model.criticalIssueCount).toBe(1);
    expect(model.visibility?.snapshotId).toBe(snapshot.id);
    expect(model.visibility?.mentionRate).toMatchObject({ status: 'CALCULATED', ratio: 0.3 });
    expect(model.visibility?.citationRate).toMatchObject({ status: 'UNKNOWN', ratio: null });
    expect(model.visibility?.ownedSov).toMatchObject({ status: 'CALCULATED', ratio: 0.4 });
    expect(model.visibility?.openAlertCount).toBe(0);
  });

  it('skips restricted P6 reads entirely for Standard projects', async () => {
    const project = await createProject('STANDARD', 'standard');
    let restrictedReads = 0;
    const visibilityReader: DashboardVisibilityReader = {
      async getLatest() {
        restrictedReads += 1;
        throw new Error('restricted P6 reader must not be called');
      }
    };

    const model = await new DashboardRepository({ visibilityReader }).getProjectFacts(project);

    expect(restrictedReads).toBe(0);
    expect(model.visibility).toBeNull();
  });

  it('returns bounded project-level portfolio facts without a cross-project visibility average', async () => {
    const repository = new DashboardRepository();
    const portfolio = await repository.getPortfolio({ limit: 50 });

    expect(portfolio.projects.length).toBeLessThanOrEqual(50);
    expect(portfolio).not.toHaveProperty('visibilityAverage');
    expect(portfolio).not.toHaveProperty('averageVisibility');
  });
});
