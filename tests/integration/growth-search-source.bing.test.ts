import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { GrowthSearchSourceAdapter } from '../../src/modules/growth/growth-search-source.adapter.js';
import { SearchFactMaterializer } from '../../src/modules/search-facts/search-fact.materializer.js';
import { SEARCH_FACT_NORMALIZATION_VERSION } from '../../src/modules/search-facts/search-fact.types.js';
import { SearchProviderSourceRepository } from '../../src/modules/search-facts/search-provider-source.repository.js';
import type {
  BingPageObservation,
  BingQueryObservation,
  BingSiteTrafficObservation
} from '../../src/modules/search-providers/search-provider.types.js';

type BingObservation =
  | BingQueryObservation
  | BingPageObservation
  | BingSiteTrafficObservation;

beforeEach(async () => {
  await prisma.searchFactMetric.deleteMany();
  await prisma.searchFact.deleteMany();
  await prisma.searchFactSnapshot.deleteMany();
  await prisma.searchProviderObservationRecord.deleteMany();
  await prisma.searchProviderObservationBatch.deleteMany();
  await prisma.gscQueryPageFact.deleteMany();
  await prisma.gscDailySnapshot.deleteMany();
  await prisma.projectMarket.deleteMany();
  await prisma.searchConsoleProperty.deleteMany();
  await prisma.searchConsoleConnection.deleteMany();
  await prisma.oAuthCredentialRecord.deleteMany();
  await prisma.project.deleteMany();
});

