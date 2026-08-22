import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { growthRepository } from '../../src/modules/growth/growth.repository.js';
import { OptimizationRepository } from '../../src/modules/optimization/optimization.repository.js';

const repository = new OptimizationRepository();
const projectIds: string[] = [];

async function createGrowthFixture() {
  const nonce = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `P9-A persistence ${nonce}`,
      slug: `p9a-persistence-${nonce}`,
      primaryDomain: `p9a-${nonce}.example.com`,
      planLevel: 'ADVANCED'
    }
  });
  projectIds.push(project.id);

  const identity = await growthRepository.getOrCreateOpportunityIdentity({
    projectId: project.id,
    identityType: 'QUERY_PAGE_GROWTH',
    normalizedQuery: 'p9-a planner',
    canonicalPage: 'https://example.com/p9-a'
  });

  const firstSnapshot = await growthRepository.createOpportunitySnapshot({
    opportunityIdentityId: identity.id,
    projectId: project.id,
    snapshotVersion: 'GROWTH_OPPORTUNITY_V1',
    formulaVersion: 'GROWTH_SCORE_V1',
    currentWindowStart: new Date('2026-08-01T00:00:00.000Z'),
    currentWindowEnd: new Date('2026-08-07T00:00:00.000Z'),
    previousWindowStart: new Date('2026-07-25T00:00:00.000Z'),
    previousWindowEnd: new Date('2026-07-31T00:00:00.000Z'),
    dataCutoffAt: new Date('2026-08-08T00:00:00.000Z'),
    primaryType: 'RANKING_UPSIDE',
    secondaryTypes: [],
    score: 70,
    priority: 'HIGH',
    scoreState: 'KNOWN',
    evidenceQuality: 'COMPLETE',
    evidenceCoverage: 1,
    rankingEligible: true,
    sourceProvenance: {
      searchFacts: {
        version: 'GROWTH_SEARCH_PROVENANCE_V1',
        mode: 'UNCONFIGURED_LEGACY',
        scoringLane: { provider: 'GOOGLE_SEARCH_CONSOLE', source: 'RAW_GSC_COMPATIBILITY' }
      }
    },
    breakdown: {
      demandState: 'KNOWN', demandScore: 20,
      positionPotentialState: 'KNOWN', positionPotentialScore: 20,
      ctrGapState: 'KNOWN', ctrGapScore: 10,
      siteGapState: 'KNOWN', siteGapScore: 10,
      gscTrendState: 'KNOWN', gscTrendScore: 6,
      p6VisibilityState: 'KNOWN', p6VisibilityScore: 4,
      trendVisibilityDisplayState: 'KNOWN', trendVisibilityDisplayScore: 70,
      availableWeight: 100,
      evidenceCoverage: 1,
      weightedTotal: 70,
      formulaVersion: 'GROWTH_SCORE_V1'
    },
    evidence: []
  });

  const latestSnapshot = await growthRepository.createOpportunitySnapshot({
    opportunityIdentityId: identity.id,
    projectId: project.id,
    snapshotVersion: 'GROWTH_OPPORTUNITY_V1',
    formulaVersion: 'GROWTH_SCORE_V1',
    currentWindowStart: new Date('2026-08-08T00:00:00.000Z'),
    currentWindowEnd: new Date('2026-08-14T00:00:00.000Z'),
    previousWindowStart: new Date('2026-08-01T00:00:00.000Z'),
    previousWindowEnd: new Date('2026-08-07T00:00:00.000Z'),
    dataCutoffAt: new Date('2026-08-15T00:00:00.000Z'),
    primaryType: 'RANKING_UPSIDE',
    secondaryTypes: [],
    score: 82,
    priority: 'HIGH',
    scoreState: 'KNOWN',
    evidenceQuality: 'COMPLETE',
    evidenceCoverage: 1,
    rankingEligible: true,
    sourceProvenance: {
      searchFacts: {
        version: 'GROWTH_SEARCH_PROVENANCE_V1',
        mode: 'UNCONFIGURED_LEGACY',
        scoringLane: { provider: 'GOOGLE_SEARCH_CONSOLE', source: 'RAW_GSC_COMPATIBILITY' }
      }
    },
    breakdown: {
      demandState: 'KNOWN', demandScore: 24,
      positionPotentialState: 'KNOWN', positionPotentialScore: 22,
      ctrGapState: 'KNOWN', ctrGapScore: 12,
      siteGapState: 'KNOWN', siteGapScore: 12,
      gscTrendState: 'KNOWN', gscTrendScore: 6,
      p6VisibilityState: 'KNOWN', p6VisibilityScore: 4,
      trendVisibilityDisplayState: 'KNOWN', trendVisibilityDisplayScore: 82,
      availableWeight: 100,
      evidenceCoverage: 1,
      weightedTotal: 82,
      formulaVersion: 'GROWTH_SCORE_V1'
    },
    evidence: []
  });

  await growthRepository.ensureLifecycle(identity.id, latestSnapshot.id, {
    actorType: 'SYSTEM',
    reasonCode: 'P9A_TEST_FIXTURE'
  });

  return { project, identity, firstSnapshot, latestSnapshot };
}

