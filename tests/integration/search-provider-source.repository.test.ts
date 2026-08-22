import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import {
  SearchProviderSourceRepository
} from '../../src/modules/search-facts/search-provider-source.repository.js';
import type {
  BingPageObservation,
  BingQueryObservation,
  BingSiteTrafficObservation
} from '../../src/modules/search-providers/search-provider.types.js';

beforeEach(async () => {
  await prisma.searchProviderObservationRecord.deleteMany();
  await prisma.searchProviderObservationBatch.deleteMany();
  await prisma.project.deleteMany();
});

describe('P9-0F Bing provider source persistence', () => {
  it('persists an allowlisted deterministic batch and replays idempotently without secret-bearing fields', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'Bing source fixture',
        slug: `bing-source-${Date.now()}`,
        primaryDomain: 'example.com'
      }
    });

    const observations: readonly (
      | BingQueryObservation
      | BingPageObservation
      | BingSiteTrafficObservation
    )[] = [
      {
        kind: 'SITE_TRAFFIC_DAILY',
        provider: 'BING_WEBMASTER',
        sourceDate: '2026-08-20',
        clicks: 31,
        impressions: 901,
        completeness: 'PROVIDER_UNSPECIFIED'
      },
      {
        kind: 'QUERY_STATS',
        provider: 'BING_WEBMASTER',
        sourceDate: '2026-08-20',
        query: '兴善堂',
        clicks: 7,
        impressions: 120,
        avgClickPosition: 2.4,
        avgImpressionPosition: null,
        completeness: 'PROVIDER_UNSPECIFIED'
      },
      {
        kind: 'PAGE_STATS',
        provider: 'BING_WEBMASTER',
        sourceDate: '2026-08-20',
        page: 'https://example.com/liuren',
        clicks: 13,
        impressions: 240,
        avgClickPosition: null,
        avgImpressionPosition: 4.8,
        completeness: 'PROVIDER_UNSPECIFIED'
      }
    ];

    const repository = new SearchProviderSourceRepository(prisma);
    const input = {
      projectId: project.id,
      marketCode: 'GLOBAL' as const,
      locale: 'zh-CN',
      propertyRef: 'https://example.com/',
      propertyType: 'SITE' as const,
      sourceCutoffAt: new Date('2026-08-21T00:00:00.000Z'),
      observations
    };

    const first = await repository.persistBingBatch(input);
    const rows = await repository.listBatchObservations(first.id);

    expect(first).toMatchObject({
      projectId: project.id,
      provider: 'BING_WEBMASTER',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: 'https://example.com/',
      propertyType: 'SITE',
      sourceCompleteness: 'PROVIDER_UNSPECIFIED',
      observationCount: 3
    });
    expect(rows.map((row) => row.observationKind)).toEqual([
      'PAGE_STATS',
      'QUERY_STATS',
      'SITE_TRAFFIC_DAILY'
    ]);

    const serialized = JSON.stringify(rows);
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('access_token');
    expect(serialized).not.toContain('refresh_token');

    const replay = await repository.persistBingBatch({
      ...input,
      observations: [...observations].reverse()
    });

    expect(replay.id).toBe(first.id);
    expect(await prisma.searchProviderObservationBatch.count()).toBe(1);
    expect(await prisma.searchProviderObservationRecord.count({ where: { batchId: first.id } })).toBe(3);
  });

  it('rejects unsafe property identities and observations beyond the source cutoff', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'Bing source validation fixture',
        slug: `bing-source-validation-${Date.now()}`,
        primaryDomain: 'example.com'
      }
    });
    const repository = new SearchProviderSourceRepository(prisma);
    const observations: readonly BingQueryObservation[] = [
      {
        kind: 'QUERY_STATS',
        provider: 'BING_WEBMASTER',
        sourceDate: '2026-08-22',
        query: 'query',
        clicks: 1,
        impressions: 2,
        avgClickPosition: null,
        avgImpressionPosition: null,
        completeness: 'PROVIDER_UNSPECIFIED'
      }
    ];

    await expect(
      repository.persistBingBatch({
        projectId: project.id,
        marketCode: 'GLOBAL',
        locale: 'en',
        propertyRef: 'https://user:password@example.com/',
        propertyType: 'SITE',
        sourceCutoffAt: new Date('2026-08-23T00:00:00.000Z'),
        observations
      })
    ).rejects.toThrow('SEARCH_PROVIDER_SOURCE_INVALID_PROPERTY');

    await expect(
      repository.persistBingBatch({
        projectId: project.id,
        marketCode: 'GLOBAL',
        locale: 'en',
        propertyRef: 'https://example.com/',
        propertyType: 'SITE',
        sourceCutoffAt: new Date('2026-08-21T23:59:59.999Z'),
        observations
      })
    ).rejects.toThrow('SEARCH_PROVIDER_SOURCE_DATE_AFTER_CUTOFF');
  });
});
