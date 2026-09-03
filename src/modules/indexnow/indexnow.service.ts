import { AppError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';

export interface IndexNowQueue {
  enqueue(batchId: string): Promise<void>;
}

export class IndexNowSubmissionService {
  constructor(private readonly queue: IndexNowQueue) {}

  async create(input: { projectId: string; urls: string[]; actorUserId: string }) {
    const urls = [...new Set(input.urls)];
    if (!urls.length) throw new AppError('At least one URL is required', 400, 'INDEXNOW_URL_REQUIRED');
    const pages = await prisma.page.findMany({ where: { projectId: input.projectId, normalizedUrl: { in: urls }, isActive: true }, select: { normalizedUrl: true } });
    if (pages.length !== urls.length) throw new AppError('URL is not eligible for IndexNow submission', 400, 'INDEXNOW_URL_NOT_ELIGIBLE');
    const batch = await prisma.indexNowSubmissionBatch.create({
      data: { projectId: input.projectId, createdByUserId: input.actorUserId, status: 'PENDING', urls: { create: urls.map((url) => ({ url, status: 'PENDING' })) } },
      include: { urls: true },
    });
    try {
      await this.queue.enqueue(batch.id);
      return prisma.indexNowSubmissionBatch.update({ where: { id: batch.id }, data: { status: 'QUEUED', urls: { updateMany: { where: {}, data: { status: 'QUEUED' } } } }, include: { urls: true } });
    } catch (error) {
      await prisma.indexNowSubmissionBatch.update({ where: { id: batch.id }, data: { status: 'FAILED', errorCode: 'INDEXNOW_QUEUE_FAILED', errorMessage: 'Failed to enqueue IndexNow submission' } });
      throw error;
    }
  }
}