afterAll(async () => {
  for (const projectId of projectIds.reverse()) {
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
});

describe('P9-A immutable persistence', () => {
  it('reads exactly the latest persisted Growth snapshot for a planner identity', async () => {
    const { project, identity, firstSnapshot, latestSnapshot } = await createGrowthFixture();
    const sources = await repository.listLatestGrowthInputs(project.id);

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      projectId: project.id,
      identityId: identity.id,
      snapshotId: latestSnapshot.id,
      growthScore: 82,
      growthLifecycleStatus: 'NEW'
    });
    expect(sources[0]?.snapshotId).not.toBe(firstSnapshot.id);
  });

  it('creates candidates idempotently and rejects database UPDATE or DELETE', async () => {
    const { project, identity, latestSnapshot } = await createGrowthFixture();
    const input = {
      projectId: project.id,
      growthOpportunityIdentityId: identity.id,
      growthSnapshotId: latestSnapshot.id,
      candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
      candidateKey: 'a'.repeat(64),
      marketScopeMode: 'UNCONFIGURED_LEGACY' as const,
      marketCode: null,
      locale: null,
      opportunityType: 'RANKING_UPSIDE' as const,
      normalizedQuery: 'p9-a planner',
      canonicalPage: 'https://example.com/p9-a',
      growthScore: 82,
      growthScoreState: 'KNOWN' as const,
      growthPriority: 'HIGH' as const,
      growthEvidenceQuality: 'COMPLETE' as const,
      growthEvidenceCoverage: 1,
      growthRankingEligible: true,
      growthLifecycleStatus: 'NEW' as const,
      sourceProvenance: { version: 'P9_A_SOURCE_PROVENANCE_V1' },
      eligibilityState: 'ELIGIBLE' as const,
      eligibilityReasonCodes: [] as string[]
    };

    const first = await repository.createCandidate(input);
    const second = await repository.createCandidate(input);
    expect(second.id).toBe(first.id);

    await expect(prisma.optimizationCandidate.update({
      where: { id: first.id },
      data: { normalizedQuery: 'mutated' }
    })).rejects.toThrow();
    await expect(prisma.optimizationCandidate.delete({ where: { id: first.id } })).rejects.toThrow();
  });

  it('creates plans idempotently and rejects database UPDATE or DELETE', async () => {
    const { project, identity, latestSnapshot } = await createGrowthFixture();
    const candidate = await repository.createCandidate({
      projectId: project.id,
      growthOpportunityIdentityId: identity.id,
      growthSnapshotId: latestSnapshot.id,
      candidateVersion: 'OPTIMIZATION_CANDIDATE_V1',
      candidateKey: 'b'.repeat(64),
      marketScopeMode: 'UNCONFIGURED_LEGACY',
      marketCode: null,
      locale: null,
      opportunityType: 'RANKING_UPSIDE',
      normalizedQuery: 'p9-a planner',
      canonicalPage: 'https://example.com/p9-a',
      growthScore: 82,
      growthScoreState: 'KNOWN',
      growthPriority: 'HIGH',
      growthEvidenceQuality: 'COMPLETE',
      growthEvidenceCoverage: 1,
      growthRankingEligible: true,
      growthLifecycleStatus: 'NEW',
      sourceProvenance: { version: 'P9_A_SOURCE_PROVENANCE_V1' },
      eligibilityState: 'ELIGIBLE',
      eligibilityReasonCodes: []
    });

    const planInput = {
      candidateId: candidate.id,
      projectId: project.id,
      planVersion: 'OPTIMIZATION_PLAN_V1',
      recommendedActionType: 'ON_PAGE_OPTIMIZATION' as const,
      sourceFactReferences: [{ type: 'GROWTH_OPPORTUNITY_SNAPSHOT', id: latestSnapshot.id }],
      deterministicRank: 1,
      aiRankAdjustment: 0,
      historicalRankAdjustment: 0,
      finalRank: 1,
      advisoryContext: [],
      automationEligibility: false,
      explanation: { authority: 'P9_A_FIRST_PARTY_PLANNER' }
    };

    const first = await repository.createPlan(planInput);
    const second = await repository.createPlan(planInput);
    expect(second.id).toBe(first.id);

    await expect(prisma.optimizationPlan.update({
      where: { id: first.id },
      data: { finalRank: 2 }
    })).rejects.toThrow();
    await expect(prisma.optimizationPlan.delete({ where: { id: first.id } })).rejects.toThrow();
  });
});
