import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { SearchFactRepository } from '../../src/modules/search-facts/search-fact.repository.js';
import { SEARCH_FACT_NORMALIZATION_VERSION } from '../../src/modules/search-facts/search-fact.types.js';

const projectIds: string[] = [];

async function createProject(label: string) {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const project = await prisma.project.create({
    data: {
      name: `${label} ${suffix}`,
      slug: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${suffix}`,
      primaryDomain: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${suffix}.example.com`,
      planLevel: 'ENTERPRISE',
    },
  });
  projectIds.push(project.id);
  return project;
}

afterEach(async () => {
  if (projectIds.length === 0) return;
  const ids = projectIds.splice(0, projectIds.length);
  await prisma.searchFactSnapshot.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
});

describe('SearchFactRepository completed snapshot metadata read', () => {
  it('returns completed zero-fact snapshots with deterministic ordering and project scoping', async () => {
    const project = await createProject('Snapshot Read');
    const foreignProject = await createProject('Foreign Snapshot Read');
    const repository = new SearchFactRepository(prisma);
    const propertyRef = `sc-domain:${project.primaryDomain}`;

    const googleEarly = await repository.persistCompletedSnapshot(
      {
        projectId: project.id,
        provider: 'GOOGLE_SEARCH_CONSOLE',
        marketCode: 'GLOBAL',
        locale: 'zh-CN',
        propertyRef,
        propertyType: 'DOMAIN',
        sourceKind: 'GSC_DAILY_SNAPSHOT',
        sourceRef: 'gsc-zero-early',
        sourceCutoffAt: new Date('2026-08-28T01:00:00.000Z'),
        sourceCompleteness: 'TOP_ROWS_ONLY',
        normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
      },
      [],
      'gsc-zero-early-input',
    );

    const googleLate = await repository.persistCompletedSnapshot(
      {
        projectId: project.id,
        provider: 'GOOGLE_SEARCH_CONSOLE',
        marketCode: 'GLOBAL',
        locale: 'zh-CN',
        propertyRef,
        propertyType: 'DOMAIN',
        sourceKind: 'GSC_DAILY_SNAPSHOT',
        sourceRef: 'gsc-zero-late',
        sourceCutoffAt: new Date('2026-08-29T01:00:00.000Z'),
        sourceCompleteness: 'TOP_ROWS_ONLY',
        normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
      },
      [],
      'gsc-zero-late-input',
    );

    const bing = await repository.persistCompletedSnapshot(
      {
        projectId: project.id,
        provider: 'BING_WEBMASTER',
        marketCode: 'GLOBAL',
        locale: 'zh-CN',
        propertyRef,
        propertyType: 'SITE',
        sourceKind: 'PROVIDER_OBSERVATION_BATCH',
        sourceRef: 'bing-query-batch',
        sourceCutoffAt: new Date('2026-08-29T02:00:00.000Z'),
        sourceCompleteness: 'PROVIDER_UNSPECIFIED',
        normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
      },
      [
        {
          factKey: 'bing-query-fuzhi',
          factKind: 'QUERY',
          sourceObservationRef: 'bing-observation-fuzhi',
          sourceDate: new Date('2026-08-29T00:00:00.000Z'),
          query: '符纸',
          normalizedQuery: '符纸',
          queryNormalizationVersion: 'snapshot-read-test-v1',
          page: null,
          canonicalPage: null,
          canonicalizationVersion: null,
          metrics: [
            {
              metricSemantic: 'IMPRESSIONS',
              numericValue: 12,
              evidenceState: 'KNOWN_PRESENT',
              sourceField: 'impressions',
            },
          ],
        },
      ],
      'bing-query-input',
    );

    await repository.persistCompletedSnapshot(
      {
        projectId: foreignProject.id,
        provider: 'GOOGLE_SEARCH_CONSOLE',
        marketCode: 'GLOBAL',
        locale: 'zh-CN',
        propertyRef: `sc-domain:${foreignProject.primaryDomain}`,
        propertyType: 'DOMAIN',
        sourceKind: 'GSC_DAILY_SNAPSHOT',
        sourceRef: 'foreign-gsc-zero',
        sourceCutoffAt: new Date('2026-08-29T03:00:00.000Z'),
        sourceCompleteness: 'TOP_ROWS_ONLY',
        normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
      },
      [],
      'foreign-gsc-zero-input',
    );

    const snapshots = await repository.listCompletedSnapshots({ projectId: project.id });

    expect(snapshots.map((snapshot) => snapshot.snapshotId)).toEqual([
      bing.id,
      googleLate.id,
      googleEarly.id,
    ]);
    expect(snapshots).toHaveLength(3);
    expect(snapshots.every((snapshot) => snapshot.projectId === project.id)).toBe(true);
    expect(snapshots[1]).toMatchObject({
      snapshotId: googleLate.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      sourceCompleteness: 'TOP_ROWS_ONLY',
      factCount: 0,
      completedAt: expect.any(Date),
    });

    const facts = await repository.listCompletedFacts({ projectId: project.id });
    expect(facts).toHaveLength(1);
    expect(facts[0]?.snapshotId).toBe(bing.id);
  });

  it('filters completed snapshot metadata and rejects invalid read filters', async () => {
    const project = await createProject('Snapshot Filter');
    const repository = new SearchFactRepository(prisma);
    const propertyRef = `sc-domain:${project.primaryDomain}`;

    const older = await repository.persistCompletedSnapshot(
      {
        projectId: project.id,
        provider: 'GOOGLE_SEARCH_CONSOLE',
        marketCode: 'GLOBAL',
        locale: 'zh-CN',
        propertyRef,
        propertyType: 'DOMAIN',
        sourceKind: 'GSC_DAILY_SNAPSHOT',
        sourceRef: 'filter-older',
        sourceCutoffAt: new Date('2026-08-27T00:00:00.000Z'),
        sourceCompleteness: 'TOP_ROWS_ONLY',
        normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
      },
      [],
      'filter-older-input',
    );
    const newer = await repository.persistCompletedSnapshot(
      {
        projectId: project.id,
        provider: 'GOOGLE_SEARCH_CONSOLE',
        marketCode: 'GLOBAL',
        locale: 'zh-CN',
        propertyRef,
        propertyType: 'DOMAIN',
        sourceKind: 'GSC_DAILY_SNAPSHOT',
        sourceRef: 'filter-newer',
        sourceCutoffAt: new Date('2026-08-29T00:00:00.000Z'),
        sourceCompleteness: 'TOP_ROWS_ONLY',
        normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
      },
      [],
      'filter-newer-input',
    );

    const rows = await repository.listCompletedSnapshots({
      projectId: project.id,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef,
      sourceCutoffFrom: new Date('2026-08-28T00:00:00.000Z'),
      sourceCutoffTo: new Date('2026-08-30T00:00:00.000Z'),
    });

    expect(rows.map((row) => row.snapshotId)).toEqual([newer.id]);
    expect(rows.some((row) => row.snapshotId === older.id)).toBe(false);

    await expect(repository.listCompletedSnapshots({ projectId: ' ' })).rejects.toThrow(
      'SEARCH_FACT_INVALID_READ_FILTER',
    );
    await expect(
      repository.listCompletedSnapshots({
        projectId: project.id,
        sourceCutoffFrom: new Date('2026-08-30T00:00:00.000Z'),
        sourceCutoffTo: new Date('2026-08-29T00:00:00.000Z'),
      }),
    ).rejects.toThrow('SEARCH_FACT_INVALID_READ_FILTER');
  });
});
