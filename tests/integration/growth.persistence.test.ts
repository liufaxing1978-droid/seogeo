import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import {
  GROWTH_IDENTITY_VERSION,
  GrowthRepository,
  buildOpportunityKey
} from '../../src/modules/growth/growth.repository.js';

const projectIds: string[] = [];

async function createProject(label: string) {
  const suffix = `${Date.now()}-${Math.random()}`;
  const project = await prisma.project.create({
    data: {
      name: `P7-A Growth ${label}`,
      slug: `p7a-growth-${suffix}`,
      primaryDomain: `p7a-growth-${suffix}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);
  return project;
}

const windows = {
  currentWindowStart: new Date('2026-07-21T00:00:00.000Z'),
  currentWindowEnd: new Date('2026-08-17T00:00:00.000Z'),
  previousWindowStart: new Date('2026-06-23T00:00:00.000Z'),
  previousWindowEnd: new Date('2026-07-20T00:00:00.000Z'),
  dataCutoffAt: new Date('2026-08-17T23:59:59.999Z')
};

describe('P7-A growth stable identity', () => {
  it('keeps QUERY_PAGE_GROWTH identity stable when dynamic primaryType changes', () => {
    const ranking = {
      projectId: '00000000-0000-0000-0000-000000000201',
      identityType: 'QUERY_PAGE_GROWTH' as const,
      normalizedQuery: '六壬',
      canonicalPage: 'https://example.com/liuren',
      primaryType: 'RANKING_UPSIDE'
    };
    const ctr = { ...ranking, primaryType: 'CTR_UNDERPERFORMANCE' };

    expect(buildOpportunityKey(ranking)).toBe(buildOpportunityKey(ctr));
  });

  it('sorts/deduplicates Cannibalization pages but changes identity when the material page set changes', () => {
    const base = {
      projectId: '00000000-0000-0000-0000-000000000201',
      identityType: 'KEYWORD_CANNIBALIZATION' as const,
      normalizedQuery: '六壬',
      canonicalPages: ['https://example.com/b', 'https://example.com/a', 'https://example.com/a']
    };
    const reordered = { ...base, canonicalPages: ['https://example.com/a', 'https://example.com/b'] };
    const changed = { ...base, canonicalPages: ['https://example.com/a', 'https://example.com/c'] };

    expect(buildOpportunityKey(base)).toBe(buildOpportunityKey(reordered));
    expect(buildOpportunityKey(base)).not.toBe(buildOpportunityKey(changed));
  });
});

describe('P7-A immutable growth persistence', () => {
  afterAll(async () => {
    for (const projectId of projectIds) {
      await prisma.growthOpportunityLifecycleEvent.deleteMany({ where: { identity: { projectId } } }).catch(() => undefined);
      await prisma.growthOpportunityLifecycle.deleteMany({ where: { identity: { projectId } } }).catch(() => undefined);
      await prisma.growthOpportunityEvidence.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.growthScoreBreakdown.deleteMany({ where: { snapshot: { projectId } } }).catch(() => undefined);
      await prisma.growthOpportunitySnapshot.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.growthOpportunityIdentity.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.growthTopicClusterSnapshot.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.growthTopicCluster.deleteMany({ where: { projectId } }).catch(() => undefined);
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
  });

  it('persists a stable identity, immutable snapshot/breakdown/evidence, and separate mutable lifecycle', async () => {
    const project = await createProject('opportunity');
    const repository = new GrowthRepository();
    const identityInput = {
      projectId: project.id,
      identityType: 'QUERY_PAGE_GROWTH' as const,
      normalizedQuery: '六壬 seo',
      canonicalPage: 'https://example.com/liuren'
    };

    const firstIdentity = await repository.getOrCreateOpportunityIdentity(identityInput);
    const secondIdentity = await repository.getOrCreateOpportunityIdentity(identityInput);
    expect(firstIdentity.id).toBe(secondIdentity.id);
    expect(firstIdentity.identityVersion).toBe(GROWTH_IDENTITY_VERSION);
    expect(firstIdentity.opportunityKey).toBe(buildOpportunityKey(identityInput));

    const snapshot = await repository.createOpportunitySnapshot({
      opportunityIdentityId: firstIdentity.id,
      projectId: project.id,
      snapshotVersion: 'GROWTH_OPPORTUNITY_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      ...windows,
      primaryType: 'RANKING_UPSIDE',
      secondaryTypes: ['CTR_UNDERPERFORMANCE'],
      score: 84,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 1,
      rankingEligible: true,
      sourceProvenance: {
        selectedGscDailySnapshotIds: ['00000000-0000-0000-0000-000000000301']
      },
      breakdown: {
        demandState: 'KNOWN',
        demandScore: 90,
        positionPotentialState: 'KNOWN',
        positionPotentialScore: 100,
        ctrGapState: 'KNOWN',
        ctrGapScore: 80,
        siteGapState: 'KNOWN',
        siteGapScore: 70,
        gscTrendState: 'KNOWN',
        gscTrendScore: 50,
        p6VisibilityState: 'KNOWN',
        p6VisibilityScore: 50,
        trendVisibilityDisplayState: 'KNOWN',
        trendVisibilityDisplayScore: 50,
        availableWeight: 100,
        evidenceCoverage: 1,
        weightedTotal: 83.5,
        formulaVersion: 'GROWTH_SCORE_V1'
      },
      evidence: [{
        sourceModule: 'GSC',
        sourceType: 'QUERY_PAGE_AGGREGATE',
        sourceId: 'query-page:liuren',
        sourceFactVersion: 'GSC_QUERY_PAGE_AGGREGATE_V1',
        ruleKey: 'ranking_upside',
        rootCauseKey: 'gsc:ranking_upside',
        evidenceState: 'FAIL',
        severity: 'HIGH',
        numericValue: 8.2,
        textSummary: 'Position has material upside.',
        fingerprint: 'fixture-growth-evidence-1'
      }]
    });

    const lifecycle = await repository.ensureLifecycle(firstIdentity.id, snapshot.id, {
      actorType: 'SYSTEM',
      reasonCode: 'FIRST_SNAPSHOT'
    });
    expect(lifecycle).toMatchObject({ status: 'NEW', latestSnapshotId: snapshot.id });
    expect(await prisma.growthOpportunityLifecycleEvent.count({
      where: { opportunityIdentityId: firstIdentity.id, eventType: 'CREATED' }
    })).toBe(1);

    await expect(prisma.growthOpportunitySnapshot.update({
      where: { id: snapshot.id },
      data: { score: 1 }
    })).rejects.toThrow(/immutable/i);
    await expect(prisma.growthScoreBreakdown.update({
      where: { snapshotId: snapshot.id },
      data: { weightedTotal: 1 }
    })).rejects.toThrow(/immutable/i);
    const evidence = await prisma.growthOpportunityEvidence.findFirstOrThrow({ where: { snapshotId: snapshot.id } });
    await expect(prisma.growthOpportunityEvidence.update({
      where: { id: evidence.id },
      data: { textSummary: 'mutated' }
    })).rejects.toThrow(/immutable/i);

    const reviewed = await repository.updateLifecycle(firstIdentity.id, {
      status: 'REVIEWED',
      latestSnapshotId: snapshot.id,
      reviewedAt: new Date('2026-08-20T12:00:00.000Z')
    }, {
      eventType: 'REVIEWED',
      actorType: 'USER',
      actorId: 'fixture-user',
      reasonCode: 'MANUAL_REVIEW'
    });
    expect(reviewed.status).toBe('REVIEWED');
    expect(await prisma.growthOpportunityLifecycleEvent.count({
      where: { opportunityIdentityId: firstIdentity.id }
    })).toBe(2);
  });

  it('persists immutable topic snapshots with bounded member/provenance payloads', async () => {
    const project = await createProject('topic');
    const repository = new GrowthRepository();
    const cluster = await repository.getOrCreateTopicCluster({
      projectId: project.id,
      topicIdentityVersion: 'GROWTH_TOPIC_IDENTITY_V1',
      topicKey: 'entity:liuren',
      primaryEntityId: null,
      primaryQuery: '六壬'
    });

    const topicSnapshot = await repository.createTopicSnapshot({
      topicClusterId: cluster.id,
      projectId: project.id,
      snapshotVersion: 'GROWTH_TOPIC_SNAPSHOT_V1',
      ...windows,
      memberQueries: ['六壬', '六壬法'],
      memberPages: ['https://example.com/liuren'],
      sourceProvenance: { opportunitySnapshotIds: [] },
      totalImpressions: 1000,
      totalClicks: 100,
      ctr: 0.1,
      position: 8.5,
      topOpportunityScore: 84,
      topicScore: 80,
      priority: 'HIGH',
      scoreState: 'KNOWN',
      evidenceQuality: 'COMPLETE',
      evidenceCoverage: 1,
      rankingEligible: true,
      trendVisibilityState: 'KNOWN'
    });

    await expect(prisma.growthTopicClusterSnapshot.update({
      where: { id: topicSnapshot.id },
      data: { topicScore: 1 }
    })).rejects.toThrow(/immutable/i);
  });
});
