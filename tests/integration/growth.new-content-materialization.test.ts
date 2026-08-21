import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { materializeGrowthWindow } from '../../src/modules/growth/growth.service.js';

const prisma = new PrismaClient();

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

describe('P7-A new-content opportunity materialization', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const asOfDate = new Date('2026-08-20T12:00:00.000Z');
  const pageA = `https://growth-new-content-${suffix}.example.com/general`;
  const pageB = `https://growth-new-content-${suffix}.example.com/secondary`;
  let projectId = '';

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        name: `Growth new content ${suffix}`,
        slug: `growth-new-content-${suffix}`,
        primaryDomain: `growth-new-content-${suffix}.example.com`,
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

    const pageRows = [];
    for (const [url, path] of [[pageA, '/general'], [pageB, '/secondary']] as const) {
      pageRows.push(await prisma.page.create({
        data: { projectId, url, normalizedUrl: url, host: project.primaryDomain, path }
      }));
    }

    const crawlRun = await prisma.crawlRun.create({
      data: {
        projectId,
        runType: 'FULL',
        status: 'COMPLETED',
        seedUrl: pageA,
        crawlerVersion: 'test',
        finishedAt: new Date('2026-08-18T00:00:00.000Z')
      }
    });
    const pageSnapshot = await prisma.pageSnapshot.create({
      data: {
        pageId: pageRows[0]!.id,
        crawlRunId: crawlRun.id,
        finalUrl: pageA,
        statusCode: 200,
        canonicalUrl: pageA,
        contentHash: `content-${suffix}`,
        parserVersion: 'test'
      }
    });
    const document = await prisma.contentDocument.create({
      data: {
        projectId,
        pageId: pageRows[0]!.id,
        latestPageSnapshotId: pageSnapshot.id,
        canonicalUrl: pageA,
        schemaTypes: [],
        contentHash: `content-${suffix}`,
        extractedAt: new Date('2026-08-18T00:01:00.000Z')
      }
    });
    await prisma.contentSignal.create({
      data: {
        projectId,
        contentDocumentId: document.id,
        ruleKey: 'CONTENT_TOPIC_COVERAGE',
        ruleVersion: 1,
        status: 'FAIL',
        priority: 'HIGH',
        textValue: 'Existing page does not adequately cover the query topic.',
        sourceReferences: []
      }
    });

    const firstDate = new Date('2026-06-23T00:00:00.000Z');
    for (let index = 0; index < 56; index += 1) {
      const date = addDays(firstDate, index);
      const snapshot = await prisma.gscDailySnapshot.create({
        data: {
          projectId,
          propertyId: property.id,
          date,
          status: 'COMPLETED',
          syncVersion: 1,
          rowCount: 2,
          sourceCompletenessState: 'TOP_ROWS_ONLY',
          completedAt: new Date(date.getTime() + 60_000)
        }
      });
      for (const [page, impressions, position] of [
        [pageA, 69, 21],
        [pageB, 31, 40]
      ] as const) {
        await prisma.gscQueryPageFact.create({
          data: {
            snapshotId: snapshot.id,
            projectId,
            date,
            factKey: `new-content-${index}-${page === pageA ? 'a' : 'b'}`,
            query: '六壬历史专题',
            normalizedQuery: '六壬历史专题',
            normalizationVersion: 'GSC_QUERY_NORMALIZATION_V1',
            page,
            canonicalPage: page,
            clicks: Math.round(impressions * 0.04),
            impressions,
            ctr: 0.04,
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
      await prisma.contentSignal.deleteMany({ where: { projectId } });
      await prisma.contentDocument.deleteMany({ where: { projectId } });
      await prisma.pageSnapshot.deleteMany({ where: { page: { projectId } } });
      await prisma.crawlRun.deleteMany({ where: { projectId } });
      await prisma.gscQueryPageFact.deleteMany({ where: { projectId } });
      await prisma.gscDailySnapshot.deleteMany({ where: { projectId } });
      await prisma.searchConsoleProperty.deleteMany({ where: { projectId } });
      await prisma.searchConsoleConnection.deleteMany({ where: { projectId } });
      await prisma.oAuthCredentialRecord.deleteMany({ where: { projectId } });
      await prisma.page.deleteMany({ where: { projectId } });
      await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
    }
    await prisma.$disconnect();
  });

  it('persists NEW_CONTENT_OPPORTUNITY only from conservative persisted GSC and P5 facts', async () => {
    const forbidden = async () => {
      throw new Error('external call must not occur during growth materialization');
    };

    const result = await materializeGrowthWindow(projectId, asOfDate, {
      googleSearch: forbidden,
      p6Provider: forbidden,
      deepSeek: forbidden
    });
    expect(result.state).toBe('COMPLETED');

    expect(await prisma.growthOpportunityIdentity.count({
      where: { projectId, identityType: 'KEYWORD_CANNIBALIZATION', normalizedQuery: '六壬历史专题' }
    })).toBe(0);

    const identity = await prisma.growthOpportunityIdentity.findFirst({
      where: { projectId, identityType: 'NEW_CONTENT_OPPORTUNITY', normalizedQuery: '六壬历史专题' }
    });
    expect(identity).not.toBeNull();

    const snapshot = await prisma.growthOpportunitySnapshot.findFirst({
      where: { projectId, opportunityIdentityId: identity!.id },
      include: { breakdown: true, evidence: true }
    });
    expect(snapshot).toMatchObject({
      primaryType: 'NEW_CONTENT_OPPORTUNITY',
      snapshotVersion: 'GROWTH_OPPORTUNITY_V1'
    });
    expect(snapshot?.sourceProvenance).toMatchObject({
      detector: {
        type: 'NEW_CONTENT_OPPORTUNITY',
        reasonCodes: expect.arrayContaining([
          'DEMAND_ELIGIBLE',
          'NO_TOP_20_EXISTING_PAGE',
          'P3_P5_COVERAGE_GAP'
        ]),
        queryImpressions: 2800,
        projectP50Impressions: 2800
      }
    });
    expect(snapshot?.evidence.some((row) => row.sourceModule === 'P5_CONTENT')).toBe(true);

    const again = await materializeGrowthWindow(projectId, asOfDate, {
      googleSearch: forbidden,
      p6Provider: forbidden,
      deepSeek: forbidden
    });
    expect(again.state).toBe('COMPLETED');
    expect(await prisma.growthOpportunityIdentity.count({
      where: { projectId, identityType: 'NEW_CONTENT_OPPORTUNITY' }
    })).toBe(1);
    expect(await prisma.growthOpportunitySnapshot.count({
      where: { projectId, opportunityIdentityId: identity!.id }
    })).toBe(1);
  });
});