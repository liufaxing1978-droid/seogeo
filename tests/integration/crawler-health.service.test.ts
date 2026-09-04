import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { CrawlerHealthService } from '../../src/modules/crawler/crawler-health.service.js';

describe('P9 crawler health projection', () => {
  it('projects degraded health from completed crawler facts without modifying sitemap facts', async () => {
    const suffix = randomUUID();
    const project = await prisma.project.create({ data: { name: 'P9 health', slug: `p9-health-${suffix}`, primaryDomain: `${suffix}.example.com` } });
    try {
      const run = await prisma.crawlRun.create({ data: { projectId: project.id, runType: 'MANUAL', status: 'COMPLETED', seedUrl: `https://${project.primaryDomain}`, crawlerVersion: 'test', pagesDiscovered: 2, pagesCrawled: 2, pagesSucceeded: 1, pagesFailed: 1, finishedAt: new Date() } });
      const sitemap = await prisma.sitemapSource.create({ data: { crawlRunId: run.id, url: `https://${project.primaryDomain}/sitemap.xml`, statusCode: 200, type: 'URLSET', parseError: null, discoveredUrlCount: 2 } });
      const before = await prisma.sitemapSource.findUniqueOrThrow({ where: { id: sitemap.id } });

      const snapshot = await new CrawlerHealthService().project(run.id);

      expect(snapshot).toMatchObject({ projectId: project.id, crawlRunId: run.id, status: 'DEGRADED', calculationVersion: 'P9_CRAWLER_HEALTH_V1' });
      expect(await prisma.sitemapSource.findUniqueOrThrow({ where: { id: sitemap.id } })).toEqual(before);
    } finally { await prisma.project.delete({ where: { id: project.id } }); }
  });
});
