import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { SearchFactMaterializer } from '../../src/modules/search-facts/search-fact.materializer.js';
import { SEARCH_FACT_NORMALIZATION_VERSION } from '../../src/modules/search-facts/search-fact.types.js';
import { SearchProviderSourceRepository } from '../../src/modules/search-facts/search-provider-source.repository.js';

beforeEach(async () => {
  await prisma.searchFactMetric.deleteMany();
  await prisma.searchFact.deleteMany();
  await prisma.searchFactSnapshot.deleteMany();
  await prisma.searchProviderObservationRecord.deleteMany();
  await prisma.searchProviderObservationBatch.deleteMany();
  await prisma.gscQueryPageFact.deleteMany();
  await prisma.gscDailySnapshot.deleteMany();
  await prisma.searchConsoleProperty.deleteMany();
  await prisma.searchConsoleConnection.deleteMany();
  await prisma.oAuthCredentialRecord.deleteMany();
  await prisma.project.deleteMany();
});

const createCompletedGscFixture = async () => {
  const project = await prisma.project.create({
    data: {
      name: 'Unified GSC fixture',
      slug: `unified-gsc-${Date.now()}`,
      primaryDomain: 'example.com'
    }
  });
  const credential = await prisma.oAuthCredentialRecord.create({
    data: {
      projectId: project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      ciphertext: Buffer.from('ciphertext'),
      iv: Buffer.from('123456789012'),
      authTag: Buffer.from('1234567890123456'),
      keyVersion: 'fixture-v1'
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
      connectionId: connection.id,
      projectId: project.id,
      propertyUri: 'https://example.com/',
      propertyType: 'URL_PREFIX',
      permissionState: 'siteOwner',
      isActive: true
    }
  });
  const snapshot = await prisma.gscDailySnapshot.create({
    data: {
      projectId: project.id,
      propertyId: property.id,
      date: new Date('2026-08-20T00:00:00.000Z'),
      status: 'COMPLETED',
      syncVersion: 1,
      inputHash: 'gsc-source-hash',
      rowCount: 1,
      sourceFreshness: new Date('2026-08-21T06:00:00.000Z'),
      sourceCompletenessState: 'TOP_ROWS_ONLY',
      startedAt: new Date('2026-08-21T06:01:00.000Z'),
      completedAt: new Date('2026-08-21T06:02:00.000Z')
    }
  });
  const fact = await prisma.gscQueryPageFact.create({
    data: {
      snapshotId: snapshot.id,
      projectId: project.id,
      date: new Date('2026-08-20T00:00:00.000Z'),
      factKey: 'gsc-fact-key',
      query: '兴善堂',
      normalizedQuery: '兴善堂',
      normalizationVersion: 'GSC_QUERY_NORMALIZATION_V1',
      page: 'https://example.com/liuren#section',
      canonicalPage: 'https://example.com/liuren',
      clicks: 7,
      impressions: 120,
      ctr: 7 / 120,
      position: 2.8
    }
  });

  return { project, property, snapshot, fact };
};

