import { createHash } from 'node:crypto';
import { Queue } from 'bullmq';
import { AppError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { createRedisConnection } from '../../queue/connection.js';
import { IndexNowSubmissionQueue, type IndexNowSubmissionJobData } from './indexnow.queue.js';

export interface IndexNowQueue {
  enqueue(batchId: string): Promise<void>;
}

class LazyBullIndexNowQueue implements IndexNowQueue {
  private queue: Queue<IndexNowSubmissionJobData> | null = null;

  private getQueue() {
    if (!this.queue) {
      this.queue = new Queue<IndexNowSubmissionJobData>('indexnow-submission', {
        connection: createRedisConnection()
      });
    }
    return this.queue;
  }

  enqueue(batchId: string): Promise<void> {
    return new IndexNowSubmissionQueue(this.getQueue()).enqueue(batchId);
  }
}

export class IndexNowSubmissionService {
  constructor(private readonly queue: IndexNowQueue) {}

  async create(input: { projectId: string; urls: string[]; actorUserId: string }) {
    const urls = [...input.urls].sort((left, right) => left.localeCompare(right));
    if (!urls.length) throw new AppError('At least one URL is required', 400, 'INDEXNOW_URL_REQUIRED');
    if (urls.some((url) => !url.trim()) || new Set(urls).size !== urls.length) {
      throw new AppError('URL is not eligible for IndexNow submission', 400, 'INDEXNOW_URL_NOT_ELIGIBLE');
    }
    const pages = await prisma.page.findMany({ where: { projectId: input.projectId, normalizedUrl: { in: urls }, isActive: true }, select: { normalizedUrl: true } });
    if (pages.length !== urls.length) throw new AppError('URL is not eligible for IndexNow submission', 400, 'INDEXNOW_URL_NOT_ELIGIBLE');
    const requestFingerprint = createHash('sha256')
      .update(JSON.stringify({ version: 'P9_INDEXNOW_SUBMISSION_V1', urls }))
      .digest('hex');
    const existing = await prisma.indexNowSubmissionBatch.findUnique({
      where: { projectId_requestFingerprint: { projectId: input.projectId, requestFingerprint } },
      include: { urls: true }
    });
    if (existing) return existing;

    let batch;
    try {
      batch = await prisma.indexNowSubmissionBatch.create({
        data: {
          projectId: input.projectId,
          requestFingerprint,
          createdByUserId: input.actorUserId,
          status: 'PENDING',
          urls: { create: urls.map((url) => ({ url, status: 'PENDING' })) }
        },
        include: { urls: true }
      });
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'P2002')) throw error;
      return prisma.indexNowSubmissionBatch.findUniqueOrThrow({
        where: { projectId_requestFingerprint: { projectId: input.projectId, requestFingerprint } },
        include: { urls: true }
      });
    }
    try {
      await this.queue.enqueue(batch.id);
      return prisma.indexNowSubmissionBatch.update({ where: { id: batch.id }, data: { status: 'QUEUED', urls: { updateMany: { where: {}, data: { status: 'QUEUED' } } } }, include: { urls: true } });
    } catch (error) {
      await prisma.indexNowSubmissionBatch.update({ where: { id: batch.id }, data: { status: 'FAILED', errorCode: 'INDEXNOW_QUEUE_FAILED', errorMessage: 'Failed to enqueue IndexNow submission' } });
      throw error;
    }
  }

  async retry(input: { projectId: string; batchId: string }) {
    const batch = await prisma.indexNowSubmissionBatch.findFirst({
      where: { id: input.batchId, projectId: input.projectId },
      include: { urls: true }
    });
    if (!batch) throw new AppError('IndexNow submission batch not found', 404, 'INDEXNOW_BATCH_NOT_FOUND');
    if (batch.status !== 'FAILED') {
      throw new AppError('Only a failed IndexNow batch can be retried', 409, 'INDEXNOW_RETRY_NOT_ALLOWED');
    }

    await prisma.indexNowSubmissionBatch.update({
      where: { id: batch.id },
      data: {
        status: 'PENDING',
        responseStatusCode: null,
        errorCode: null,
        errorMessage: null,
        urls: { updateMany: { where: {}, data: { status: 'PENDING', errorCode: null } } }
      }
    });
    try {
      await this.queue.enqueue(batch.id);
      return prisma.indexNowSubmissionBatch.update({
        where: { id: batch.id },
        data: { status: 'QUEUED', urls: { updateMany: { where: {}, data: { status: 'QUEUED' } } } },
        include: { urls: true }
      });
    } catch (error) {
      await prisma.indexNowSubmissionBatch.update({
        where: { id: batch.id },
        data: {
          status: 'FAILED',
          errorCode: 'INDEXNOW_QUEUE_FAILED',
          errorMessage: 'Failed to enqueue IndexNow submission',
          urls: { updateMany: { where: {}, data: { status: 'FAILED', errorCode: 'INDEXNOW_QUEUE_FAILED' } } }
        }
      });
      throw error;
    }
  }
}

export const indexNowSubmissionService = new IndexNowSubmissionService(new LazyBullIndexNowQueue());
