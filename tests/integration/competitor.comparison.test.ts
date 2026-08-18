import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { createCompetitorComparison } from '../../src/modules/competitor/competitor-comparison.js';

describe('P5-B competitor comparison evidence boundary', () => {
  const projects: string[] = [];

  afterAll(async () => {
    for (const id of projects) await prisma.project.delete({ where: { id } }).catch(() => undefined);
  });

  it('keeps owned successShare UNKNOWN when ContentDocument has no HTTP status fact', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({ data: { name: 'Comparison Boundary', slug: `comparison-${suffix}`, primaryDomain: `owned-${suffix}.example.com` } });
    projects.push(project.id);
    const crawl = await prisma.crawlRun.create({ data: { projectId: project.id, runType: 'MANUAL', status: 'COMPLETED', seedUrl: `https://${project.primaryDomain}/`, crawlerVersion: 'test', finishedAt: new Date() } });
    const page = await prisma.page.create({ data: { projectId: project.id, url: `https://${project.primaryDomain}/guide`, normalizedUrl: `https://${project.primaryDomain}/guide`, host: project.primaryDomain, path: '/guide' } });
    const snapshot = await prisma.pageSnapshot.create({ data: { pageId: page.id, crawlRunId: crawl.id, finalUrl: page.url, statusCode: 200, title: 'Guide', h1: 'Guide', wordCount: 900, contentHash: `hash-${suffix}`, parserVersion: 'test' } });
    await prisma.contentDocument.create({
      data: { projectId: project.id, pageId: page.id, latestPageSnapshotId: snapshot.id, canonicalUrl: page.url, title: 'Guide', h1: 'Guide', wordCount: 900, headingCount: 2, internalLinkCount: 3, schemaTypes: [], contentHash: `hash-${suffix}`, extractedAt: snapshot.capturedAt }
    });

    const competitor = await prisma.competitor.create({ data: { projectId: project.id, name: 'Rival', domain: `rival-${suffix}.example.com` } });
    const rivalCrawl = await prisma.competitorCrawl.create({ data: { competitorId: competitor.id, status: 'COMPLETED', seedUrl: `https://${competitor.domain}/`, maxPages: 25, pagesCrawled: 1, crawlerVersion: 'test', startedAt: new Date(), finishedAt: new Date() } });
    await prisma.competitorPageSnapshot.create({ data: { competitorCrawlId: rivalCrawl.id, url: `https://${competitor.domain}/`, normalizedUrl: `https://${competitor.domain}/`, finalUrl: `https://${competitor.domain}/`, statusCode: 200, title: 'Rival', h1: 'Rival', wordCount: 1000, headingCount: 2, internalLinkCount: 3, schemaCount: 0, indexable: true } });

    const comparison = await createCompetitorComparison(project.id, competitor.id);
    expect((comparison.ownedMetrics as any).successShare).toBeNull();
    expect((comparison.gaps as any[]).find((gap) => gap.metric === 'successShare')).toMatchObject({ state: 'UNKNOWN', delta: null });
  });
});
