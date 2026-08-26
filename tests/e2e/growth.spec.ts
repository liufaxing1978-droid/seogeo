import { PrismaClient, type Prisma } from '@prisma/client';
import { expect, test } from '@playwright/test';

const prisma = new PrismaClient();
let projectId = '';

async function createOpportunity(input: {
  query: string;
  page?: string | null;
  identityType: 'QUERY_PAGE_GROWTH' | 'KEYWORD_CANNIBALIZATION' | 'NEW_CONTENT_OPPORTUNITY';
  primaryType: 'RANKING_UPSIDE' | 'KEYWORD_CANNIBALIZATION' | 'NEW_CONTENT_OPPORTUNITY';
  score: number;
  sourceProvenance?: Prisma.InputJsonObject;
}) {
  const identity = await prisma.growthOpportunityIdentity.create({
    data: {
      projectId,
      opportunityKey: `${input.identityType}:${input.query}:${Math.random()}`,
      identityVersion: 'GROWTH_IDENTITY_V1',
      identityType: input.identityType,
      normalizedQuery: input.query,
      canonicalPage: input.page ?? null,
      identityPayload: { identityType: input.identityType }
    }
  });
  const snapshot = await prisma.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: identity.id,
      projectId,
      snapshotVersion: 'GROWTH_OPPORTUNITY_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      currentWindowStart: new Date('2026-07-21T00:00:00.000Z'),
      currentWindowEnd: new Date('2026-08-17T00:00:00.000Z'),
      previousWindowStart: new Date('2026-06-23T00:00:00.000Z'),
      previousWindowEnd: new Date('2026-07-20T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-08-17T23:59:59.000Z'),
      primaryType: input.primaryType,
      secondaryTypes: [],
      score: input.score,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 0.9,
      rankingEligible: true,
      sourceProvenance: input.sourceProvenance ?? {}
    }
  });
  await prisma.growthScoreBreakdown.create({
    data: {
      snapshotId: snapshot.id,
      demandState: 'KNOWN', demandScore: 90,
      positionPotentialState: 'KNOWN', positionPotentialScore: 85,
      ctrGapState: 'KNOWN', ctrGapScore: 60,
      siteGapState: 'KNOWN', siteGapScore: 70,
      gscTrendState: 'KNOWN', gscTrendScore: 50,
      p6VisibilityState: 'UNKNOWN', p6VisibilityScore: null,
      trendVisibilityDisplayState: 'KNOWN', trendVisibilityDisplayScore: 50,
      availableWeight: 90,
      evidenceCoverage: 0.9,
      weightedTotal: input.score,
      formulaVersion: 'GROWTH_SCORE_V1'
    }
  });
  await prisma.growthOpportunityEvidence.create({
    data: {
      snapshotId: snapshot.id,
      projectId,
      sourceModule: 'P5_CONTENT',
      sourceType: 'CONTENT_SIGNAL',
      sourceId: identity.id,
      sourceFactVersion: '1',
      ruleKey: 'CONTENT_TOPIC_COVERAGE',
      rootCauseKey: 'CONTENT_TOPIC_COVERAGE',
      evidenceState: 'FAIL',
      severity: 'HIGH',
      textSummary: '浏览器冒烟：内容覆盖不足。',
      fingerprint: `growth-e2e-${identity.id}`
    }
  });
  await prisma.growthOpportunityLifecycle.create({
    data: { opportunityIdentityId: identity.id, status: 'NEW', latestSnapshotId: snapshot.id }
  });
  return identity;
}

