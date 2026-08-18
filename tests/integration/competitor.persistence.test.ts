import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';

describe('P5-B competitor persistence', () => {
  const projects: string[] = [];
  afterAll(async () => { for (const id of projects) await prisma.project.delete({ where: { id } }).catch(() => undefined); });

  it('keeps competitor facts project-scoped and versioned', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({ data: { name: 'Competitor', slug: `competitor-${suffix}`, primaryDomain: `owned-${suffix}.example.com` } });
    projects.push(project.id);
    const competitor = await prisma.competitor.create({ data: { projectId: project.id, name: 'Example Rival', domain: `rival-${suffix}.example.com` } });
    const crawl = await prisma.competitorCrawl.create({ data: { competitorId: competitor.id, status: 'COMPLETED', seedUrl: `https://${competitor.domain}/`, maxPages: 25, pagesCrawled: 1, crawlerVersion: 'test', finishedAt: new Date() } });
    const snapshot = await prisma.competitorPageSnapshot.create({ data: { competitorCrawlId: crawl.id, url: crawl.seedUrl, normalizedUrl: crawl.seedUrl, statusCode: 200, title: 'Rival', h1: 'Rival', wordCount: 800, headingCount: 4, internalLinkCount: 5, externalLinkCount: 1, imageCount: 2, schemaCount: 1, indexable: true, contentHash: `hash-${suffix}`, fetchedAt: new Date() } });
    const comparison = await prisma.competitorComparison.create({ data: { projectId: project.id, competitorId: competitor.id, competitorCrawlId: crawl.id, comparisonVersion: 'COMPETITOR_COMPARISON_V1', ownedMetrics: { pagesSampled: 1 }, competitorMetrics: { pagesSampled: 1 }, gaps: [], sourceReferences: [{ type: 'COMPETITOR_PAGE_SNAPSHOT', id: snapshot.id }] } });

    expect(comparison.competitorId).toBe(competitor.id);
    await expect(prisma.competitor.create({ data: { projectId: project.id, name: 'Duplicate', domain: competitor.domain } })).rejects.toThrow();
  });
});