async function createConfiguredGscFixture(name: string) {
  const project = await prisma.project.create({
    data: {
      name,
      slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      primaryDomain: 'example.com'
    }
  });
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
  const sourceDate = new Date('2026-08-20T00:00:00.000Z');
  const snapshot = await prisma.gscDailySnapshot.create({
    data: {
      projectId: project.id,
      propertyId: property.id,
      date: sourceDate,
      status: 'COMPLETED',
      syncVersion: 1,
      inputHash: `${project.id}:gsc-bing-handoff`,
      rowCount: 1,
      sourceFreshness: new Date('2026-08-21T06:00:00.000Z'),
      sourceCompletenessState: 'TOP_ROWS_ONLY',
      startedAt: new Date('2026-08-21T06:01:00.000Z'),
      completedAt: new Date('2026-08-21T06:02:00.000Z')
    }
  });
  await prisma.gscQueryPageFact.create({
    data: {
      snapshotId: snapshot.id,
      projectId: project.id,
      date: sourceDate,
      factKey: 'growth-bing-gsc-fact',
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

  return { project, property, snapshot, sourceDate };
}

function loadInput(source: Awaited<ReturnType<typeof createConfiguredGscFixture>>) {
  return {
    projectId: source.project.id,
    propertyId: source.property.id,
    selectedGscSnapshotIds: [source.snapshot.id],
    sourceDateFrom: source.sourceDate,
    sourceDateTo: source.sourceDate
  };
}

async function persistAndMaterializeBing(input: {
  projectId: string;
  marketCode?: 'GLOBAL' | 'HK';
  locale?: string;
  propertyRef?: string;
  sourceCutoffAt: Date;
  observations: readonly BingObservation[];
}) {
  const sourceRepository = new SearchProviderSourceRepository(prisma);
  const batch = await sourceRepository.persistBingBatch({
    projectId: input.projectId,
    marketCode: input.marketCode ?? 'GLOBAL',
    locale: input.locale ?? 'zh-CN',
    propertyRef: input.propertyRef ?? 'https://example.com/',
    propertyType: 'SITE',
    sourceCutoffAt: input.sourceCutoffAt,
    observations: input.observations
  });
  const snapshot = await new SearchFactMaterializer(prisma).materializeBingBatch({
    batchId: batch.id,
    normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION
  });
  return { batch, snapshot };
}

const targetQuery = (): BingQueryObservation => ({
  kind: 'QUERY_STATS',
  provider: 'BING_WEBMASTER',
  sourceDate: '2026-08-20',
  query: '兴善堂',
  clicks: 19,
  impressions: 400,
  avgClickPosition: null,
  avgImpressionPosition: 4.8,
  completeness: 'PROVIDER_UNSPECIFIED'
});

describe('P9-0G Bing corroborating lane', () => {
  it('keeps Google scoring unchanged and exposes only bounded Bing corroborating provenance', async () => {
    const source = await createConfiguredGscFixture('Bing corroborating fixture');
    const adapter = new GrowthSearchSourceAdapter(prisma);
    const baseline = await adapter.load(loadInput(source));

    const bing = await persistAndMaterializeBing({
      projectId: source.project.id,
      sourceCutoffAt: new Date('2026-08-21T12:00:00.000Z'),
      observations: [
        targetQuery(),
        {
          kind: 'PAGE_STATS',
          provider: 'BING_WEBMASTER',
          sourceDate: '2026-08-20',
          page: 'https://example.com/liuren',
          clicks: 13,
          impressions: 240,
          avgClickPosition: 1.2,
          avgImpressionPosition: 3.6,
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

    const result = await adapter.load(loadInput(source));

    expect(result.scoringFacts).toEqual(baseline.scoringFacts);
    expect(result.scoringFacts).toHaveLength(1);
    expect(result.scoringFacts[0]?.position).toBe(2.8);
    expect(result.provenance.mode).toBe('CONFIGURED_MARKET');
    if (result.provenance.mode !== 'CONFIGURED_MARKET') {
      throw new Error('configured provenance expected');
    }

    const lane = result.provenance.corroboratingLanes.find(
      (candidate) => candidate.provider === 'BING_WEBMASTER'
    );
    expect(lane).toEqual({
      provider: 'BING_WEBMASTER',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: 'https://example.com/',
      factKinds: ['PAGE', 'QUERY', 'SITE'],
      snapshotIds: [bing.snapshot.id],
      sourceCompleteness: ['PROVIDER_UNSPECIFIED']
    });
    if (!lane) throw new Error('Bing corroborating lane expected');
    expect(Object.keys(lane).sort()).toEqual([
      'factKinds',
      'locale',
      'marketCode',
      'propertyRef',
      'provider',
      'snapshotIds',
      'sourceCompleteness'
    ]);
    expect(JSON.stringify(lane)).not.toMatch(
      /Authorization|apiKey|access_token|refresh_token|numericValue|metrics|payloadJson/
    );

    expect(await prisma.searchFact.count({
      where: {
        snapshotId: bing.snapshot.id,
        factKind: 'QUERY_PAGE'
      }
    })).toBe(0);
    expect((await prisma.searchFactMetric.findFirstOrThrow({
      where: {
        fact: { snapshotId: bing.snapshot.id },
        metricSemantic: 'BING_AVG_CLICK_POSITION',
        sourceField: 'avgClickPosition',
        evidenceState: 'UNKNOWN'
      }
    }))).toMatchObject({
      numericValue: null,
      evidenceState: 'UNKNOWN'
    });
  });

  it('excludes other projects, disabled markets and RUNNING SearchFact snapshots', async () => {
    const source = await createConfiguredGscFixture('Bing exclusion fixture');
    await prisma.projectMarket.create({
      data: {
        projectId: source.project.id,
        marketCode: 'HK',
        locale: 'zh-Hant',
        enabled: false
      }
    });

    const allowed = await persistAndMaterializeBing({
      projectId: source.project.id,
      sourceCutoffAt: new Date('2026-08-21T01:00:00.000Z'),
      observations: [targetQuery()]
    });
    const disabled = await persistAndMaterializeBing({
      projectId: source.project.id,
      marketCode: 'HK',
      locale: 'zh-Hant',
      sourceCutoffAt: new Date('2026-08-21T02:00:00.000Z'),
      observations: [targetQuery()]
    });

    const otherProject = await prisma.project.create({
      data: {
        name: 'Other Bing project',
        slug: `other-bing-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        primaryDomain: 'other.example'
      }
    });
    const other = await persistAndMaterializeBing({
      projectId: otherProject.id,
      sourceCutoffAt: new Date('2026-08-21T03:00:00.000Z'),
      observations: [targetQuery()]
    });

    const running = await prisma.searchFactSnapshot.create({
      data: {
        projectId: source.project.id,
        provider: 'BING_WEBMASTER',
        marketCode: 'GLOBAL',
        locale: 'zh-CN',
        propertyRef: source.property.propertyUri,
        propertyType: 'SITE',
        sourceKind: 'PROVIDER_OBSERVATION_BATCH',
        sourceRef: 'running-bing-source',
        sourceCutoffAt: new Date('2026-08-21T04:00:00.000Z'),
        sourceCompleteness: 'PROVIDER_UNSPECIFIED',
        normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
        inputHash: 'running-bing-input-hash',
        status: 'RUNNING',
        factCount: 1,
        startedAt: new Date('2026-08-21T04:01:00.000Z')
      }
    });
    await prisma.searchFact.create({
      data: {
        snapshotId: running.id,
        projectId: source.project.id,
        factKey: 'running-bing-fact',
        factKind: 'QUERY',
        sourceObservationRef: 'running-bing-observation',
        sourceDate: source.sourceDate,
        query: 'running',
        normalizedQuery: 'running',
        queryNormalizationVersion: 'SEARCH_FACT_QUERY_NORMALIZATION_V1'
      }
    });

    const result = await new GrowthSearchSourceAdapter(prisma).load(loadInput(source));
    expect(result.provenance.mode).toBe('CONFIGURED_MARKET');
    if (result.provenance.mode !== 'CONFIGURED_MARKET') {
      throw new Error('configured provenance expected');
    }
    const bingLanes = result.provenance.corroboratingLanes.filter(
      (candidate) => candidate.provider === 'BING_WEBMASTER'
    );

    expect(bingLanes).toEqual([
      {
        provider: 'BING_WEBMASTER',
        marketCode: 'GLOBAL',
        locale: 'zh-CN',
        propertyRef: source.property.propertyUri,
        factKinds: ['QUERY'],
        snapshotIds: [allowed.snapshot.id],
        sourceCompleteness: ['PROVIDER_UNSPECIFIED']
      }
    ]);
    const serialized = JSON.stringify(bingLanes);
    expect(serialized).not.toContain(disabled.snapshot.id);
    expect(serialized).not.toContain(other.snapshot.id);
    expect(serialized).not.toContain(running.id);
  });

  it('deduplicates overlapping Bing logical facts by latest cutoff then lexical snapshot id', async () => {
    const source = await createConfiguredGscFixture('Bing dedupe fixture');
    const old = await persistAndMaterializeBing({
      projectId: source.project.id,
      sourceCutoffAt: new Date('2026-08-21T00:00:00.000Z'),
      observations: [targetQuery()]
    });
    const latestA = await persistAndMaterializeBing({
      projectId: source.project.id,
      sourceCutoffAt: new Date('2026-08-22T00:00:00.000Z'),
      observations: [
        targetQuery(),
        {
          kind: 'SITE_TRAFFIC_DAILY',
          provider: 'BING_WEBMASTER',
          sourceDate: '2026-08-19',
          clicks: 1,
          impressions: 10,
          completeness: 'PROVIDER_UNSPECIFIED'
        }
      ]
    });
    const latestB = await persistAndMaterializeBing({
      projectId: source.project.id,
      sourceCutoffAt: new Date('2026-08-22T00:00:00.000Z'),
      observations: [
        targetQuery(),
        {
          kind: 'PAGE_STATS',
          provider: 'BING_WEBMASTER',
          sourceDate: '2026-08-19',
          page: 'https://example.com/outside-window',
          clicks: 2,
          impressions: 20,
          avgClickPosition: 2,
          avgImpressionPosition: 3,
          completeness: 'PROVIDER_UNSPECIFIED'
        }
      ]
    });

    const result = await new GrowthSearchSourceAdapter(prisma).load(loadInput(source));
    expect(result.provenance.mode).toBe('CONFIGURED_MARKET');
    if (result.provenance.mode !== 'CONFIGURED_MARKET') {
      throw new Error('configured provenance expected');
    }
    const lane = result.provenance.corroboratingLanes.find(
      (candidate) => candidate.provider === 'BING_WEBMASTER'
    );
    const expectedLatestSnapshotId = [latestA.snapshot.id, latestB.snapshot.id].sort()[0]!;

    expect(lane).toEqual({
      provider: 'BING_WEBMASTER',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: source.property.propertyUri,
      factKinds: ['QUERY'],
      snapshotIds: [expectedLatestSnapshotId],
      sourceCompleteness: ['PROVIDER_UNSPECIFIED']
    });
    expect(lane?.snapshotIds).not.toContain(old.snapshot.id);
  });
});
