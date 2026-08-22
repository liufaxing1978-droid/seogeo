import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { materializeGrowthWindow } from '../../src/modules/growth/growth.service.js';
import { SearchFactMaterializer } from '../../src/modules/search-facts/search-fact.materializer.js';
import { SEARCH_FACT_NORMALIZATION_VERSION } from '../../src/modules/search-facts/search-fact.types.js';
import { SearchProviderSourceRepository } from '../../src/modules/search-facts/search-provider-source.repository.js';

const asOfDate = new Date('2026-08-20T12:00:00.000Z');
const canonicalPage = 'https://parity.example.com/guide';
const propertyUri = 'https://parity.example.com/';
const createdProjectIds: string[] = [];

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

async function createConfiguredFixture(name: string) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name,
      slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${suffix}`,
      primaryDomain: `${suffix}.example.com`
    }
  });
  createdProjectIds.push(project.id);

  await prisma.projectMarket.create({
    data: {
      projectId: project.id,
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      enabled: true
    }
  });

  const credential = await prisma.oAuthCredentialRecord.create({
    data: {
      projectId: project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      ciphertext: Buffer.from('ciphertext'),
      iv: Buffer.alloc(12, 1),
      authTag: Buffer.alloc(16, 2),
      keyVersion: 'test'
    }
  });
  const connection = await prisma.searchConsoleConnection.create({
    data: {
      projectId: project.id,
      credentialRef: credential.id,
      status: 'CONNECTED'
    }
  });
  const property = await prisma.searchConsoleProperty.create({
    data: {
      projectId: project.id,
      connectionId: connection.id,
      propertyUri,
      propertyType: 'URL_PREFIX',
      permissionState: 'SITE_OWNER',
      isActive: true
    }
  });

  const page = await prisma.page.create({
    data: {
      projectId: project.id,
      url: canonicalPage,
      normalizedUrl: canonicalPage,
      host: 'parity.example.com',
      path: '/guide'
    }
  });
  const topicEntity = await prisma.entity.create({
    data: {
      projectId: project.id,
      entityType: 'TOPIC',
      canonicalName: '六壬文化',
      normalizedName: '六壬文化',
      status: 'ACTIVE',
      confidence: 1
    }
  });
  await prisma.pageEntity.create({
    data: {
      pageId: page.id,
      entityId: topicEntity.id,
      role: 'PRIMARY',
      confidence: 1,
      sourceType: 'P3_ENTITY'
    }
  });

  const selectedSnapshotIds: string[] = [];
  const firstDate = new Date('2026-06-23T00:00:00.000Z');
  for (let index = 0; index < 56; index += 1) {
    const date = addDays(firstDate, index);
    const currentWindow = date >= new Date('2026-07-21T00:00:00.000Z');
    const snapshot = await prisma.gscDailySnapshot.create({
      data: {
        projectId: project.id,
        propertyId: property.id,
        date,
        status: 'COMPLETED',
        syncVersion: 1,
        inputHash: `${project.id}:gsc:${index}`,
        rowCount: 1,
        sourceFreshness: new Date(date.getTime() + 30 * 60_000),
        sourceCompletenessState: 'TOP_ROWS_ONLY',
        startedAt: new Date(date.getTime() + 45_000),
        completedAt: new Date(date.getTime() + 60_000)
      }
    });
    selectedSnapshotIds.push(snapshot.id);
    await prisma.gscQueryPageFact.create({
      data: {
        snapshotId: snapshot.id,
        projectId: project.id,
        date,
        factKey: `parity-q-page-${index}`,
        query: '六壬',
        normalizedQuery: '六壬',
        normalizationVersion: 'GSC_QUERY_NORMALIZATION_V1',
        page: `${canonicalPage}#section`,
        canonicalPage,
        clicks: 2,
        impressions: 20,
        ctr: 0.1,
        position: currentWindow ? 8 : 12
      }
    });
  }

  return { project, property, selectedSnapshotIds };
}

