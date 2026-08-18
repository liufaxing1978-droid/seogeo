import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { seoRepository } from '../../src/modules/seo/seo.repository.js';

describe('SEO audit input repository', () => {
  beforeEach(async () => {
    await prisma.project.deleteMany();
  });

  it('loads only the PageSnapshot facts belonging to the audit selected crawl run', async () => {
    const project = await prisma.project.create({
      data: {
        name: 'Audit Input Fixture',
        slug: `audit-input-${Date.now()}`,
        primaryDomain: 'example.com'
      }
    });
    const selectedCrawl = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: 'https://example.com/',
        crawlerVersion: '0.1.0'
      }
    });
    const laterCrawl = await prisma.crawlRun.create({
      data: {
        projectId: project.id,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: 'https://example.com/',
        crawlerVersion: '0.1.0'
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
        crawlRunId: selectedCrawl.id,
        finalUrl: 'https://example.com/',
        statusCode: 200,
        contentType: 'text/html',
        title: 'Selected crawl title',
        metaDescription: 'Selected crawl description',
        h1: 'Selected heading',
        h1Count: 1,
        wordCount: 350,
        imagesCount: 1,
        imagesWithoutAlt: 0,
        responseTimeMs: 300,
        htmlSizeBytes: 12000,
        indexable: true,
        parserVersion: '0.1.0',
        httpResult: {
          create: {
            requestUrl: 'http://example.com/',
            finalUrl: 'https://example.com/',
            statusCode: 200,
            redirectChain: [{ from: 'http://example.com/', to: 'https://example.com/', statusCode: 301 }],
            responseBytes: 12000,
            latencyMs: 300
          }
        }
      }
    });

    await prisma.pageSnapshot.create({
      data: {
        pageId: page.id,
        crawlRunId: laterCrawl.id,
        finalUrl: 'https://example.com/',
        statusCode: 200,
        contentType: 'text/html',
        title: 'Later crawl title must not leak',
        metaDescription: 'Later description',
        h1: 'Later heading',
        h1Count: 1,
        wordCount: 900,
        imagesCount: 0,
        imagesWithoutAlt: 0,
        responseTimeMs: 100,
        htmlSizeBytes: 9000,
        indexable: true,
        parserVersion: '0.1.0'
      }
    });

    await prisma.robotsResult.create({
      data: {
        crawlRunId: selectedCrawl.id,
        url: 'https://example.com/robots.txt',
        statusCode: 200,
        rawText: 'User-agent: *\nAllow: /'
      }
    });
    await prisma.sitemapSource.create({
      data: {
        crawlRunId: selectedCrawl.id,
        url: 'https://example.com/sitemap.xml',
        statusCode: 200,
        type: 'URLSET',
        discoveredUrlCount: 1
      }
    });

    const audit = await prisma.seoAuditRun.create({
      data: {
        projectId: project.id,
        crawlRunId: selectedCrawl.id,
        status: 'QUEUED',
        engineVersion: '0.1.0'
      }
    });

    const input = await seoRepository.getAuditInput(audit.id);

    expect(input.crawlRunId).toBe(selectedCrawl.id);
    expect(input.pages).toHaveLength(1);
    expect(input.pages[0]).toMatchObject({
      pageId: page.id,
      title: 'Selected crawl title',
      redirectCount: 1,
      responseTimeMs: 300,
      htmlSizeBytes: 12000
    });
    expect(input.pages[0]?.title).not.toBe('Later crawl title must not leak');
    expect(input.robots).toEqual([{ statusCode: 200, parseError: null }]);
    expect(input.sitemaps).toEqual([
      { statusCode: 200, type: 'URLSET', parseError: null, discoveredUrlCount: 1 }
    ]);
  });
});
