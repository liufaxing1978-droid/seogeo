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
});
