import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { IndexNowSubmissionService } from '../../src/modules/indexnow/indexnow.service.js';

describe('P9 IndexNow submission service', () => {
  it('persists an eligible project-local canonical URL before queueing', async () => {
    const suffix = randomUUID();
    const project = await prisma.project.create({ data: { name: 'P9 IndexNow', slug: `p9-indexnow-${suffix}`, primaryDomain: `${suffix}.example.com` } });
    try {
      const page = await prisma.page.create({ data: { projectId: project.id, url: `https://${project.primaryDomain}/guide`, normalizedUrl: `https://${project.primaryDomain}/guide`, host: project.primaryDomain, path: '/guide' } });
      const service = new IndexNowSubmissionService({ enqueue: async () => undefined });
      const batch = await service.create({ projectId: project.id, urls: [page.normalizedUrl], actorUserId: randomUUID() });

      expect(batch).toMatchObject({ projectId: project.id, status: 'QUEUED', urls: [expect.objectContaining({ url: page.normalizedUrl, status: 'QUEUED' })] });
    } finally { await prisma.project.delete({ where: { id: project.id } }); }
  });

  it('reuses one durable batch when the same project submits the same approved URLs again', async () => {
    const suffix = randomUUID();
    const project = await prisma.project.create({
      data: { name: 'P9 idempotency', slug: `p9-indexnow-idempotency-${suffix}`, primaryDomain: `${suffix}.example.com` }
    });
    try {
      const firstUrl = `https://${project.primaryDomain}/guide`;
      const secondUrl = `https://${project.primaryDomain}/about`;
      await prisma.page.createMany({ data: [
        { projectId: project.id, url: firstUrl, normalizedUrl: firstUrl, host: project.primaryDomain, path: '/guide' },
        { projectId: project.id, url: secondUrl, normalizedUrl: secondUrl, host: project.primaryDomain, path: '/about' }
      ] });
      const service = new IndexNowSubmissionService({ enqueue: async () => undefined });

      const first = await service.create({
        projectId: project.id,
        urls: [firstUrl, secondUrl],
        actorUserId: randomUUID()
      });
      const second = await service.create({
        projectId: project.id,
        urls: [secondUrl, firstUrl],
        actorUserId: randomUUID()
      });

      expect(second.id).toBe(first.id);
      expect(await prisma.indexNowSubmissionBatch.count({ where: { projectId: project.id } })).toBe(1);
      expect(await prisma.indexNowSubmissionUrl.count({ where: { batchId: first.id } })).toBe(2);
    } finally { await prisma.project.delete({ where: { id: project.id } }); }
  });

  it('rejects duplicate, foreign, and non-canonical URL input without changing crawl facts', async () => {
    const suffix = randomUUID();
    const project = await prisma.project.create({
      data: { name: 'P9 eligibility', slug: `p9-indexnow-eligibility-${suffix}`, primaryDomain: `${suffix}.example.com` }
    });
    const otherProject = await prisma.project.create({
      data: { name: 'P9 other', slug: `p9-indexnow-other-${suffix}`, primaryDomain: `other-${suffix}.example.com` }
    });
    try {
      const canonicalUrl = `https://${project.primaryDomain}/guide`;
      const foreignUrl = `https://${otherProject.primaryDomain}/guide`;
      await prisma.page.create({ data: { projectId: project.id, url: canonicalUrl, normalizedUrl: canonicalUrl, host: project.primaryDomain, path: '/guide' } });
      await prisma.page.create({ data: { projectId: otherProject.id, url: foreignUrl, normalizedUrl: foreignUrl, host: otherProject.primaryDomain, path: '/guide' } });
      const crawlRun = await prisma.crawlRun.create({
        data: {
          projectId: project.id,
          runType: 'MANUAL',
          status: 'COMPLETED',
          seedUrl: `https://${project.primaryDomain}/`,
          crawlerVersion: 'p9-test'
        }
      });
      const before = await prisma.crawlRun.findUniqueOrThrow({ where: { id: crawlRun.id } });
      const service = new IndexNowSubmissionService({ enqueue: async () => undefined });

      await expect(service.create({
        projectId: project.id,
        urls: [canonicalUrl, canonicalUrl],
        actorUserId: randomUUID()
      })).rejects.toMatchObject({ code: 'INDEXNOW_URL_NOT_ELIGIBLE' });
      await expect(service.create({
        projectId: project.id,
        urls: [foreignUrl],
        actorUserId: randomUUID()
      })).rejects.toMatchObject({ code: 'INDEXNOW_URL_NOT_ELIGIBLE' });
      await expect(service.create({
        projectId: project.id,
        urls: [`${canonicalUrl}?utm_source=test`],
        actorUserId: randomUUID()
      })).rejects.toMatchObject({ code: 'INDEXNOW_URL_NOT_ELIGIBLE' });

      expect(await prisma.indexNowSubmissionBatch.count({ where: { projectId: project.id } })).toBe(0);
      expect(await prisma.crawlRun.findUniqueOrThrow({ where: { id: crawlRun.id } })).toEqual(before);
    } finally {
      await prisma.project.deleteMany({ where: { id: { in: [project.id, otherProject.id] } } });
    }
  });

  it('requeues only a failed project-local batch for an explicit manual retry', async () => {
    const suffix = randomUUID();
    const project = await prisma.project.create({
      data: { name: 'P9 retry', slug: `p9-indexnow-retry-${suffix}`, primaryDomain: `${suffix}.example.com` }
    });
    try {
      const batch = await prisma.indexNowSubmissionBatch.create({
        data: {
          projectId: project.id,
          requestFingerprint: `retry-${suffix}`,
          status: 'FAILED',
          attemptCount: 3,
          errorCode: 'INDEXNOW_RETRY_EXHAUSTED',
          urls: { create: { url: `https://${project.primaryDomain}/guide`, status: 'FAILED', errorCode: 'INDEXNOW_RETRY_EXHAUSTED' } }
        }
      });
      const service = new IndexNowSubmissionService({ enqueue: async () => undefined });

      const retried = await service.retry({ projectId: project.id, batchId: batch.id });

      expect(retried).toMatchObject({
        id: batch.id,
        status: 'QUEUED',
        attemptCount: 3,
        errorCode: null,
        urls: [expect.objectContaining({ status: 'QUEUED', errorCode: null })]
      });
    } finally { await prisma.project.delete({ where: { id: project.id } }); }
  });
});