describe('P9-0F immutable search fact materialization', () => {
  it('materializes a completed GSC snapshot idempotently and creates a new immutable snapshot for a new normalization version', async () => {
    const source = await createCompletedGscFixture();
    const materializer = new SearchFactMaterializer(prisma);

    const input = {
      snapshotId: source.snapshot.id,
      marketCode: 'GLOBAL' as const,
      locale: 'zh-CN',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION
    };

    const first = await materializer.materializeGoogleSnapshot(input);
    const replay = await materializer.materializeGoogleSnapshot(input);

    expect(replay.id).toBe(first.id);
    expect(first).toMatchObject({
      projectId: source.project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: source.property.propertyUri,
      propertyType: source.property.propertyType,
      sourceKind: 'GSC_DAILY_SNAPSHOT',
      sourceRef: source.snapshot.id,
      sourceCutoffAt: source.snapshot.sourceFreshness,
      sourceCompleteness: 'TOP_ROWS_ONLY',
      normalizationVersion: 'SEARCH_FACT_NORMALIZATION_V1',
      status: 'COMPLETED',
      factCount: 1,
      errorCode: null
    });
    expect(await prisma.searchFactSnapshot.count()).toBe(1);
    expect(await prisma.searchFact.count({ where: { snapshotId: first.id } })).toBe(1);
    expect(await prisma.searchFactMetric.count()).toBe(4);

    const storedFact = await prisma.searchFact.findFirstOrThrow({
      where: { snapshotId: first.id },
      include: { metrics: { orderBy: { metricSemantic: 'asc' } } }
    });
    expect(storedFact.sourceObservationRef).toBe(source.fact.id);
    expect(storedFact.metrics.map((metric) => metric.metricSemantic)).toEqual([
      'CLICKS',
      'CTR',
      'GOOGLE_SEARCH_CONSOLE_POSITION',
      'IMPRESSIONS'
    ]);

    const versionTwo = await materializer.materializeGoogleSnapshot({
      ...input,
      normalizationVersion: 'SEARCH_FACT_NORMALIZATION_V2'
    });
    expect(versionTwo.id).not.toBe(first.id);
    expect(versionTwo.normalizationVersion).toBe('SEARCH_FACT_NORMALIZATION_V2');
    expect(await prisma.searchFactSnapshot.count()).toBe(2);
  });

  it('materializes a persisted Bing batch without converting UNKNOWN positions into zero and replays idempotently', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'Unified Bing fixture',
        slug: `unified-bing-${Date.now()}`,
        primaryDomain: 'example.com'
      }
    });
    const sourceRepository = new SearchProviderSourceRepository(prisma);
    const batch = await sourceRepository.persistBingBatch({
      projectId: project.id,
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: 'https://example.com/',
      propertyType: 'SITE',
      sourceCutoffAt: new Date('2026-08-21T00:00:00.000Z'),
      observations: [
        {
          kind: 'QUERY_STATS',
          provider: 'BING_WEBMASTER',
          sourceDate: '2026-08-20',
          query: '兴善堂',
          clicks: 7,
          impressions: 120,
          avgClickPosition: null,
          avgImpressionPosition: 4.8,
          completeness: 'PROVIDER_UNSPECIFIED'
        },
        {
          kind: 'SITE_TRAFFIC_DAILY',
          provider: 'BING_WEBMASTER',
          sourceDate: '2026-08-20',
          clicks: 31,
          impressions: 901,
          completeness: 'PROVIDER_UNSPECIFIED'
        }
      ]
    });
    const materializer = new SearchFactMaterializer(prisma);

    const first = await materializer.materializeBingBatch({
      batchId: batch.id,
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION
    });
    const replay = await materializer.materializeBingBatch({
      batchId: batch.id,
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION
    });

    expect(replay.id).toBe(first.id);
    expect(first).toMatchObject({
      projectId: project.id,
      provider: 'BING_WEBMASTER',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: 'https://example.com/',
      propertyType: 'SITE',
      sourceKind: 'PROVIDER_OBSERVATION_BATCH',
      sourceRef: batch.id,
      sourceCutoffAt: batch.sourceCutoffAt,
      sourceCompleteness: 'PROVIDER_UNSPECIFIED',
      normalizationVersion: 'SEARCH_FACT_NORMALIZATION_V1',
      status: 'COMPLETED',
      factCount: 2
    });

    const unknownPosition = await prisma.searchFactMetric.findFirstOrThrow({
      where: {
        fact: { snapshotId: first.id },
        metricSemantic: 'BING_AVG_CLICK_POSITION'
      }
    });
    expect(unknownPosition).toMatchObject({
      numericValue: null,
      evidenceState: 'UNKNOWN',
      sourceField: 'avgClickPosition'
    });
    expect(await prisma.searchFactSnapshot.count()).toBe(1);
    expect(await prisma.searchFact.count({ where: { snapshotId: first.id } })).toBe(2);
  });

  it('rejects non-completed or internally inconsistent GSC sources before writing normalized snapshots', async () => {
    const source = await createCompletedGscFixture();
    const materializer = new SearchFactMaterializer(prisma);

    await prisma.gscDailySnapshot.update({
      where: { id: source.snapshot.id },
      data: { status: 'RUNNING', completedAt: null }
    });

    await expect(
      materializer.materializeGoogleSnapshot({
        snapshotId: source.snapshot.id,
        marketCode: 'GLOBAL',
        locale: 'zh-CN',
        normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION
      })
    ).rejects.toThrow('SEARCH_FACT_SOURCE_NOT_COMPLETED');
    expect(await prisma.searchFactSnapshot.count()).toBe(0);

    await prisma.gscDailySnapshot.update({
      where: { id: source.snapshot.id },
      data: { status: 'COMPLETED', completedAt: new Date('2026-08-21T06:02:00.000Z') }
    });
    const otherProject = await prisma.project.create({
      data: {
        name: 'Other project',
        slug: `other-project-${Date.now()}`,
        primaryDomain: 'other.example'
      }
    });
    await prisma.gscQueryPageFact.update({
      where: { id: source.fact.id },
      data: { projectId: otherProject.id }
    });

    await expect(
      materializer.materializeGoogleSnapshot({
        snapshotId: source.snapshot.id,
        marketCode: 'GLOBAL',
        locale: 'zh-CN',
        normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION
      })
    ).rejects.toThrow('SEARCH_FACT_SOURCE_IDENTITY_MISMATCH');
    expect(await prisma.searchFactSnapshot.count()).toBe(0);
  });
});