async function addExtremeBingEvidence(projectId: string) {
  const sourceRepository = new SearchProviderSourceRepository(prisma);
  const batch = await sourceRepository.persistBingBatch({
    projectId,
    marketCode: 'GLOBAL',
    locale: 'zh-CN',
    propertyRef: propertyUri,
    propertyType: 'SITE',
    sourceCutoffAt: new Date('2026-08-20T12:00:00.000Z'),
    observations: [
      {
        kind: 'QUERY_STATS',
        provider: 'BING_WEBMASTER',
        sourceDate: '2026-08-10',
        query: '六壬',
        clicks: 9999,
        impressions: 99999,
        avgClickPosition: null,
        avgImpressionPosition: 88,
        completeness: 'PROVIDER_UNSPECIFIED'
      },
      {
        kind: 'PAGE_STATS',
        provider: 'BING_WEBMASTER',
        sourceDate: '2026-08-10',
        page: canonicalPage,
        clicks: 8888,
        impressions: 88888,
        avgClickPosition: 77,
        avgImpressionPosition: 99,
        completeness: 'PROVIDER_UNSPECIFIED'
      }
    ]
  });
  return new SearchFactMaterializer(prisma).materializeBingBatch({
    batchId: batch.id,
    normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION
  });
}

async function readOutcome(projectId: string) {
  const opportunity = await prisma.growthOpportunitySnapshot.findFirstOrThrow({
    where: { projectId },
    include: {
      identity: true,
      breakdown: true
    }
  });
  const topicSnapshot = await prisma.growthTopicClusterSnapshot.findFirstOrThrow({
    where: { projectId }
  });
  const topic = await prisma.growthTopicCluster.findUniqueOrThrow({
    where: { id: topicSnapshot.topicClusterId }
  });
  return { opportunity, topicSnapshot, topic };
}

afterAll(async () => {
  for (const projectId of createdProjectIds) {
    await prisma.growthOpportunityLifecycleEvent.deleteMany({ where: { identity: { projectId } } });
    await prisma.growthOpportunityLifecycle.deleteMany({ where: { identity: { projectId } } });
    await prisma.growthOpportunityIdentity.deleteMany({ where: { projectId } });
    await prisma.growthTopicClusterSnapshot.deleteMany({ where: { projectId } });
    await prisma.growthTopicCluster.deleteMany({ where: { projectId } });
    await prisma.searchFactMetric.deleteMany({ where: { fact: { projectId } } });
    await prisma.searchFact.deleteMany({ where: { projectId } });
    await prisma.searchFactSnapshot.deleteMany({ where: { projectId } });
    const batches = await prisma.searchProviderObservationBatch.findMany({
      where: { projectId },
      select: { id: true }
    });
    const batchIds = batches.map((row) => row.id);
    if (batchIds.length > 0) {
      await prisma.searchProviderObservationRecord.deleteMany({ where: { batchId: { in: batchIds } } });
      await prisma.searchProviderObservationBatch.deleteMany({ where: { id: { in: batchIds } } });
    }
    await prisma.gscQueryPageFact.deleteMany({ where: { projectId } });
    await prisma.gscDailySnapshot.deleteMany({ where: { projectId } });
    await prisma.pageEntity.deleteMany({ where: { page: { projectId } } });
    await prisma.entity.deleteMany({ where: { projectId } });
    await prisma.page.deleteMany({ where: { projectId } });
    await prisma.projectMarket.deleteMany({ where: { projectId } });
    await prisma.searchConsoleProperty.deleteMany({ where: { projectId } });
    await prisma.searchConsoleConnection.deleteMany({ where: { projectId } });
    await prisma.oAuthCredentialRecord.deleteMany({ where: { projectId } });
    await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  }
});

