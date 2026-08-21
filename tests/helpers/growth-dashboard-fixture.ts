import { prisma } from '../../src/db/prisma.js';

const WINDOW = {
  previousStart: new Date('2026-06-14T00:00:00.000Z'),
  previousEnd: new Date('2026-07-11T00:00:00.000Z'),
  currentStart: new Date('2026-07-12T00:00:00.000Z'),
  currentEnd: new Date('2026-08-08T00:00:00.000Z'),
  cutoff: new Date('2026-08-08T12:00:00.000Z')
} as const;

async function createOpportunity(
  projectId: string,
  input: {
    key: string;
    identityType?: 'QUERY_PAGE_GROWTH' | 'KEYWORD_CANNIBALIZATION' | 'NEW_CONTENT_OPPORTUNITY';
    query: string;
    canonicalPage?: string | null;
    primaryType:
      | 'RANKING_UPSIDE'
      | 'CTR_UNDERPERFORMANCE'
      | 'CONTENT_GAP'
      | 'SEO_GAP'
      | 'GEO_CITABILITY_GAP'
      | 'AI_VISIBILITY_GAP'
      | 'KEYWORD_CANNIBALIZATION'
      | 'DECLINING_PERFORMANCE'
      | 'NEW_CONTENT_OPPORTUNITY';
    score: number | null;
    priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'MONITOR' | 'UNKNOWN';
    rankingEligible: boolean;
    lifecycle?: 'NEW' | 'REVIEWED' | 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'DISMISSED' | 'RESOLVED' | 'REOPENED';
  }
) {
  const identity = await prisma.growthOpportunityIdentity.create({
    data: {
      projectId,
      opportunityKey: input.key,
      identityVersion: 'GROWTH_IDENTITY_V1',
      identityType: input.identityType ?? 'QUERY_PAGE_GROWTH',
      normalizedQuery: input.query,
      canonicalPage: input.canonicalPage ?? `https://example.com/${input.key}`,
      identityPayload: { fixture: true, key: input.key }
    }
  });

  const snapshot = await prisma.growthOpportunitySnapshot.create({
    data: {
      opportunityIdentityId: identity.id,
      projectId,
      snapshotVersion: 'GROWTH_OPPORTUNITY_V1',
      formulaVersion: 'GROWTH_SCORE_V1',
      currentWindowStart: WINDOW.currentStart,
      currentWindowEnd: WINDOW.currentEnd,
      previousWindowStart: WINDOW.previousStart,
      previousWindowEnd: WINDOW.previousEnd,
      dataCutoffAt: WINDOW.cutoff,
      primaryType: input.primaryType,
      secondaryTypes: [],
      score: input.score,
      priority: input.priority,
      scoreState: input.score === null ? 'UNKNOWN' : 'KNOWN',
      evidenceQuality: input.rankingEligible ? 'COMPLETE' : 'PARTIAL',
      evidenceCoverage: input.rankingEligible ? 1 : 0.6,
      rankingEligible: input.rankingEligible,
      sourceProvenance: { fixture: true, internal: 'SHOULD_NOT_RENDER' }
    }
  });

  await prisma.growthScoreBreakdown.create({
    data: {
      snapshotId: snapshot.id,
      demandState: 'KNOWN',
      demandScore: input.score ?? 40,
      positionPotentialState: 'KNOWN',
      positionPotentialScore: input.score ?? 40,
      ctrGapState: 'UNKNOWN',
      ctrGapScore: null,
      siteGapState: 'UNKNOWN',
      siteGapScore: null,
      gscTrendState: 'KNOWN',
      gscTrendScore: input.primaryType === 'DECLINING_PERFORMANCE' ? 75 : 0,
      p6VisibilityState: 'UNKNOWN',
      p6VisibilityScore: null,
      trendVisibilityDisplayState: 'KNOWN',
      trendVisibilityDisplayScore: input.primaryType === 'DECLINING_PERFORMANCE' ? 75 : 0,
      availableWeight: input.rankingEligible ? 100 : 60,
      evidenceCoverage: input.rankingEligible ? 1 : 0.6,
      weightedTotal: input.score,
      formulaVersion: 'GROWTH_SCORE_V1'
    }
  });

  await prisma.growthOpportunityLifecycle.create({
    data: {
      opportunityIdentityId: identity.id,
      status: input.lifecycle ?? 'NEW',
      latestSnapshotId: snapshot.id,
      ...(input.lifecycle === 'RESOLVED' ? { resolvedAt: new Date('2026-08-09T00:00:00.000Z') } : {})
    }
  });

  return { identity, snapshot };
}

