import { AppError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';

export interface IndexNowGateway {
  submit(input: { host: string; key: string; keyLocation: string; urlList: string[] }): Promise<{ accepted: boolean; statusCode: number }>;
}

export async function executeIndexNowBatch(
  batchId: string,
  dependencies: { config: { key?: string; keyLocation?: string }; gateway: IndexNowGateway },
) {
  const batch = await prisma.indexNowSubmissionBatch.findUnique({ where: { id: batchId }, include: { project: true, urls: true } });
  if (!batch) throw new AppError('IndexNow batch not found', 404, 'INDEXNOW_BATCH_NOT_FOUND');
  if (!dependencies.config.key || !dependencies.config.keyLocation) {
    await prisma.indexNowSubmissionBatch.update({ where: { id: batch.id }, data: { status: 'FAILED', errorCode: 'INDEXNOW_NOT_CONFIGURED', errorMessage: 'IndexNow key and key location are required' } });
    throw new AppError('IndexNow is not configured', 503, 'INDEXNOW_NOT_CONFIGURED');
  }
  const response = await dependencies.gateway.submit({ host: batch.project.primaryDomain, key: dependencies.config.key, keyLocation: dependencies.config.keyLocation, urlList: batch.urls.map((item) => item.url) });
  if (!response.accepted) {
    await prisma.indexNowSubmissionBatch.update({ where: { id: batch.id }, data: { status: 'FAILED', errorCode: 'INDEXNOW_REJECTED', errorMessage: `IndexNow returned ${response.statusCode}` } });
    throw new AppError('IndexNow rejected the submission', 502, 'INDEXNOW_REJECTED');
  }
  return prisma.indexNowSubmissionBatch.update({ where: { id: batch.id }, data: { status: 'COMPLETED', attemptCount: { increment: 1 }, urls: { updateMany: { where: {}, data: { status: 'COMPLETED' } } } }, include: { urls: true } });
}
