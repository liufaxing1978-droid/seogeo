import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { materializeGrowthWindow } from '../../src/modules/growth/growth.service.js';

const prisma = new PrismaClient();

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

describe('P7-A database-only growth materialization', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const asOfDate = new Date('2026-08-20T12:00:00.000Z');
  const canonicalPage = `https://growth-materialize-${suffix}.example.com/guide`;
  let projectId = '';
  let propertyId = '';
  let topicEntityId = '';
  const selectedIds: string[] = [];

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        name: `Growth materialization ${suffix}`,
        slug: `growth-materialization-${suffix}`,
        primaryDomain: `growth-materialize-${suffix}.example.com`
      }
    });
    projectId = project.id;
    const credential = await prisma.oAuthCredentialRecord.create({
      data: {
        projectId,
        provider: 'GOOGLE_SEARCH_CONSOLE',
        ciphertext: Buffer.from('ciphertext'),
        iv: Buffer.alloc(12, 1),
        authTag: Buffer.alloc(16, 2),
        keyVersion: 'test'
      }
    });
    const connection = await prisma.searchConsoleConnection.create({
      data: { projectId, credentialRef: credential.id, status: 'CONNECTED' }
    });
    const property = await prisma.searchConsoleProperty.create({
      data: {
        projectId,
        connectionId: connection.id,
        propertyUri: `sc-domain:${project.primaryDomain}`,
        propertyType: 'DOMAIN',
        permissionState: 'SITE_OWNER',
        isActive: true
      }
    });
    propertyId = property.id;

    const page = await prisma.page.create({
      data: {
        projectId,
        url: canonicalPage,
        normalizedUrl: canonicalPage,
        host: project.primaryDomain,
        path: '/guide'
      }
    });
    const topicEntity = await prisma.entity.create({
      data: {
        projectId,
        entityType: 'TOPIC',
        canonicalName: '六壬文化',
        normalizedName: '六壬文化',
        status: 'ACTIVE',
        confidence: 1
      }
    });
    topicEntityId = topicEntity.id;
    await prisma.pageEntity.create({
      data: {
        pageId: page.id,
        entityId: topicEntity.id,
        role: 'PRIMARY',
        confidence: 1,
        sourceType: 'P3_ENTITY'
      }
    });

    const firstDate = new Date('2026-06-23T00:00:00.000Z');
    for (let index = 0; index < 56; index += 1) {
      const date = addDays(firstDate, index);
      const currentWindow = date >= new Date('2026-07-21T00:00:00.000Z');
      const snapshot = await prisma.gscDailySnapshot.create({
        data: {
          projectId,
          propertyId,
          date,
          status: 'COMPLETED',
          syncVersion: 1,
          rowCount: 1,
          sourceCompletenessState: 'TOP_ROWS_ONLY',
          completedAt: new Date(date.getTime() + 60_000)
        }
      });
      selectedIds.push(snapshot.id);
      await prisma.gscQueryPageFact.create({
        data: {
          snapshotId: snapshot.id,
          projectId,
          date,
          factKey: `q-page-${index}`,
          query: '六壬',
          normalizedQuery: '六壬',
          normalizationVersion: 'GSC_QUERY_NORMALIZATION_V1',
          page: canonicalPage,
          canonicalPage,
          clicks: 2,
          impressions: 20,
          ctr: 0.1,
          position: currentWindow ? 8 : 12
        }
      });
    }
  });

  afterAll(async () => {
    if (projectId) {
      await prisma.growthOpportunityLifecycleEvent.deleteMany({ where: { identity: { projectId } } });
      await prisma.growthOpportunityLifecycle.deleteMany({ where: { identity: { projectId } } });
      await prisma.growthOpportunityIdentity.deleteMany({ where: { projectId } });
      await prisma.growthTopicClusterSnapshot.deleteMany({ where: { projectId } });
      await prisma.growthTopicCluster.deleteMany({ where: { projectId } });
      await prisma.gscQueryPageFact.deleteMany({ where: { projectId } });
      await prisma.gscDailySnapshot.deleteMany({ where: { projectId } });
      await prisma.searchConsoleProperty.deleteMany({ where: { projectId } });
      await prisma.searchConsoleConnection.deleteMany({ where: { projectId } });
      await prisma.oAuthCredentialRecord.deleteMany({ where: { projectId } });
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it('materializes immutable opportunities from selected database facts without external calls', async () => {
    const forbidden = async () => {
      throw new Error('external call must not occur during growth materialization');
    };

    const result = await materializeGrowthWindow(projectId, asOfDate, {
      googleSearch: forbidden,
      p6Provider: forbidden,
      deepSeek: forbidden
    });

    expect(result.state).toBe('COMPLETED');
    expect(result.selectedGscSnapshotIds).toHaveLength(56);
    expect(new Set(result.selectedGscSnapshotIds)).toEqual(new Set(selectedIds));
    expect(result.opportunitySnapshotCount).toBe(1);

    const snapshot = await prisma.growthOpportunitySnapshot.findFirstOrThrow({
      where: { projectId },
      include: { breakdown: true, evidence: true, identity: true }
    });
    expect(snapshot.snapshotVersion).toBe('GROWTH_OPPORTUNITY_V1');
    expect(snapshot.formulaVersion).toBe('GROWTH_SCORE_V1');
    expect(snapshot.primaryType).toBe('RANKING_UPSIDE');
    expect(snapshot.identity.normalizedQuery).toBe('六壬');
    expect(snapshot.identity.canonicalPage).toBe(canonicalPage);
    expect(snapshot.sourceProvenance).toMatchObject({
      gscSnapshotIds: expect.arrayContaining(selectedIds),
      searchFacts: {
        version: 'GROWTH_SEARCH_PROVENANCE_V1',
        mode: 'UNCONFIGURED_LEGACY',
        scoringLane: {
          provider: 'GOOGLE_SEARCH_CONSOLE',
          source: 'RAW_GSC_COMPATIBILITY',
          gscSnapshotIds: expect.arrayContaining(selectedIds)
        },
        corroboratingLanes: []
      }
    });

    const topic = await prisma.growthTopicCluster.findUniqueOrThrow({
      where: { id: snapshot.topicClusterId! }
    });
    expect(topic.topicKey).toBe(`entity:${topicEntityId}`);
    expect(topic.primaryEntityId).toBe(topicEntityId);
    expect(topic.primaryQuery).toBe('六壬文化');

    const lifecycle = await prisma.growthOpportunityLifecycle.findUniqueOrThrow({
      where: { opportunityIdentityId: snapshot.opportunityIdentityId }
    });
    expect(lifecycle.status).toBe('NEW');
    expect(lifecycle.latestSnapshotId).toBe(snapshot.id);

    const again = await materializeGrowthWindow(projectId, asOfDate, {
      googleSearch: forbidden,
      p6Provider: forbidden,
      deepSeek: forbidden
    });
    expect(again.opportunitySnapshotCount).toBe(1);
    expect(await prisma.growthOpportunitySnapshot.count({ where: { projectId } })).toBe(1);
  });
});