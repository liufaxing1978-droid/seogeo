import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { GrowthSearchSourceAdapter } from '../../src/modules/growth/growth-search-source.adapter.js';

beforeEach(async () => {
  await prisma.searchFactMetric.deleteMany();
  await prisma.searchFact.deleteMany();
  await prisma.searchFactSnapshot.deleteMany();
  await prisma.gscQueryPageFact.deleteMany();
  await prisma.gscDailySnapshot.deleteMany();
  await prisma.searchConsoleProperty.deleteMany();
  await prisma.searchConsoleConnection.deleteMany();
  await prisma.oAuthCredentialRecord.deleteMany();
  await prisma.project.deleteMany();
});

async function createGscFixture(name: string) {
  const project = await prisma.project.create({
    data: {
      name,
      slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
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
  const sourceDate = new Date('2026-08-20T00:00:00.000Z');
  const snapshot = await prisma.gscDailySnapshot.create({
    data: {
      projectId: project.id,
      propertyId: property.id,
      date: sourceDate,
      status: 'COMPLETED',
      syncVersion: 1,
      inputHash: `${project.id}:gsc-source-hash`,
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
      date: sourceDate,
      factKey: 'growth-handoff-fact',
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

  return { project, property, snapshot, fact, sourceDate };
}

function loadInput(source: Awaited<ReturnType<typeof createGscFixture>>) {
  return {
    projectId: source.project.id,
    propertyId: source.property.id,
    selectedGscSnapshotIds: [source.snapshot.id],
    sourceDateFrom: source.sourceDate,
    sourceDateTo: source.sourceDate
  };
}

describe('P9-0G Growth search source handoff', () => {
  it('uses explicit UNCONFIGURED_LEGACY mode when the project has no enabled market', async () => {
    const source = await createGscFixture('Legacy growth handoff');
    const result = await new GrowthSearchSourceAdapter(prisma).load(loadInput(source));

    expect(result.scoringFacts).toEqual([
      {
        date: source.sourceDate,
        normalizedQuery: '兴善堂',
        canonicalPage: 'https://example.com/liuren',
        clicks: 7,
        impressions: 120,
        ctr: 7 / 120,
        position: 2.8
      }
    ]);
    expect(result.provenance).toEqual({
      version: 'GROWTH_SEARCH_PROVENANCE_V1',
      mode: 'UNCONFIGURED_LEGACY',
      scoringLane: {
        provider: 'GOOGLE_SEARCH_CONSOLE',
        source: 'RAW_GSC_COMPATIBILITY',
        gscSnapshotIds: [source.snapshot.id]
      },
      corroboratingLanes: []
    });
    expect(await prisma.searchFactSnapshot.count()).toBe(0);
  });

  it('materializes and reads the configured Google scoring lane through unified facts', async () => {
    const source = await createGscFixture('Configured growth handoff');
    await prisma.projectMarket.create({
      data: {
        projectId: source.project.id,
        marketCode: 'GLOBAL',
        locale: 'zh-CN',
        enabled: true
      }
    });

    const result = await new GrowthSearchSourceAdapter(prisma).load(loadInput(source));

    expect(result.provenance.mode).toBe('CONFIGURED_MARKET');
    if (result.provenance.mode !== 'CONFIGURED_MARKET') throw new Error('configured provenance expected');
    expect(result.scoringFacts).toEqual([
      {
        date: source.sourceDate,
        normalizedQuery: '兴善堂',
        canonicalPage: 'https://example.com/liuren',
        clicks: 7,
        impressions: 120,
        ctr: 7 / 120,
        position: 2.8
      }
    ]);
    expect(result.provenance.scoringLane).toMatchObject({
      provider: 'GOOGLE_SEARCH_CONSOLE',
      factKind: 'QUERY_PAGE',
      sourceRefs: [source.snapshot.id],
      marketProjections: [
        {
          marketCode: 'GLOBAL',
          locale: 'zh-CN',
          propertyRef: source.property.propertyUri
        }
      ]
    });
    expect(result.provenance.scoringLane.snapshotIds).toHaveLength(1);
    expect(await prisma.searchFactSnapshot.count({
      where: {
        sourceRef: source.snapshot.id,
        provider: 'GOOGLE_SEARCH_CONSOLE',
        status: 'COMPLETED'
      }
    })).toBe(1);
  });

  it('projects one raw GSC source into multiple enabled markets without multiplying scoring facts', async () => {
    const source = await createGscFixture('Multi market growth handoff');
    await prisma.projectMarket.createMany({
      data: [
        { projectId: source.project.id, marketCode: 'GLOBAL', locale: 'zh-CN', enabled: true },
        { projectId: source.project.id, marketCode: 'HK', locale: 'zh-Hant', enabled: true }
      ]
    });

    const result = await new GrowthSearchSourceAdapter(prisma).load(loadInput(source));

    expect(result.scoringFacts).toHaveLength(1);
    expect(await prisma.searchFactSnapshot.count({
      where: { sourceRef: source.snapshot.id, provider: 'GOOGLE_SEARCH_CONSOLE' }
    })).toBe(2);
    expect(result.provenance.mode).toBe('CONFIGURED_MARKET');
    if (result.provenance.mode !== 'CONFIGURED_MARKET') throw new Error('configured provenance expected');
    expect(result.provenance.scoringLane.marketProjections).toEqual([
      { marketCode: 'GLOBAL', locale: 'zh-CN', propertyRef: source.property.propertyUri },
      { marketCode: 'HK', locale: 'zh-Hant', propertyRef: source.property.propertyUri }
    ]);
  });

  it('ignores disabled markets and keeps legacy mode when none are enabled', async () => {
    const source = await createGscFixture('Disabled market growth handoff');
    await prisma.projectMarket.create({
      data: {
        projectId: source.project.id,
        marketCode: 'GLOBAL',
        locale: 'zh-CN',
        enabled: false
      }
    });

    const result = await new GrowthSearchSourceAdapter(prisma).load(loadInput(source));

    expect(result.provenance.mode).toBe('UNCONFIGURED_LEGACY');
    expect(await prisma.searchFactSnapshot.count()).toBe(0);
  });

  it('fails configured mode without raw fallback and preserves authoritative GSC completion', async () => {
    const source = await createGscFixture('Configured failure growth handoff');
    await prisma.projectMarket.create({
      data: {
        projectId: source.project.id,
        marketCode: 'GLOBAL',
        locale: 'zh-CN',
        enabled: true
      }
    });
    const adapter = new GrowthSearchSourceAdapter(prisma, {
      materializer: {
        materializeGoogleSnapshot: async () => {
          throw new Error('SEARCH_FACT_PERSISTENCE_CONFLICT');
        }
      }
    });

    await expect(adapter.load(loadInput(source))).rejects.toThrow('SEARCH_FACT_PERSISTENCE_CONFLICT');
    expect((await prisma.gscDailySnapshot.findUniqueOrThrow({
      where: { id: source.snapshot.id }
    })).status).toBe('COMPLETED');
    expect(await prisma.searchFactSnapshot.count()).toBe(0);
  });

  it('fails closed when selected GSC source identity does not match the requested project/property', async () => {
    const source = await createGscFixture('Source identity growth handoff');
    const other = await prisma.project.create({
      data: {
        name: 'Other growth project',
        slug: `other-growth-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        primaryDomain: 'other.example'
      }
    });

    await expect(new GrowthSearchSourceAdapter(prisma).load({
      ...loadInput(source),
      projectId: other.id
    })).rejects.toThrow('GROWTH_SEARCH_SOURCE_MISMATCH');
  });

  it('fails closed when a selected GSC source is outside the requested source window', async () => {
    const source = await createGscFixture('Source window growth handoff');

    await expect(new GrowthSearchSourceAdapter(prisma).load({
      ...loadInput(source),
      sourceDateFrom: new Date('2026-08-21T00:00:00.000Z'),
      sourceDateTo: new Date('2026-08-21T00:00:00.000Z')
    })).rejects.toThrow('GROWTH_SEARCH_SOURCE_MISMATCH');
  });
});
