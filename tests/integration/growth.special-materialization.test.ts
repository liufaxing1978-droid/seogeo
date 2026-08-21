import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { materializeGrowthWindow } from '../../src/modules/growth/growth.service.js';

const prisma = new PrismaClient();

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

describe('P7-A special opportunity materialization', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const asOfDate = new Date('2026-08-20T12:00:00.000Z');
  const pageA = `https://growth-special-${suffix}.example.com/a`;
  const pageB = `https://growth-special-${suffix}.example.com/b`;
  let projectId = '';
  let propertyId = '';

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        name: `Growth special materialization ${suffix}`,
        slug: `growth-special-${suffix}`,
        primaryDomain: `growth-special-${suffix}.example.com`,
        planLevel: 'ADVANCED'
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

    for (const [url, path] of [[pageA, '/a'], [pageB, '/b']] as const) {
      await prisma.page.create({
        data: { projectId, url, normalizedUrl: url, host: project.primaryDomain, path }
      });
    }

    const firstDate = new Date('2026-06-23T00:00:00.000Z');
    for (let index = 0; index < 56; index += 1) {
      const date = addDays(firstDate, index);
      const snapshot = await prisma.gscDailySnapshot.create({
        data: {
          projectId,
          propertyId,
          date,
          status: 'COMPLETED',
          syncVersion: 1,
          rowCount: 2,
          sourceCompletenessState: 'TOP_ROWS_ONLY',
          completedAt: new Date(date.getTime() + 60_000)
        }
      });
      for (const [page, impressions, position] of [
        [pageA, 55, 8],
        [pageB, 45, 12]
      ] as const) {
        await prisma.gscQueryPageFact.create({
          data: {
            snapshotId: snapshot.id,
            projectId,
            date,
            factKey: `cannibal-${index}-${page === pageA ? 'a' : 'b'}`,
            query: '六壬法脉',
            normalizedQuery: '六壬法脉',
            normalizationVersion: 'GSC_QUERY_NORMALIZATION_V1',
            page,
            canonicalPage: page,
            clicks: Math.round(impressions * 0.08),
            impressions,
            ctr: 0.08,
            position
          }
        });
      }
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

  it('persists a stable KEYWORD_CANNIBALIZATION identity from balanced multi-page GSC facts', async () => {
    const forbidden = async () => {
      throw new Error('external call must not occur during growth materialization');
    };

    const result = await materializeGrowthWindow(projectId, asOfDate, {
      googleSearch: forbidden,
      p6Provider: forbidden,
      deepSeek: forbidden
    });
    expect(result.state).toBe('COMPLETED');

    const identity = await prisma.growthOpportunityIdentity.findFirst({
      where: { projectId, identityType: 'KEYWORD_CANNIBALIZATION', normalizedQuery: '六壬法脉' }
    });
    expect(identity).not.toBeNull();

    const snapshot = await prisma.growthOpportunitySnapshot.findFirst({
      where: { projectId, opportunityIdentityId: identity!.id },
      include: { breakdown: true, evidence: true }
    });
    expect(snapshot).toMatchObject({
      primaryType: 'KEYWORD_CANNIBALIZATION',
      snapshotVersion: 'GROWTH_OPPORTUNITY_V1'
    });
    expect(snapshot?.sourceProvenance).toMatchObject({
      detector: {
        type: 'KEYWORD_CANNIBALIZATION',
        reasonCodes: expect.arrayContaining([
          'DEMAND_ELIGIBLE',
          'BALANCED_IMPRESSION_SHARE',
          'RANKING_COMPETITION'
        ]),
        competingPages: expect.arrayContaining([pageA, pageB])
      }
    });

    const again = await materializeGrowthWindow(projectId, asOfDate, {
      googleSearch: forbidden,
      p6Provider: forbidden,
      deepSeek: forbidden
    });
    expect(again.state).toBe('COMPLETED');
    expect(await prisma.growthOpportunityIdentity.count({
      where: { projectId, identityType: 'KEYWORD_CANNIBALIZATION' }
    })).toBe(1);
    expect(await prisma.growthOpportunitySnapshot.count({
      where: { projectId, opportunityIdentityId: identity!.id }
    })).toBe(1);
  });
});