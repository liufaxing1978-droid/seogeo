import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/db/prisma.js';
import { GrowthRepository } from '../../src/modules/growth/growth.repository.js';

const repository = new GrowthRepository();
const projectIds: string[] = [];

async function createProject(
  label: string,
  planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE'
) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P7-A Growth API ${label}`,
      slug: `p7a-growth-api-${suffix}`,
      primaryDomain: `p7a-growth-api-${suffix}.example.com`,
      planLevel
    }
  });
  projectIds.push(project.id);
  return project;
}

async function seedOpportunity(input: {
  projectId: string;
  query: string;
  page: string;
  primaryType?: 'RANKING_UPSIDE' | 'CTR_UNDERPERFORMANCE' | 'SEO_GAP';
  score?: number;
  priority?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'MONITOR';
}) {
  const identity = await repository.getOrCreateOpportunityIdentity({
    projectId: input.projectId,
    identityType: 'QUERY_PAGE_GROWTH',
    normalizedQuery: input.query,
    canonicalPage: input.page
  });
  const score = input.score ?? 80;
  const snapshot = await repository.createOpportunitySnapshot({
    opportunityIdentityId: identity.id,
    projectId: input.projectId,
    snapshotVersion: 'GROWTH_OPPORTUNITY_V1',
    formulaVersion: 'GROWTH_SCORE_V1',
    currentWindowStart: new Date('2026-07-21T00:00:00.000Z'),
    currentWindowEnd: new Date('2026-08-17T00:00:00.000Z'),
    previousWindowStart: new Date('2026-06-23T00:00:00.000Z'),
    previousWindowEnd: new Date('2026-07-20T00:00:00.000Z'),
    dataCutoffAt: new Date('2026-08-17T00:00:00.000Z'),
    primaryType: input.primaryType ?? 'RANKING_UPSIDE',
    secondaryTypes: [],
    score,
    priority: input.priority ?? 'HIGH',
    scoreState: 'KNOWN',
    evidenceQuality: 'COMPLETE',
    evidenceCoverage: 1,
    rankingEligible: true,
    sourceProvenance: { gscSnapshotIds: ['fixture-gsc'] },
    breakdown: {
      demandState: 'KNOWN',
      demandScore: 85,
      positionPotentialState: 'KNOWN',
      positionPotentialScore: 100,
      ctrGapState: 'KNOWN',
      ctrGapScore: 60,
      siteGapState: 'KNOWN',
      siteGapScore: 30,
      gscTrendState: 'KNOWN',
      gscTrendScore: 20,
      p6VisibilityState: 'KNOWN',
      p6VisibilityScore: 25,
      trendVisibilityDisplayState: 'KNOWN',
      trendVisibilityDisplayScore: 22,
      availableWeight: 100,
      evidenceCoverage: 1,
      weightedTotal: score,
      formulaVersion: 'GROWTH_SCORE_V1'
    },
    evidence: [{
      sourceModule: 'GSC',
      sourceType: 'QUERY_PAGE_WINDOW',
      sourceId: `${input.query}:${input.page}`,
      sourceFactVersion: 'GSC_QUERY_PAGE_V1',
      ruleKey: 'gsc-performance',
      rootCauseKey: 'gsc-performance',
      evidenceState: 'FAIL',
      severity: 'MEDIUM',
      numericValue: score,
      textSummary: 'Persisted fixture evidence',
      fingerprint: `gsc:${identity.id}:2026-08-17`
    }]
  });
  await repository.ensureLifecycle(identity.id, snapshot.id, {
    actorType: 'SYSTEM',
    reasonCode: 'TEST_FIXTURE'
  });
  return { identity, snapshot };
}

async function seedPreviousSnapshot(input: {
  projectId: string;
  identityId: string;
  primaryType: 'RANKING_UPSIDE' | 'CTR_UNDERPERFORMANCE' | 'SEO_GAP';
}) {
  return repository.createOpportunitySnapshot({
    opportunityIdentityId: input.identityId,
    projectId: input.projectId,
    snapshotVersion: 'GROWTH_OPPORTUNITY_V1',
    formulaVersion: 'GROWTH_SCORE_V1',
    currentWindowStart: new Date('2026-06-23T00:00:00.000Z'),
    currentWindowEnd: new Date('2026-07-20T00:00:00.000Z'),
    previousWindowStart: new Date('2026-05-26T00:00:00.000Z'),
    previousWindowEnd: new Date('2026-06-22T00:00:00.000Z'),
    dataCutoffAt: new Date('2026-07-20T00:00:00.000Z'),
    primaryType: input.primaryType,
    secondaryTypes: [],
    score: 65,
    priority: 'MEDIUM',
    scoreState: 'KNOWN',
    evidenceQuality: 'PARTIAL',
    evidenceCoverage: 0.8,
    rankingEligible: true,
    sourceProvenance: { gscSnapshotIds: ['fixture-gsc-previous'] },
    breakdown: {
      demandState: 'KNOWN', demandScore: 65,
      positionPotentialState: 'KNOWN', positionPotentialScore: 85,
      ctrGapState: 'KNOWN', ctrGapScore: 30,
      siteGapState: 'KNOWN', siteGapScore: 30,
      gscTrendState: 'KNOWN', gscTrendScore: 20,
      p6VisibilityState: 'UNKNOWN', p6VisibilityScore: null,
      trendVisibilityDisplayState: 'KNOWN', trendVisibilityDisplayScore: 20,
      availableWeight: 96,
      evidenceCoverage: 0.96,
      weightedTotal: 65,
      formulaVersion: 'GROWTH_SCORE_V1'
    },
    evidence: []
  });
}

describe('P7-A Growth REST API', () => {
  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.growthOpportunityLifecycleEvent.deleteMany({ where: { identity: { projectId } } }).catch(() => undefined);
      await prisma.growthOpportunityLifecycle.deleteMany({ where: { identity: { projectId } } }).catch(() => undefined);
      await prisma.growthOpportunityIdentity.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.growthTopicClusterSnapshot.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.growthTopicCluster.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
  });

  it('bounds opportunity lists at 100 and limits STANDARD to ranking/CTR opportunities', async () => {
    const project = await createProject('standard list', 'STANDARD');
    await seedOpportunity({
      projectId: project.id,
      query: 'ranking query',
      page: 'https://example.com/ranking',
      primaryType: 'RANKING_UPSIDE',
      score: 91,
      priority: 'CRITICAL'
    });
    await seedOpportunity({
      projectId: project.id,
      query: 'ctr query',
      page: 'https://example.com/ctr',
      primaryType: 'CTR_UNDERPERFORMANCE',
      score: 76,
      priority: 'HIGH'
    });
    await seedOpportunity({
      projectId: project.id,
      query: 'seo query',
      page: 'https://example.com/seo',
      primaryType: 'SEO_GAP',
      score: 88,
      priority: 'CRITICAL'
    });
    const app = createApp();

    await request(app)
      .get(`/api/projects/${project.id}/growth/opportunities`)
      .query({ limit: 101 })
      .expect(400);

    const response = await request(app)
      .get(`/api/projects/${project.id}/growth/opportunities`)
      .query({ limit: 100 })
      .expect(200);

    expect(response.body.data).toHaveLength(2);
    expect(response.body.data.map((row: { primaryType: string }) => row.primaryType)).toEqual([
      'RANKING_UPSIDE',
      'CTR_UNDERPERFORMANCE'
    ]);
    expect(response.body.meta.limit).toBe(100);
  });

  it('returns persisted latest detail with score breakdown, evidence and immutable snapshot history', async () => {
    const project = await createProject('detail history', 'ADVANCED');
    const seeded = await seedOpportunity({
      projectId: project.id,
      query: '六壬',
      page: 'https://example.com/liuren',
      primaryType: 'RANKING_UPSIDE',
      score: 84,
      priority: 'HIGH'
    });
    await seedPreviousSnapshot({
      projectId: project.id,
      identityId: seeded.identity.id,
      primaryType: 'RANKING_UPSIDE'
    });
    const before = await prisma.growthOpportunitySnapshot.count({ where: { projectId: project.id } });

    const response = await request(createApp())
      .get(`/api/projects/${project.id}/growth/opportunities/${seeded.identity.id}`)
      .expect(200);

    expect(response.body.data.identity).toMatchObject({
      id: seeded.identity.id,
      normalizedQuery: '六壬',
      canonicalPage: 'https://example.com/liuren'
    });
    expect(response.body.data.snapshot).toMatchObject({ id: seeded.snapshot.id, score: 84, priority: 'HIGH' });
    expect(response.body.data.breakdown).toMatchObject({ formulaVersion: 'GROWTH_SCORE_V1', demandScore: 85 });
    expect(response.body.data.evidence).toHaveLength(1);
    expect(response.body.data.history).toHaveLength(2);
    expect(response.body.data.lifecycle).toMatchObject({ status: 'NEW', latestSnapshotId: seeded.snapshot.id });
    expect(await prisma.growthOpportunitySnapshot.count({ where: { projectId: project.id } })).toBe(before);
  });

  it('fails advanced-only special views before touching a restricted Growth data source', async () => {
    const project = await createProject('fail before read', 'STANDARD');
    let restrictedReads = 0;
    const restrictedRepository = {
      listTopics: async () => { restrictedReads += 1; throw new Error('restricted read occurred'); },
      listCannibalization: async () => { restrictedReads += 1; throw new Error('restricted read occurred'); },
      listNewContent: async () => { restrictedReads += 1; throw new Error('restricted read occurred'); }
    };
    const app = (createApp as unknown as (options: Record<string, unknown>) => ReturnType<typeof createApp>)({
      growthApiRepository: restrictedRepository
    });

    for (const path of ['topics', 'cannibalization', 'new-content']) {
      await request(app)
        .get(`/api/projects/${project.id}/growth/${path}`)
        .expect(403)
        .expect(({ body }) => expect(body.error.code).toBe('FEATURE_NOT_AVAILABLE'));
    }
    expect(restrictedReads).toBe(0);
  });

  it('allows only valid user lifecycle transitions and appends an audit event', async () => {
    const project = await createProject('lifecycle', 'ADVANCED');
    const seeded = await seedOpportunity({
      projectId: project.id,
      query: 'workflow query',
      page: 'https://example.com/workflow',
      primaryType: 'RANKING_UPSIDE'
    });
    const app = createApp();

    const reviewed = await request(app)
      .post(`/api/projects/${project.id}/growth/opportunities/${seeded.identity.id}/lifecycle`)
      .send({ status: 'REVIEWED' })
      .expect(200);
    expect(reviewed.body.data.status).toBe('REVIEWED');
    expect(await prisma.growthOpportunityLifecycleEvent.findFirst({
      where: { opportunityIdentityId: seeded.identity.id, eventType: 'REVIEWED' }
    })).toMatchObject({ fromStatus: 'NEW', toStatus: 'REVIEWED', actorType: 'USER' });

    const beforeInvalid = await prisma.growthOpportunityLifecycleEvent.count({
      where: { opportunityIdentityId: seeded.identity.id }
    });
    await request(app)
      .post(`/api/projects/${project.id}/growth/opportunities/${seeded.identity.id}/lifecycle`)
      .send({ status: 'DONE' })
      .expect(400)
      .expect(({ body }) => expect(body.error.code).toBe('GROWTH_LIFECYCLE_TRANSITION_INVALID'));

    expect(await prisma.growthOpportunityLifecycle.findUniqueOrThrow({
      where: { opportunityIdentityId: seeded.identity.id }
    })).toMatchObject({ status: 'REVIEWED' });
    expect(await prisma.growthOpportunityLifecycleEvent.count({
      where: { opportunityIdentityId: seeded.identity.id }
    })).toBe(beforeInvalid);
  });
});