test.afterAll(async () => {
  if (projectId) {
    await prisma.growthOpportunityLifecycleEvent.deleteMany({ where: { identity: { projectId } } }).catch(() => undefined);
    await prisma.growthOpportunityLifecycle.deleteMany({ where: { identity: { projectId } } }).catch(() => undefined);
    await prisma.growthOpportunityEvidence.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.growthScoreBreakdown.deleteMany({ where: { snapshot: { projectId } } }).catch(() => undefined);
    await prisma.growthOpportunitySnapshot.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.growthTopicClusterSnapshot.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.growthTopicCluster.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.growthOpportunityIdentity.deleteMany({ where: { projectId } }).catch(() => undefined);
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
  await prisma.$disconnect();
});

test('navigates Search Console settings and all P7-A Growth Center views', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: 'P7-A Growth Browser Smoke',
      slug: `p7a-growth-browser-${suffix}`,
      primaryDomain: `p7a-growth-browser-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectId = project.id;

  const normal = await createOpportunity({
    query: '六壬历史',
    page: `https://${project.primaryDomain}/history`,
    identityType: 'QUERY_PAGE_GROWTH',
    primaryType: 'RANKING_UPSIDE',
    score: 82
  });
  await createOpportunity({
    query: '六壬祖师',
    identityType: 'KEYWORD_CANNIBALIZATION',
    primaryType: 'KEYWORD_CANNIBALIZATION',
    score: 78,
    sourceProvenance: {
      detector: {
        competingPages: [`https://${project.primaryDomain}/a`, `https://${project.primaryDomain}/b`],
        primaryPageCandidate: `https://${project.primaryDomain}/a`
      }
    }
  });
  await createOpportunity({
    query: '六壬历史资料',
    identityType: 'NEW_CONTENT_OPPORTUNITY',
    primaryType: 'NEW_CONTENT_OPPORTUNITY',
    score: 76,
    sourceProvenance: { detector: { reasonCodes: ['DEMAND_ELIGIBLE'] } }
  });

  const topic = await prisma.growthTopicCluster.create({
    data: {
      projectId,
      topicKey: '六壬文化',
      topicIdentityVersion: 'GROWTH_TOPIC_IDENTITY_V1',
      primaryQuery: '六壬文化'
    }
  });
  await prisma.growthTopicClusterSnapshot.create({
    data: {
      topicClusterId: topic.id,
      projectId,
      snapshotVersion: 'GROWTH_TOPIC_SNAPSHOT_V1',
      currentWindowStart: new Date('2026-07-21T00:00:00.000Z'),
      currentWindowEnd: new Date('2026-08-17T00:00:00.000Z'),
      previousWindowStart: new Date('2026-06-23T00:00:00.000Z'),
      previousWindowEnd: new Date('2026-07-20T00:00:00.000Z'),
      dataCutoffAt: new Date('2026-08-17T23:59:59.000Z'),
      memberQueries: ['六壬文化', '六壬历史'],
      memberPages: [`https://${project.primaryDomain}/history`],
      sourceProvenance: {},
      totalImpressions: 5000,
      totalClicks: 300,
      ctr: 0.06,
      position: 11.2,
      topOpportunityScore: 82,
      topicScore: 80,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 0.9,
      rankingEligible: true,
      trendVisibilityState: 'KNOWN'
    }
  });

  await page.goto(`/projects/${projectId}/search-console`);
  await expect(page.getByRole('heading', { level: 1, name: 'Google Search Console', exact: true })).toBeVisible();
  await expect(page.getByText('NOT_CONNECTED', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '优化运营', exact: true })).toHaveAttribute('aria-current', 'page');

  await page.goto(`/projects/${projectId}/growth`);
  await expect(page.getByRole('heading', { level: 1, name: 'Growth Opportunity Center', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '优化运营', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: '六壬历史', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Growth Opportunity', exact: true })).toBeVisible();
  expect(page.url()).toContain(normal.id);

  await page.goto(`/projects/${projectId}/growth/topics`);
  await expect(page.getByRole('heading', { level: 1, name: 'Topic Clusters', exact: true })).toBeVisible();

  await page.goto(`/projects/${projectId}/growth/cannibalization`);
  await expect(page.getByRole('heading', { level: 1, name: 'Keyword Cannibalization', exact: true })).toBeVisible();

  await page.goto(`/projects/${projectId}/growth/new-content`);
  await expect(page.getByRole('heading', { level: 1, name: 'New Content Opportunities', exact: true })).toBeVisible();
  await expect(page.getByText('建议评估新建专门内容页')).toBeVisible();
});