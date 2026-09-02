import { randomUUID } from 'node:crypto';
import { MarketCode } from '@prisma/client';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { KeywordCoverageService } from '../../src/modules/keywords/keyword-coverage.service.js';
import type { KeywordCoverageResult } from '../../src/modules/keywords/keyword.types.js';
import { KeywordOpportunityRepository } from '../../src/modules/keywords/keyword-opportunity.repository.js';
import { KeywordOpportunityService } from '../../src/modules/keywords/keyword-opportunity.service.js';
import { KeywordRepository } from '../../src/modules/keywords/keyword.repository.js';
import type { KeywordSearchEvidenceResult } from '../../src/modules/keywords/keyword-search-evidence.service.js';
import { KeywordService } from '../../src/modules/keywords/keyword.service.js';

const projectIds: string[] = [];
const actorUserId = randomUUID();

async function createProject(label: string) {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: {
      name: `Keyword opportunity ${label}`,
      slug: `keyword-opportunity-${label}-${suffix}`,
      primaryDomain: `${suffix}.example.com`,
    },
  });
  projectIds.push(project.id);
  return project;
}

function observedEvidence(keywordId: string, text: string): KeywordSearchEvidenceResult {
  return {
    keyword: { id: keywordId, text, normalizedMatchText: text },
    dateFrom: '2026-08-01',
    dateTo: '2026-08-28',
    evidence: [{
      kind: 'LANE',
      provider: 'GOOGLE_SEARCH_CONSOLE',
      marketCode: MarketCode.GLOBAL,
      locale: 'zh-CN',
      propertyRef: 'sc-domain:example.com',
      propertyType: 'DOMAIN',
      state: 'OBSERVED',
      capabilityState: 'SUPPORTED',
      sourceCompleteness: ['TOP_ROWS_ONLY'],
      dateFrom: '2026-08-01',
      dateTo: '2026-08-28',
      latestSourceDate: '2026-08-28',
      latestAvailableSourceDate: '2026-08-28',
      snapshotIds: [randomUUID()],
      metrics: {
        clicks: 30,
        impressions: 1_000,
        ctr: 0.03,
        searchConsoleAveragePosition: 12,
        bingAverageClickPosition: null,
        bingAverageImpressionPosition: null,
      },
      matchedPages: [],
      reason: 'MATCHED_QUERY_FACTS',
    }],
  };
}

afterEach(async () => {
  await prisma.project.deleteMany({ where: { id: { in: projectIds.splice(0) } } });
});

describe('KeywordOpportunityService', () => {
  it('appends explainable snapshots and returns the latest without overwriting history', async () => {
    const project = await createProject('history');
    const keyword = await new KeywordService().createManual({
      actorUserId,
      projectId: project.id,
      text: '符纸怎么用',
      type: 'QUESTION',
      intent: 'INFORMATIONAL',
      priority: 'HIGH',
    });
    const evidence = observedEvidence(keyword.id, keyword.text);
    const searchEvidenceService = { evaluateKeyword: async () => evidence };
    const coverageService = {
      evaluateKeyword: async (): Promise<KeywordCoverageResult> => ({
        status: 'NONE',
        reason: 'NO_MATCH',
        matches: [],
      }),
    };
    const repository = new KeywordOpportunityRepository();
    const service = new KeywordOpportunityService(
      repository,
      new KeywordRepository(),
      searchEvidenceService,
      coverageService as Pick<KeywordCoverageService, 'evaluateKeyword'>,
    );

    const first = await service.calculate(project.id, keyword.id, actorUserId);
    const second = await service.calculate(project.id, keyword.id, actorUserId);

    expect(first.id).not.toBe(second.id);
    expect(second).toMatchObject({
      projectId: project.id,
      keywordId: keyword.id,
      formulaVersion: 'keyword-opportunity-v1',
      dataConfidence: 0.65,
    });
    expect(second.score).not.toBeNull();
    expect(second.breakdown).toMatchObject({
      relevance: { state: 'UNKNOWN', score: null },
      demand: { state: 'KNOWN' },
      rankingOpportunity: { state: 'KNOWN' },
      difficulty: { state: 'UNKNOWN', score: null },
      contentGap: { state: 'KNOWN' },
      authorityFit: { state: 'KNOWN' },
      strategicValue: { state: 'KNOWN' },
      geoValue: { state: 'KNOWN' },
    });
    expect(await prisma.keywordOpportunitySnapshot.count({
      where: { projectId: project.id, keywordId: keyword.id },
    })).toBe(2);
    await expect(repository.findLatest(project.id, keyword.id)).resolves.toMatchObject({
      id: second.id,
    });
  });

  it('fails closed when a keyword belongs to another project', async () => {
    const local = await createProject('local');
    const foreign = await createProject('foreign');
    const keyword = await new KeywordService().createManual({
      actorUserId,
      projectId: foreign.id,
      text: '外部词',
      type: 'CORE',
    });
    const service = new KeywordOpportunityService();

    await expect(service.calculate(local.id, keyword.id, actorUserId))
      .rejects.toMatchObject({ code: 'KEYWORD_NOT_FOUND' });
    expect(await prisma.keywordOpportunitySnapshot.count({ where: { projectId: local.id } })).toBe(0);
  });
});
