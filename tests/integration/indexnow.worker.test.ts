import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { executeIndexNowBatch } from '../../src/modules/indexnow/indexnow.worker.js';

describe('P9 IndexNow worker', () => {
  it('fails closed when IndexNow configuration is absent', async () => {
    const suffix = randomUUID();
    const project = await prisma.project.create({ data: { name: 'P9 worker', slug: `p9-worker-${suffix}`, primaryDomain: `${suffix}.example.com` } });
    try {
      const batch = await prisma.indexNowSubmissionBatch.create({ data: { projectId: project.id, status: 'QUEUED', urls: { create: { url: `https://${project.primaryDomain}/guide`, status: 'QUEUED' } } } });
      await expect(executeIndexNowBatch(batch.id, { config: { key: undefined, keyLocation: undefined }, gateway: { submit: async () => { throw new Error('must not call gateway'); } } })).rejects.toMatchObject({ code: 'INDEXNOW_NOT_CONFIGURED' });
      expect(await prisma.indexNowSubmissionBatch.findUniqueOrThrow({ where: { id: batch.id } })).toMatchObject({ status: 'FAILED', errorCode: 'INDEXNOW_NOT_CONFIGURED' });
    } finally { await prisma.project.delete({ where: { id: project.id } }); }
  });
});
