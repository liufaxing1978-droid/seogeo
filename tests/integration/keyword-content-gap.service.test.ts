import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { KeywordRepository } from '../../src/modules/keywords/keyword.repository.js';
import { KeywordContentGapService } from '../../src/modules/keywords/keyword-content-gap.service.js';

const projectIds: string[] = [];
afterEach(async () => { await prisma.project.deleteMany({ where: { id: { in: projectIds.splice(0) } } }); });

describe('P5 keyword content gap service', () => {
  it('opens an UNKNOWN gap when no usable Page evidence exists', async () => {
    const suffix = randomUUID();
    const project = await prisma.project.create({ data: { name: 'P5 gap service', slug: `p5-gap-service-${suffix}`, primaryDomain: `${suffix}.example.com` } });
    projectIds.push(project.id);
    const keyword = await new KeywordRepository().createKeyword({ projectId: project.id, text: '无覆盖法事', normalizedText: '无覆盖法事', type: 'LONG_TAIL', source: 'MANUAL' });
    const gap = await new KeywordContentGapService().evaluateKeyword(project.id, keyword.id, randomUUID());
    expect(gap).toMatchObject({ keywordId: keyword.id, status: 'OPEN', coverageStatus: 'UNKNOWN' });
    expect(gap.reasonCodes).toEqual(['NO_ACTIVE_PAGE_EVIDENCE']);
  });

  it('opens a NONE gap when a usable Page does not cover the keyword', async () => {
    const suffix = randomUUID();
    const project = await prisma.project.create({ data: { name: 'P5 unmatched coverage', slug: `p5-unmatched-${suffix}`, primaryDomain: `${suffix}.example.com` } });
    projectIds.push(project.id);
    const keyword = await new KeywordRepository().createKeyword({ projectId: project.id, text: '超度法事', normalizedText: '超度法事', type: 'LONG_TAIL', source: 'MANUAL' });
    const crawlRun = await prisma.crawlRun.create({ data: { projectId: project.id, runType: 'MANUAL', status: 'COMPLETED', seedUrl: `https://${project.primaryDomain}`, crawlerVersion: 'p5-gap-test' } });
    const page = await prisma.page.create({ data: { projectId: project.id, url: `https://${project.primaryDomain}/about`, normalizedUrl: `https://${project.primaryDomain}/about`, host: project.primaryDomain, path: '/about' } });
    await prisma.pageSnapshot.create({ data: { pageId: page.id, crawlRunId: crawlRun.id, finalUrl: page.url, statusCode: 200, title: '关于我们', h1: '兴善堂介绍', metaDescription: '本页面介绍服务理念', indexable: true, parserVersion: 'p5-gap-test' } });

    const gap = await new KeywordContentGapService().evaluateKeyword(project.id, keyword.id, randomUUID());

    expect(gap).toMatchObject({ keywordId: keyword.id, status: 'OPEN', coverageStatus: 'NONE' });
    expect(gap.reasonCodes).toEqual(['NO_MATCH']);
  });

  it('preserves a planned workflow state when reevaluation still finds a gap', async () => {
    const suffix = randomUUID();
    const project = await prisma.project.create({ data: { name: 'P5 planned gap', slug: `p5-planned-${suffix}`, primaryDomain: `${suffix}.example.com` } });
    projectIds.push(project.id);
    const keyword = await new KeywordRepository().createKeyword({ projectId: project.id, text: '计划中法事', normalizedText: '计划中法事', type: 'LONG_TAIL', source: 'MANUAL' });
    const service = new KeywordContentGapService();

    await service.planKeyword(project.id, keyword.id, randomUUID());
    const reevaluated = await service.evaluateKeyword(project.id, keyword.id, randomUUID());

    expect(reevaluated).toMatchObject({ status: 'CONTENT_PLANNED', coverageStatus: 'UNKNOWN' });
  });
});
