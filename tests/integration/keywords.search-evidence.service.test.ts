import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { KeywordRepository } from '../../src/modules/keywords/keyword.repository.js';
import { KeywordService } from '../../src/modules/keywords/keyword.service.js';
import {
  KeywordSearchEvidenceRepository,
} from '../../src/modules/keywords/keyword-search-evidence.repository.js';
import {
  KeywordSearchEvidenceService,
} from '../../src/modules/keywords/keyword-search-evidence.service.js';
import { SearchFactRepository } from '../../src/modules/search-facts/search-fact.repository.js';
import { SEARCH_FACT_NORMALIZATION_VERSION } from '../../src/modules/search-facts/search-fact.types.js';

const projectIds: string[] = [];
const actorUserId = randomUUID();
const fixedNow = new Date('2026-08-29T12:00:00.000Z');

async function createProject(label: string) {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `Search evidence ${label}`,
      slug: `search-evidence-${label}-${suffix}`,
      primaryDomain: `${suffix}.example.com`,
      planLevel: 'ENTERPRISE',
    },
  });
  projectIds.push(project.id);
  return project;
}

async function createKeyword(projectId: string, text: string) {
  return new KeywordService().createManual({
    actorUserId,
    projectId,
    text,
    type: 'CORE',
  });
}

async function seedEvidence(projectId: string, primaryDomain: string) {
  const repository = new SearchFactRepository(prisma);
  const googleObservedRef = `sc-domain:${primaryDomain}`;
  const googleEmptyRef = `sc-domain:empty-${primaryDomain}`;
  const bingObservedRef = `https://${primaryDomain}/`;
  const bingEmptyRef = `https://empty-${primaryDomain}/`;
  const cutoff = new Date('2026-08-28T00:00:00.000Z');
  const sourceDate = new Date('2026-08-28T00:00:00.000Z');

  await repository.persistCompletedSnapshot(
    {
      projectId,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: googleObservedRef,
      propertyType: 'DOMAIN',
      sourceKind: 'GSC_DAILY_SNAPSHOT',
      sourceRef: 'task4-google-observed',
      sourceCutoffAt: cutoff,
      sourceCompleteness: 'TOP_ROWS_ONLY',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
    },
    [
      {
        factKey: 'task4-google-query-page',
        factKind: 'QUERY_PAGE',
        sourceObservationRef: 'task4-google-observation',
        sourceDate,
        query: '符纸',
        normalizedQuery: 'provider-normalization-must-not-drive-matching',
        queryNormalizationVersion: 'provider-v999',
        page: `https://${primaryDomain}/fu-zhi`,
        canonicalPage: `https://${primaryDomain}/fu-zhi`,
        canonicalizationVersion: 'task4-test-v1',
        metrics: [
          {
            metricSemantic: 'CLICKS',
            numericValue: 6,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'clicks',
          },
          {
            metricSemantic: 'IMPRESSIONS',
            numericValue: 150,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'impressions',
          },
          {
            metricSemantic: 'GOOGLE_SEARCH_CONSOLE_POSITION',
            numericValue: 5.5,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'position',
          },
        ],
      },
    ],
    'task4-google-observed-input',
  );

  await repository.persistCompletedSnapshot(
    {
      projectId,
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: googleEmptyRef,
      propertyType: 'DOMAIN',
      sourceKind: 'GSC_DAILY_SNAPSHOT',
      sourceRef: 'task4-google-empty',
      sourceCutoffAt: cutoff,
      sourceCompleteness: 'TOP_ROWS_ONLY',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
    },
    [],
    'task4-google-empty-input',
  );

  await repository.persistCompletedSnapshot(
    {
      projectId,
      provider: 'BING_WEBMASTER',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: bingObservedRef,
      propertyType: 'SITE',
      sourceKind: 'PROVIDER_OBSERVATION_BATCH',
      sourceRef: 'task4-bing-observed',
      sourceCutoffAt: cutoff,
      sourceCompleteness: 'PROVIDER_UNSPECIFIED',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
    },
    [
      {
        factKey: 'task4-bing-query',
        factKind: 'QUERY',
        sourceObservationRef: 'task4-bing-observation',
        sourceDate,
        query: '符纸',
        normalizedQuery: 'provider-normalization-must-not-drive-matching',
        queryNormalizationVersion: 'provider-v999',
        page: null,
        canonicalPage: null,
        canonicalizationVersion: null,
        metrics: [
          {
            metricSemantic: 'CLICKS',
            numericValue: 10,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'clicks',
          },
          {
            metricSemantic: 'IMPRESSIONS',
            numericValue: 200,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'impressions',
          },
          {
            metricSemantic: 'BING_AVG_CLICK_POSITION',
            numericValue: 3.2,
            evidenceState: 'KNOWN_PRESENT',
            sourceField: 'avgClickPosition',
          },
          {
            metricSemantic: 'BING_AVG_IMPRESSION_POSITION',
            numericValue: null,
            evidenceState: 'UNKNOWN',
            sourceField: 'avgImpressionPosition',
          },
        ],
      },
    ],
    'task4-bing-observed-input',
  );

  await repository.persistCompletedSnapshot(
    {
      projectId,
      provider: 'BING_WEBMASTER',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: bingEmptyRef,
      propertyType: 'SITE',
      sourceKind: 'PROVIDER_OBSERVATION_BATCH',
      sourceRef: 'task4-bing-empty',
      sourceCutoffAt: cutoff,
      sourceCompleteness: 'PROVIDER_UNSPECIFIED',
      normalizationVersion: SEARCH_FACT_NORMALIZATION_VERSION,
    },
    [],
    'task4-bing-empty-input',
  );

  return {
    googleObservedRef,
    googleEmptyRef,
    bingObservedRef,
    bingEmptyRef,
  };
}

