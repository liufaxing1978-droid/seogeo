import { createHash } from 'node:crypto';
import { AppError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';

export interface IndexNowQueue {
  enqueue(batchId: string): Promise<void>;
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
}
