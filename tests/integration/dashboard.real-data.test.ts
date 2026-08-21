import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import {
  DashboardRepository,
  type DashboardVisibilityReader
} from '../../src/web/dashboard.repository.js';
import { seedGrowthDashboardFacts } from '../helpers/growth-dashboard-fixture.js';

const projectIds: string[] = [];
const ruleIds: string[] = [];

async function createProject(planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE', label: string) {
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

  it('derives an Advanced project Growth summary only from persisted P7-A and GSC facts', async () => {
    const project = await createProject('ADVANCED', 'growth-advanced');
    await seedGrowthDashboardFacts(project.id, { includeEligible: true, includeAdvancedTypes: true, resolvedCount: 1 });

    const model = await new DashboardRepository().getProjectFacts(project);

    expect(model).toMatchObject({
      growth: {
        state: 'AVAILABLE',
        surface: 'FULL',
        topEligibleScore: 91,
        criticalCount: 1,
        highCount: 2,
        resolvedCount: 1,
        topDeclining: { normalizedQuery: 'declining opportunity', score: 91 },
        topRankingUpside: { normalizedQuery: 'ranking opportunity', score: 84 },
        topCannibalizationRisk: { normalizedQuery: 'cannibal opportunity', score: 88 },
        searchTrend: {
          current: { impressions: 200, clicks: 20 },
          previous: { impressions: 100, clicks: 10 },
          impressionChangePct: 100,
          clickChangePct: 100
        },
        gsc: {
          connectionStatus: 'CONNECTED',
          propertyUri: 'sc-domain:example.com',
          latestCompletedDate: '2026-08-01',
          sourceCompletenessState: 'TOP_ROWS_ONLY'
        }
      }
    });
    expect(JSON.stringify((model as any).growth)).not.toContain('SHOULD_NOT_RENDER');
    expect(JSON.stringify((model as any).growth)).not.toContain('fixture-ciphertext');
  });

  it('keeps Standard Growth summary on the bounded basic opportunity surface', async () => {
    const project = await createProject('STANDARD', 'growth-standard');
    await seedGrowthDashboardFacts(project.id, { includeEligible: true, includeAdvancedTypes: true, resolvedCount: 1 });

    const model = await new DashboardRepository().getProjectFacts(project);

    expect(model).toMatchObject({
      growth: {
        state: 'AVAILABLE',
        surface: 'BASIC',
        topEligibleScore: 84,
        criticalCount: 0,
        highCount: 1,
        topRankingUpside: { normalizedQuery: 'ranking opportunity', score: 84 },
        topDeclining: null,
        topCannibalizationRisk: null
      }
    });
  });

  it('renders explicit Growth NO_DATA semantics when the latest window has no ranking-eligible snapshot', async () => {
    const project = await createProject('ADVANCED', 'growth-no-data');
    await seedGrowthDashboardFacts(project.id, { includeEligible: false, includeAdvancedTypes: false, resolvedCount: 0 });

    const model = await new DashboardRepository().getProjectFacts(project);

    expect(model).toMatchObject({
      growth: {
        state: 'NO_DATA',
        topEligibleScore: null,
        criticalCount: 0,
        highCount: 0
      }
    });
  });

  it('builds an Enterprise-only bounded Growth portfolio ordered by critical risk then top eligible score', async () => {
    const enterpriseA = await createProject('ENTERPRISE', 'enterprise-growth-a');
    const enterpriseB = await createProject('ENTERPRISE', 'enterprise-growth-b');
    const advanced = await createProject('ADVANCED', 'advanced-not-portfolio-growth');
    await seedGrowthDashboardFacts(enterpriseA.id, { includeEligible: true, includeAdvancedTypes: true, resolvedCount: 2 });
    await seedGrowthDashboardFacts(enterpriseB.id, { includeEligible: true, includeAdvancedTypes: false, resolvedCount: 1 });
    await seedGrowthDashboardFacts(advanced.id, { includeEligible: true, includeAdvancedTypes: true, resolvedCount: 3 });

    const portfolio = await new DashboardRepository().getPortfolio({ limit: 50 });
    const enterpriseGrowth = (portfolio as any).enterpriseGrowthProjects;

    expect(enterpriseGrowth).toHaveLength(2);
    expect(enterpriseGrowth.map((row: any) => row.projectId)).toEqual([enterpriseA.id, enterpriseB.id]);
    expect(enterpriseGrowth[0]).toMatchObject({
      topEligibleScore: 91,
      criticalCount: 1,
      resolvedCount: 2,
      connectionStatus: 'CONNECTED'
    });
    expect(enterpriseGrowth.some((row: any) => row.projectId === advanced.id)).toBe(false);
  });
});