function createService(now = () => fixedNow) {
  return new KeywordSearchEvidenceService(
    new KeywordSearchEvidenceRepository(new SearchFactRepository(prisma)),
    new KeywordRepository(),
    now,
  );
}

afterEach(async () => {
  if (projectIds.length === 0) return;
  const ids = projectIds.splice(0, projectIds.length);
  await prisma.searchFactSnapshot.deleteMany({ where: { projectId: { in: ids } } });
  await prisma.project.deleteMany({ where: { id: { in: ids } } });
});

describe('P11-02A persisted keyword search-evidence service', () => {
  it('reads persisted Google/Bing evidence, defaults to the prior 28 UTC days, and keeps exact lanes separate', async () => {
    const project = await createProject('observed');
    const keyword = await createKeyword(project.id, '符纸');
    const refs = await seedEvidence(project.id, project.primaryDomain);
    const service = createService();

    const result = await service.evaluateKeyword(project.id, keyword.id);

    expect(result.keyword).toEqual({
      id: keyword.id,
      text: '符纸',
      normalizedMatchText: '符纸',
    });
    expect(result.dateFrom).toBe('2026-08-01');
    expect(result.dateTo).toBe('2026-08-28');

    const realLanes = result.evidence.filter((item) => item.kind === 'LANE');
    expect(realLanes).toHaveLength(4);

    expect(realLanes.find((item) => item.propertyRef === refs.googleObservedRef)).toMatchObject({
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      state: 'OBSERVED',
      metrics: {
        clicks: 6,
        impressions: 150,
        ctr: 0.04,
        searchConsoleAveragePosition: 5.5,
      },
    });
    expect(realLanes.find((item) => item.propertyRef === refs.bingObservedRef)).toMatchObject({
      provider: 'BING_WEBMASTER',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      state: 'OBSERVED',
      metrics: {
        clicks: 10,
        impressions: 200,
        bingAverageClickPosition: 3.2,
        bingAverageImpressionPosition: null,
      },
    });
    expect(realLanes.find((item) => item.propertyRef === refs.googleEmptyRef)).toMatchObject({
      provider: 'GOOGLE_SEARCH_CONSOLE',
      state: 'UNKNOWN',
      sourceCompleteness: ['TOP_ROWS_ONLY'],
    });
    expect(realLanes.find((item) => item.propertyRef === refs.bingEmptyRef)).toMatchObject({
      provider: 'BING_WEBMASTER',
      state: 'UNKNOWN',
      sourceCompleteness: ['PROVIDER_UNSPECIFIED'],
    });

    for (const provider of [
      'BAIDU_SEARCH_RESOURCE',
      'QIHOO_360_WEBMASTER',
      'SOGOU_WEBMASTER',
      'SHENMA_WEBMASTER',
    ] as const) {
      expect(result.evidence.find((item) => item.kind === 'PROVIDER' && item.provider === provider))
        .toMatchObject({
          provider,
          state: 'UNAVAILABLE',
          marketCode: null,
          locale: null,
          propertyRef: null,
        });
    }

    const filtered = await service.evaluateKeyword(project.id, keyword.id, {
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: 'GLOBAL',
      locale: 'zh-CN',
      propertyRef: refs.googleObservedRef,
    });
    expect(filtered.evidence.filter((item) => item.kind === 'LANE')).toEqual([
      expect.objectContaining({
        provider: 'GOOGLE_SEARCH_CONSOLE',
        marketCode: 'GLOBAL',
        locale: 'zh-CN',
        propertyRef: refs.googleObservedRef,
        state: 'OBSERVED',
      }),
    ]);
  });

  it('fails closed for a foreign keyword identifier', async () => {
    const local = await createProject('local-keyword');
    const foreign = await createProject('foreign-keyword');
    const foreignKeyword = await createKeyword(foreign.id, '符纸');
    const service = createService();

    await expect(service.evaluateKeyword(local.id, foreignKeyword.id)).rejects.toMatchObject({
      code: 'KEYWORD_NOT_FOUND',
    });
  });

  it('rejects invalid, reversed, over-93-day ranges and invalid provider/market/text filters', async () => {
    const project = await createProject('validation');
    const keyword = await createKeyword(project.id, '符纸');
    const service = createService();

    for (const filters of [
      { from: '2026-02-30', to: '2026-08-28' },
      { from: '2026-08-29', to: '2026-08-28' },
      { from: '2026-05-01', to: '2026-08-28' },
    ]) {
      await expect(service.evaluateKeyword(project.id, keyword.id, filters)).rejects.toMatchObject({
        code: 'KEYWORD_SEARCH_EVIDENCE_RANGE_INVALID',
      });
    }

    for (const filters of [
      { provider: 'NOT_A_PROVIDER' as never },
      { marketCode: 'NOT_A_MARKET' as never },
      { locale: '   ' },
      { propertyRef: '' },
    ]) {
      await expect(service.evaluateKeyword(project.id, keyword.id, filters)).rejects.toMatchObject({
        code: 'KEYWORD_SEARCH_EVIDENCE_FILTER_INVALID',
      });
    }
  });

  it('evaluates a project from one persisted window load instead of one read per keyword', async () => {
    const project = await createProject('bulk');
    const first = await createKeyword(project.id, '符纸');
    const second = await createKeyword(project.id, '六壬符纸');
    const loadProjectWindow = vi.fn(async () => ({ snapshots: [], facts: [] }));
    const fakeRepository = { loadProjectWindow } as unknown as KeywordSearchEvidenceRepository;
    const service = new KeywordSearchEvidenceService(
      fakeRepository,
      new KeywordRepository(),
      () => fixedNow,
    );

    const result = await service.evaluateProject(project.id, [first, second]);

    expect(loadProjectWindow).toHaveBeenCalledTimes(1);
    expect(result.has(first.id)).toBe(true);
    expect(result.has(second.id)).toBe(true);
  });
});