describe('P9-0G configured Growth parity', () => {
  it('keeps GROWTH_SCORE_V1 output identical when Bing corroborating evidence is added', async () => {
    const googleOnly = await createConfiguredFixture('Growth parity Google only');
    const withBing = await createConfiguredFixture('Growth parity with Bing');
    const bingSnapshot = await addExtremeBingEvidence(withBing.project.id);

    let networkCalls = 0;
    const forbidden = async () => {
      networkCalls += 1;
      throw new Error('external call must not occur during growth materialization');
    };

    const googleOnlyResult = await materializeGrowthWindow(googleOnly.project.id, asOfDate, {
      googleSearch: forbidden,
      p6Provider: forbidden,
      deepSeek: forbidden
    });
    const withBingResult = await materializeGrowthWindow(withBing.project.id, asOfDate, {
      googleSearch: forbidden,
      p6Provider: forbidden,
      deepSeek: forbidden
    });

    expect(networkCalls).toBe(0);
    expect(googleOnlyResult).toMatchObject({ state: 'COMPLETED', opportunitySnapshotCount: 1 });
    expect(withBingResult).toMatchObject({ state: 'COMPLETED', opportunitySnapshotCount: 1 });
    expect(googleOnlyResult.selectedGscSnapshotIds).toHaveLength(56);
    expect(withBingResult.selectedGscSnapshotIds).toHaveLength(56);

    const googleOutcome = await readOutcome(googleOnly.project.id);
    const bingOutcome = await readOutcome(withBing.project.id);

    expect(googleOutcome.opportunity.formulaVersion).toBe('GROWTH_SCORE_V1');
    expect(bingOutcome.opportunity.formulaVersion).toBe('GROWTH_SCORE_V1');
    expect(googleOutcome.opportunity.primaryType).toBe('RANKING_UPSIDE');
    expect(bingOutcome.opportunity.primaryType).toBe('RANKING_UPSIDE');
    expect(bingOutcome.opportunity.score).toBe(googleOutcome.opportunity.score);
    expect(bingOutcome.opportunity.rankingEligible).toBe(googleOutcome.opportunity.rankingEligible);
    expect(bingOutcome.opportunity.breakdown?.weightedTotal).toBe(
      googleOutcome.opportunity.breakdown?.weightedTotal
    );
    expect(bingOutcome.opportunity.identity).toMatchObject({
      identityType: googleOutcome.opportunity.identity.identityType,
      normalizedQuery: googleOutcome.opportunity.identity.normalizedQuery,
      canonicalPage: googleOutcome.opportunity.identity.canonicalPage
    });

    expect(bingOutcome.topic.primaryQuery).toBe(googleOutcome.topic.primaryQuery);
    expect(bingOutcome.topicSnapshot).toMatchObject({
      memberQueries: googleOutcome.topicSnapshot.memberQueries,
      memberPages: googleOutcome.topicSnapshot.memberPages,
      totalImpressions: googleOutcome.topicSnapshot.totalImpressions,
      totalClicks: googleOutcome.topicSnapshot.totalClicks,
      ctr: googleOutcome.topicSnapshot.ctr,
      position: googleOutcome.topicSnapshot.position,
      topOpportunityScore: googleOutcome.topicSnapshot.topOpportunityScore,
      topicScore: googleOutcome.topicSnapshot.topicScore,
      rankingEligible: googleOutcome.topicSnapshot.rankingEligible
    });

    expect(googleOutcome.opportunity.sourceProvenance).toMatchObject({
      searchFacts: {
        version: 'GROWTH_SEARCH_PROVENANCE_V1',
        mode: 'CONFIGURED_MARKET',
        scoringLane: {
          provider: 'GOOGLE_SEARCH_CONSOLE',
          factKind: 'QUERY_PAGE'
        },
        corroboratingLanes: []
      }
    });
    expect(bingOutcome.opportunity.sourceProvenance).toMatchObject({
      searchFacts: {
        version: 'GROWTH_SEARCH_PROVENANCE_V1',
        mode: 'CONFIGURED_MARKET',
        scoringLane: {
          provider: 'GOOGLE_SEARCH_CONSOLE',
          factKind: 'QUERY_PAGE'
        },
        corroboratingLanes: [
          {
            provider: 'BING_WEBMASTER',
            marketCode: 'GLOBAL',
            locale: 'zh-CN',
            propertyRef: propertyUri,
            factKinds: ['PAGE', 'QUERY'],
            snapshotIds: [bingSnapshot.id],
            sourceCompleteness: ['PROVIDER_UNSPECIFIED']
          }
        ]
      }
    });
  });
});
