import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { executeCompetitorCrawl } from '../../src/modules/competitor/competitor.worker.js';

function html(title: string, links: string[]) {
  return `<html><head><title>${title}</title><meta name="description" content="description"><script type="application/ld+json">{"@type":"Article","name":"${title}"}</script></head><body><h1>${title}</h1><h2>Section</h2><p>${'word '.repeat(700)}</p>${links.map((link) => `<a href="${link}">link</a>`).join('')}</body></html>`;
}

describe('P5-B competitor crawl worker', () => {
  const projects: string[] = [];
  afterAll(async () => { for (const id of projects) await prisma.project.delete({ where: { id } }).catch(() => undefined); });

  it('crawls same-host pages only and respects maxPages', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({ data: { name: 'cmp-worker', slug: `cmp-worker-${suffix}`, primaryDomain: `owned-${suffix}.example.com` } });
    projects.push(project.id);
    const competitor = await prisma.competitor.create({ data: { projectId: project.id, name: 'Rival', domain: `rival-${suffix}.example.com` } });
    const crawl = await prisma.competitorCrawl.create({ data: { competitorId: competitor.id, seedUrl: `https://${competitor.domain}/`, maxPages: 2, crawlerVersion: 'test' } });
    const pages: Record<string, string> = {
      [`https://${competitor.domain}/`]: html('Home', ['/a', 'https://outside.example.com/x']),
      [`https://${competitor.domain}/a`]: html('A', ['/b']),
      [`https://${competitor.domain}/b`]: html('B', [])
    };

    await executeCompetitorCrawl(crawl.id, {
      fetcher: async (url) => ({ requestUrl: url, finalUrl: url, statusCode: 200, headers: { 'content-type': 'text/html' }, body: pages[url] ?? html('Missing', []), contentType: 'text/html', bytes: 100, responseTimeMs: 1, redirectChain: [], errorCode: null })
    });

    const updated = await prisma.competitorCrawl.findUniqueOrThrow({ where: { id: crawl.id } });
    const snapshots = await prisma.competitorPageSnapshot.findMany({ where: { competitorCrawlId: crawl.id }, orderBy: { normalizedUrl: 'asc' } });
    expect(updated.status).toBe('COMPLETED');
    expect(updated.pagesCrawled).toBe(2);
    expect(snapshots).toHaveLength(2);
    expect(snapshots.every((snapshot) => new URL(snapshot.normalizedUrl).hostname === competitor.domain)).toBe(true);
  });
});