async function seedSearchConsole(projectId: string) {
  const credential = await prisma.oAuthCredentialRecord.create({
    data: {
      projectId,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      ciphertext: Buffer.from('fixture-ciphertext'),
      iv: Buffer.alloc(12, 1),
      authTag: Buffer.alloc(16, 2),
      keyVersion: 'fixture-v1'
    }
  });
  const connection = await prisma.searchConsoleConnection.create({
    data: {
      projectId,
      credentialRef: credential.id,
      status: 'CONNECTED',
      lastVerifiedAt: new Date('2026-08-09T00:00:00.000Z')
    }
  });
  const property = await prisma.searchConsoleProperty.create({
    data: {
      connectionId: connection.id,
      projectId,
      propertyUri: 'sc-domain:example.com',
      propertyType: 'DOMAIN',
      permissionState: 'OWNER',
      isActive: true,
      lastSyncAt: new Date('2026-08-09T00:00:00.000Z')
    }
  });

  const previousSnapshot = await prisma.gscDailySnapshot.create({
    data: {
      projectId,
      propertyId: property.id,
      date: new Date('2026-07-01T00:00:00.000Z'),
      status: 'COMPLETED',
      syncVersion: 1,
      rowCount: 1,
      sourceFreshness: new Date('2026-07-02T00:00:00.000Z'),
      sourceCompletenessState: 'TOP_ROWS_ONLY',
      completedAt: new Date('2026-07-02T00:00:00.000Z')
    }
  });
  const currentSnapshot = await prisma.gscDailySnapshot.create({
    data: {
      projectId,
      propertyId: property.id,
      date: new Date('2026-08-01T00:00:00.000Z'),
      status: 'COMPLETED',
      syncVersion: 1,
      rowCount: 1,
      sourceFreshness: new Date('2026-08-02T00:00:00.000Z'),
      sourceCompletenessState: 'TOP_ROWS_ONLY',
      completedAt: new Date('2026-08-02T00:00:00.000Z')
    }
  });

  await prisma.gscQueryPageFact.createMany({
    data: [
      {
        snapshotId: previousSnapshot.id,
        projectId,
        date: new Date('2026-07-01T00:00:00.000Z'),
        factKey: 'previous-dashboard-fact',
        query: 'dashboard fixture',
        normalizedQuery: 'dashboard fixture',
        normalizationVersion: 'QUERY_NORMALIZATION_V1',
        page: 'https://example.com/dashboard',
        canonicalPage: 'https://example.com/dashboard',
        clicks: 10,
        impressions: 100,
        ctr: 0.1,
        position: 12
      },
      {
        snapshotId: currentSnapshot.id,
        projectId,
        date: new Date('2026-08-01T00:00:00.000Z'),
        factKey: 'current-dashboard-fact',
        query: 'dashboard fixture',
        normalizedQuery: 'dashboard fixture',
        normalizationVersion: 'QUERY_NORMALIZATION_V1',
        page: 'https://example.com/dashboard',
        canonicalPage: 'https://example.com/dashboard',
        clicks: 20,
        impressions: 200,
        ctr: 0.1,
        position: 9
      }
    ]
  });

  return { connection, property, previousSnapshot, currentSnapshot };
}

export async function seedGrowthDashboardFacts(
  projectId: string,
  options: { includeEligible?: boolean; includeAdvancedTypes?: boolean; resolvedCount?: number } = {}
) {
  const includeEligible = options.includeEligible ?? true;
  const includeAdvancedTypes = options.includeAdvancedTypes ?? true;
  const resolvedCount = options.resolvedCount ?? 1;

  const searchConsole = await seedSearchConsole(projectId);
  const ranking = await createOpportunity(projectId, {
    key: 'ranking-upside',
    query: 'ranking opportunity',
    primaryType: 'RANKING_UPSIDE',
    score: includeEligible ? 84 : null,
    priority: includeEligible ? 'HIGH' : 'UNKNOWN',
    rankingEligible: includeEligible
  });

  const created = [ranking];
  if (includeAdvancedTypes) {
    created.push(await createOpportunity(projectId, {
      key: 'declining-performance',
      query: 'declining opportunity',
      primaryType: 'DECLINING_PERFORMANCE',
      score: 91,
      priority: 'CRITICAL',
      rankingEligible: true
    }));
    created.push(await createOpportunity(projectId, {
      key: 'cannibalization',
      identityType: 'KEYWORD_CANNIBALIZATION',
      query: 'cannibal opportunity',
      canonicalPage: null,
      primaryType: 'KEYWORD_CANNIBALIZATION',
      score: 88,
      priority: 'HIGH',
      rankingEligible: true
    }));
  }

  for (let index = 0; index < resolvedCount; index += 1) {
    const resolved = await createOpportunity(projectId, {
      key: `resolved-${index}`,
      query: `resolved opportunity ${index}`,
      primaryType: 'CTR_UNDERPERFORMANCE',
      score: 45,
      priority: 'LOW',
      rankingEligible: true,
      lifecycle: 'RESOLVED'
    });
    created.push(resolved);
  }

  return { searchConsole, created, window: WINDOW };
}
