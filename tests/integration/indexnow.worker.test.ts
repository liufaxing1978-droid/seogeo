import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { prisma } from '../../src/db/prisma.js';
import { IndexNowGatewayError } from '../../src/modules/indexnow/indexnow.gateway.js';
import {
  executeIndexNowBatch,
  processIndexNowSubmissionJob
} from '../../src/modules/indexnow/indexnow.worker.js';

async function createQueuedBatch(label: string) {
  const suffix = randomUUID();
  const project = await prisma.project.create({
    data: { name: label, slug: `p9-worker-${suffix}`, primaryDomain: `${suffix}.example.com` }
  });
  const batch = await prisma.indexNowSubmissionBatch.create({
    data: {
      projectId: project.id,
      status: 'QUEUED',
      urls: {
        create: [
          { url: `https://${project.primaryDomain}/guide`, status: 'QUEUED' },
          { url: `https://${project.primaryDomain}/about`, status: 'QUEUED' }
        ]
      }
    }
  });
  return { project, batch };
}

const configured = {
  key: 'test-key',
  keyLocation: 'https://example.com/test-key.txt'
};

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

  it('completes the batch and every URL after an accepted response', async () => {
    const { project, batch } = await createQueuedBatch('P9 accepted');
    try {
      const completed = await executeIndexNowBatch(batch.id, {
        config: configured,
        gateway: { submit: async () => ({ accepted: true, statusCode: 202, retryable: false }) }
      }, { attemptNumber: 1, maxAttempts: 3 });

      expect(completed).toMatchObject({
        status: 'COMPLETED',
        attemptCount: 1,
        errorCode: null,
        responseStatusCode: 202,
        urls: [
          expect.objectContaining({ status: 'COMPLETED' }),
          expect.objectContaining({ status: 'COMPLETED' })
        ]
      });
    } finally { await prisma.project.delete({ where: { id: project.id } }); }
  });

  it('keeps a transiently rejected batch queued before the retry budget is exhausted', async () => {
    const { project, batch } = await createQueuedBatch('P9 transient');
    try {
      await expect(executeIndexNowBatch(batch.id, {
        config: configured,
        gateway: { submit: async () => ({ accepted: false, statusCode: 429, retryable: true }) }
      }, { attemptNumber: 1, maxAttempts: 3 })).rejects.toMatchObject({
        code: 'INDEXNOW_TRANSIENT_FAILURE'
      });

      const persisted = await prisma.indexNowSubmissionBatch.findUniqueOrThrow({
        where: { id: batch.id }, include: { urls: true }
      });
      expect(persisted).toMatchObject({
        status: 'QUEUED',
        attemptCount: 1,
        errorCode: 'INDEXNOW_TRANSIENT_FAILURE',
        urls: [
          expect.objectContaining({ status: 'QUEUED' }),
          expect.objectContaining({ status: 'QUEUED' })
        ]
      });
    } finally { await prisma.project.delete({ where: { id: project.id } }); }
  });

  it('marks the batch and every URL failed when the transient retry budget is exhausted', async () => {
    const { project, batch } = await createQueuedBatch('P9 exhausted');
    try {
      await expect(processIndexNowSubmissionJob({
        data: { batchId: batch.id },
        attemptsMade: 2,
        opts: { attempts: 3 }
      }, {
        config: configured,
        gateway: { submit: async () => ({ accepted: false, statusCode: 503, retryable: true }) }
      })).rejects.toMatchObject({
        code: 'INDEXNOW_RETRY_EXHAUSTED'
      });

      const persisted = await prisma.indexNowSubmissionBatch.findUniqueOrThrow({
        where: { id: batch.id }, include: { urls: true }
      });
      expect(persisted).toMatchObject({
        status: 'FAILED',
        attemptCount: 3,
        errorCode: 'INDEXNOW_RETRY_EXHAUSTED',
        urls: [
          expect.objectContaining({ status: 'FAILED', errorCode: 'INDEXNOW_RETRY_EXHAUSTED' }),
          expect.objectContaining({ status: 'FAILED', errorCode: 'INDEXNOW_RETRY_EXHAUSTED' })
        ]
      });
    } finally { await prisma.project.delete({ where: { id: project.id } }); }
  });

  it('keeps a transport failure queued while a bounded retry remains', async () => {
    const { project, batch } = await createQueuedBatch('P9 network');
    try {
      await expect(executeIndexNowBatch(batch.id, {
        config: configured,
        gateway: {
          submit: async () => {
            throw new IndexNowGatewayError('IndexNow request failed', 'INDEXNOW_NETWORK_ERROR', true);
          }
        }
      }, { attemptNumber: 2, maxAttempts: 3 })).rejects.toMatchObject({
        code: 'INDEXNOW_NETWORK_ERROR',
        retryable: true
      });

      expect(await prisma.indexNowSubmissionBatch.findUniqueOrThrow({
        where: { id: batch.id }
      })).toMatchObject({
        status: 'QUEUED',
        attemptCount: 2,
        errorCode: 'INDEXNOW_NETWORK_ERROR',
        errorMessage: 'IndexNow request failed'
      });
    } finally { await prisma.project.delete({ where: { id: project.id } }); }
  });

  it('fails permanently rejected submissions without consuming further retries', async () => {
    const { project, batch } = await createQueuedBatch('P9 rejected');
    try {
      await expect(executeIndexNowBatch(batch.id, {
        config: configured,
        gateway: { submit: async () => ({ accepted: false, statusCode: 403, retryable: false }) }
      }, { attemptNumber: 1, maxAttempts: 3 })).rejects.toMatchObject({
        code: 'INDEXNOW_REJECTED'
      });

      const persisted = await prisma.indexNowSubmissionBatch.findUniqueOrThrow({
        where: { id: batch.id }, include: { urls: true }
      });
      expect(persisted).toMatchObject({
        status: 'FAILED',
        attemptCount: 1,
        errorCode: 'INDEXNOW_REJECTED',
        responseStatusCode: 403,
        urls: [
          expect.objectContaining({ status: 'FAILED', errorCode: 'INDEXNOW_REJECTED' }),
          expect.objectContaining({ status: 'FAILED', errorCode: 'INDEXNOW_REJECTED' })
        ]
      });
    } finally { await prisma.project.delete({ where: { id: project.id } }); }
  });
});
