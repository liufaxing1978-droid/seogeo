import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { contentRepository } from '../../src/modules/content/content.repository.js';
import { buildContentFacts } from '../../src/modules/content/content-facts.js';

describe('content repository refresh sources', () => {
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let projectId = '';
  let pageId = '';

  beforeAll(async () => {
    const project = await prisma.project.create({
      data: {
        name: `Content facts ${suffix}`,
        slug: `content-facts-${suffix}`,
        primaryDomain: `content-${suffix}.example.com`
      }
    });
    projectId = project.id;

    const crawl = await prisma.crawlRun.create({
      data: {
        projectId,
        runType: 'MANUAL',
        status: 'COMPLETED',
        seedUrl: `https://${project.primaryDomain}/`,
        crawlerVersion: 'test'
      }
    });

    const page = await prisma.page.create({
      data: {
        projectId,
        url: `https://${project.primaryDomain}/guide`,
        normalizedUrl: `https://${project.primaryDomain}/guide`,
        host: project.primaryDomain,
        path: '/guide'
      }
    });
    pageId = page.id;

    await prisma.pageSnapshot.create({
      data: {
        pageId,
        crawlRunId: crawl.id,
        finalUrl: page.url,
        title: 'Older',
        h1Count: 1,
        h2Count: 1,
        h3Count: 0,
        wordCount: 300,
        imagesCount: 1,
        internalLinksCount: 2,
        externalLinksCount: 0,
        contentHash: `old-${suffix}`,
        capturedAt: new Date('2026-08-18T00:00:00Z'),
        parserVersion: 'test'
      }
    });

    await prisma.pageSnapshot.create({
      data: {
        pageId,
        crawlRunId: crawl.id,
        finalUrl: page.url,
        title: 'Latest',
        canonicalUrl: page.url,
        h1: 'Latest',
        h1Count: 1,
        h2Count: 2,
        h3Count: 1,
        wordCount: 900,
        imagesCount: 3,
        internalLinksCount: 5,
        externalLinksCount: 1,
        contentHash: `latest-${suffix}`,
        capturedAt: new Date('2026-08-19T00:00:00Z'),
        parserVersion: 'test'
      }
    });
  });

  afterAll(async () => {
    if (projectId) await prisma.project.delete({ where: { id: projectId } }).catch(() => undefined);
  });

  it('returns only the latest owned page snapshot and upserts one content document', async () => {
    const sources = await contentRepository.listLatestOwnedPageSources(projectId);
    expect(sources).toHaveLength(1);
    expect(sources[0]?.title).toBe('Latest');
    expect(sources[0]?.contentHash).toContain('latest-');

    const document = await contentRepository.upsertContentDocument(buildContentFacts(sources[0]!));
    expect(document.projectId).toBe(projectId);
    expect(document.pageId).toBe(pageId);
    expect(document.headingCount).toBe(4);

    const again = await contentRepository.upsertContentDocument(buildContentFacts(sources[0]!));
    expect(again.id).toBe(document.id);
    expect(await prisma.contentDocument.count({ where: { projectId, pageId } })).toBe(1);
  });
});
