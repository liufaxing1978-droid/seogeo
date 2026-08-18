import type { Job } from 'bullmq';
import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { processContentRefreshJob, type ContentRefreshJobData } from '../../src/modules/content/content.worker.js';

describe('P5-A content refresh worker', () => {
  const projects: string[] = [];
  afterAll(async () => {
    for (const id of projects) await prisma.project.delete({ where: { id } }).catch(() => undefined);
  });

  it('materializes content facts from persisted snapshots only', async () => {
    const suffix = `${Date.now()}-${Math.random()}`;
    const project = await prisma.project.create({ data: { name: 'worker', slug: `worker-${suffix}`, primaryDomain: `worker-${suffix}.example.com` } });
    projects.push(project.id);
    const crawl = await prisma.crawlRun.create({ data: { projectId: project.id, runType: 'MANUAL', status: 'COMPLETED', seedUrl: `https://${project.primaryDomain}`, crawlerVersion: 'test' } });
    const page = await prisma.page.create({ data: { projectId: project.id, url: `https://${project.primaryDomain}/a`, normalizedUrl: `https://${project.primaryDomain}/a`, host: project.primaryDomain, path: '/a' } });
    await prisma.pageSnapshot.create({ data: { pageId: page.id, crawlRunId: crawl.id, finalUrl: page.url, title: 'Worker page', h1: 'Worker page', h1Count: 1, h2Count: 2, h3Count: 0, wordCount: 800, internalLinksCount: 4, contentHash: `hash-${suffix}`, parserVersion: 'test' } });

    const result = await processContentRefreshJob({ data: { projectId: project.id } } as Job<ContentRefreshJobData>);
    expect(result.documentsUpdated).toBe(1);
    expect(result.opportunitiesEvaluated).toBe(9);
    expect(await prisma.contentDocument.count({ where: { projectId: project.id } })).toBe(1);
    expect(await prisma.contentSignal.count({ where: { projectId: project.id } })).toBe(9);
  });
});
