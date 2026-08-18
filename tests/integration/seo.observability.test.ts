import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { executeSeoAudit } from '../../src/modules/seo/audit-engine.js';

beforeEach(async () => {
  await prisma.project.deleteMany();
});

describe('SEO audit observability', () => {
  it('emits structured lifecycle summaries without raw page content', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'SEO Observability Fixture',
        slug: `seo-observe-${Date.now()}-${Math.random()}`,
        primaryDomain: 'example.com'
      }
    });
    const crawl = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: 'https://example.com/',
        crawlerVersion: '0.1.0',
        finishedAt: new Date()
      }
    });
    const page = await prisma.page.create({
      data: {
        projectId: project.id,
        url: 'https://example.com/',
        normalizedUrl: 'https://example.com/',
        host: 'example.com',
        path: '/'
      }
    });
    await prisma.pageSnapshot.create({
      data: {
        pageId: page.id,
        crawlRunId: crawl.id,
        finalUrl: page.normalizedUrl,
        statusCode: 200,
        contentType: 'text/html',
        title: null,
        metaDescription: 'A complete description.',
        canonicalUrl: page.normalizedUrl,
        h1: 'Fixture heading',
        h1Count: 1,
        wordCount: 500,
        imagesCount: 0,
        imagesWithoutAlt: 0,
        responseTimeMs: 200,
        htmlSizeBytes: 12000,
        indexable: true,
        parserVersion: '0.1.0'
      }
    });
    await prisma.robotsResult.create({
      data: {
        crawlRunId: crawl.id,
        url: 'https://example.com/robots.txt',
        statusCode: 404
      }
    });
    await prisma.sitemapSource.create({
      data: {
        crawlRunId: crawl.id,
        url: 'https://example.com/sitemap.xml',
        statusCode: 200,
        type: 'URLSET',
        discoveredUrlCount: 1
      }
    });
    const audit = await prisma.seoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: crawl.id,
        status: 'QUEUED',
        engineVersion: '0.1.0'
      }
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await executeSeoAudit(audit.id);
    } finally {
      // Assertions read captured calls before restoring below.
    }

    const entries = logSpy.mock.calls.map(([entry]) => entry);
    logSpy.mockRestore();

    const events = entries
      .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
      .map((entry) => entry.event);

    expect(events).toEqual(
      expect.arrayContaining([
        'seo.audit.started',
        'seo.rule.evaluated.summary',
        'seo.issues.synced',
        'seo.score.calculated',
        'seo.audit.completed'
      ])
    );

    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain('A complete description.');
    expect(serialized).not.toContain('Fixture heading');
    expect(serialized).not.toContain('<html');
  });
});
