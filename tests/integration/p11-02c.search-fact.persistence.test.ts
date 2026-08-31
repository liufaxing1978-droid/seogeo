import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { SearchFactRepository } from '../../src/modules/search-facts/search-fact.repository.js';

const createdProjectIds: string[] = [];

async function createProject(label: string) {
  const project = await prisma.project.create({
    data: {
      name: `P11-02C ${label}`,
      slug: `p11-02c-${label}-${crypto.randomUUID()}`,
      primaryDomain: 'example.com',
    },
  });
  createdProjectIds.push(project.id);
  return project;
}

afterEach(async () => {
  for (const projectId of createdProjectIds.splice(0)) {
    await prisma.searchFactSnapshot.deleteMany({ where: { projectId } });
    await prisma.project.delete({ where: { id: projectId } });
  }
});

describe('P11-02C realtime SearchFact persistence', () => {
  it('persists one realtime rank snapshot idempotently for the same logical observation', async () => {
    const project = await createProject('idempotent-rank');
    const repository = new SearchFactRepository(prisma);
    const observedAt = new Date('2026-08-31T13:00:00.000Z');

    const identity = {
      projectId: project.id,
      provider: 'GOOGLE_SERP',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: 'https://example.com/fuzhi',
      propertyType: 'URL_PREFIX',
      sourceKind: 'REALTIME_SERP_OBSERVATION',
      sourceRef: 'current-serp:google:keyword-001:dataforseo-task-001',
      sourceCutoffAt: observedAt,
      sourceCompleteness: 'TOP_ROWS_ONLY',
      normalizationVersion: 'SEARCH_FACT_NORMALIZATION_V1',
    } as any;
    const drafts = [
      {
        factKey: 'rank-fact-001',
        factKind: 'QUERY_PAGE_RANK',
        sourceObservationRef: 'dataforseo-task-001',
        sourceDate: new Date('2026-08-31T00:00:00.000Z'),
        query: '符纸',
        normalizedQuery: '符纸',
        queryNormalizationVersion: 'KEYWORD_NORMALIZATION_V1',
        page: 'https://example.com/fuzhi',
        canonicalPage: 'https://example.com/fuzhi',
        canonicalizationVersion: 'CURRENT_SERP_URL_V1',
        metrics: [
          {
            metricSemantic: 'CURRENT_SERP_POSITION',
            numericValue: 7,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'organic.position',
          },
        ],
      },
    ] as any;
    const inputHash = 'p11-02c-idempotent-rank-hash';

    const first = await repository.persistCompletedSnapshot(identity, drafts, inputHash);
    const retry = await repository.persistCompletedSnapshot(identity, drafts, inputHash);

    expect(retry.id).toBe(first.id);
    expect(await prisma.searchFactSnapshot.count({ where: { projectId: project.id } })).toBe(1);
    expect(await prisma.searchFact.count({ where: { projectId: project.id } })).toBe(1);

    const persisted = await prisma.searchFact.findFirstOrThrow({
      where: { projectId: project.id },
      include: { snapshot: true, metrics: true },
    });

    expect(persisted.snapshot).toMatchObject({
      provider: 'GOOGLE_SERP',
      sourceKind: 'REALTIME_SERP_OBSERVATION',
      sourceCompleteness: 'TOP_ROWS_ONLY',
      sourceRef: identity.sourceRef,
    });
    expect(persisted).toMatchObject({
      factKind: 'QUERY_PAGE_RANK',
      query: '符纸',
      canonicalPage: 'https://example.com/fuzhi',
    });
    expect(persisted.metrics).toEqual([
      expect.objectContaining({
        metricSemantic: 'CURRENT_SERP_POSITION',
        numericValue: 7,
        evidenceState: 'KNOWN_PRESENT',
      }),
    ]);
  });

  it('persists a not-found-within-depth observation as KNOWN_EMPTY with null numeric value', async () => {
    const project = await createProject('empty-rank');
    const repository = new SearchFactRepository(prisma);
    const identity = {
      projectId: project.id,
      provider: 'BING_SERP',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: 'https://example.com/fuzhi',
      propertyType: 'URL_PREFIX',
      sourceKind: 'REALTIME_SERP_OBSERVATION',
      sourceRef: 'current-serp:bing:keyword-001:dataforseo-task-002',
      sourceCutoffAt: new Date('2026-08-31T14:00:00.000Z'),
      sourceCompleteness: 'TOP_ROWS_ONLY',
      normalizationVersion: 'SEARCH_FACT_NORMALIZATION_V1',
    } as any;
    const drafts = [
      {
        factKey: 'rank-fact-empty-001',
        factKind: 'QUERY_PAGE_RANK',
        sourceObservationRef: 'dataforseo-task-002',
        sourceDate: new Date('2026-08-31T00:00:00.000Z'),
        query: '符纸',
        normalizedQuery: '符纸',
        queryNormalizationVersion: 'KEYWORD_NORMALIZATION_V1',
        page: 'https://example.com/fuzhi',
        canonicalPage: 'https://example.com/fuzhi',
        canonicalizationVersion: 'CURRENT_SERP_URL_V1',
        metrics: [
          {
            metricSemantic: 'CURRENT_SERP_POSITION',
            numericValue: null,
            evidenceState: 'KNOWN_EMPTY',
            sourceField: 'organic.position',
          },
        ],
      },
    ] as any;

    await repository.persistCompletedSnapshot(
      identity,
      drafts,
      'p11-02c-known-empty-rank-hash',
    );

    const metric = await prisma.searchFactMetric.findFirstOrThrow({
      where: {
        fact: { projectId: project.id },
      },
    });
    expect(metric).toMatchObject({
      metricSemantic: 'CURRENT_SERP_POSITION',
      numericValue: null,
      evidenceState: 'KNOWN_EMPTY',
    });
  });
});
