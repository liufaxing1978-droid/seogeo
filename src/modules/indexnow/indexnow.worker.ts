import { AppError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { indexNowRuntimeConfig, type IndexNowRuntimeConfig } from './indexnow.config.js';
import { IndexNowHttpGateway } from './indexnow.gateway.js';
import type { IndexNowSubmissionJobData } from './indexnow.queue.js';

export interface IndexNowGateway {
  submit(input: {
    host: string;
    key: string;
    keyLocation: string;
    urlList: string[];
  }): Promise<{ accepted: boolean; statusCode: number; retryable?: boolean }>;
}

export interface IndexNowExecutionContext {
  attemptNumber: number;
  maxAttempts: number;
}

type GatewayFailure = Error & { code?: string; retryable?: boolean };

export type IndexNowJobLike = {
  data: IndexNowSubmissionJobData;
  attemptsMade: number;
  opts: { attempts?: number };
};

export type IndexNowWorkerDependencies = {
  config: Pick<IndexNowRuntimeConfig, 'key' | 'keyLocation'>;
  gateway: IndexNowGateway;
};

function defaultDependencies(): IndexNowWorkerDependencies {
  return {
    config: indexNowRuntimeConfig,
    gateway: new IndexNowHttpGateway({
      endpoint: indexNowRuntimeConfig.endpoint,
      timeoutMs: indexNowRuntimeConfig.timeoutMs
    })
  };
}

function boundedContext(input?: Partial<IndexNowExecutionContext>): IndexNowExecutionContext {
  const maxAttempts = Math.max(1, input?.maxAttempts ?? 3);
  return {
    attemptNumber: Math.min(maxAttempts, Math.max(1, input?.attemptNumber ?? 1)),
    maxAttempts
  };
}

async function markFailed(
  batchId: string,
  attemptCount: number,
  code: string,
  message: string,
  responseStatusCode?: number
) {
  return prisma.indexNowSubmissionBatch.update({
    where: { id: batchId },
    data: {
      status: 'FAILED',
      attemptCount,
      responseStatusCode: responseStatusCode ?? null,
      errorCode: code,
      errorMessage: message,
      urls: { updateMany: { where: {}, data: { status: 'FAILED', errorCode: code } } }
    },
    include: { urls: true }
  });
}

async function markRetryable(
  batchId: string,
  attemptCount: number,
  code: string,
  message: string,
  responseStatusCode?: number
) {
  await prisma.indexNowSubmissionBatch.update({
    where: { id: batchId },
    data: {
      status: 'QUEUED',
      attemptCount,
      responseStatusCode: responseStatusCode ?? null,
      errorCode: code,
      errorMessage: message
    }
  });
}

export async function executeIndexNowBatch(
  batchId: string,
  dependencies: IndexNowWorkerDependencies,
  executionInput?: Partial<IndexNowExecutionContext>
) {
  const execution = boundedContext(executionInput);
  const batch = await prisma.indexNowSubmissionBatch.findUnique({
    where: { id: batchId },
    include: { project: true, urls: true }
  });
  if (!batch) throw new AppError('IndexNow batch not found', 404, 'INDEXNOW_BATCH_NOT_FOUND');
  const attemptCount = Math.max(batch.attemptCount + 1, execution.attemptNumber);

  if (!dependencies.config.key || !dependencies.config.keyLocation) {
    await markFailed(
      batch.id,
      attemptCount,
      'INDEXNOW_NOT_CONFIGURED',
      'IndexNow key and key location are required'
    );
    throw new AppError('IndexNow is not configured', 503, 'INDEXNOW_NOT_CONFIGURED');
  }

  let response: Awaited<ReturnType<IndexNowGateway['submit']>>;
  try {
    response = await dependencies.gateway.submit({
      host: batch.project.primaryDomain,
      key: dependencies.config.key,
      keyLocation: dependencies.config.keyLocation,
      urlList: batch.urls.map((item) => item.url)
    });
  } catch (error) {
    const failure = error as GatewayFailure;
    const code = typeof failure.code === 'string' ? failure.code : 'INDEXNOW_NETWORK_ERROR';
    const message = code === 'INDEXNOW_TIMEOUT'
      ? 'IndexNow request timed out'
      : 'IndexNow request failed';
    if (failure.retryable !== false && execution.attemptNumber < execution.maxAttempts) {
      await markRetryable(batch.id, attemptCount, code, message);
      throw error;
    }
    await markFailed(batch.id, attemptCount, 'INDEXNOW_RETRY_EXHAUSTED', message);
    throw new AppError(message, 502, 'INDEXNOW_RETRY_EXHAUSTED');
  }

  if (!response.accepted) {
    const retryable = response.retryable
      ?? (response.statusCode === 429 || response.statusCode >= 500);
    if (retryable && execution.attemptNumber < execution.maxAttempts) {
      await markRetryable(
        batch.id,
        attemptCount,
        'INDEXNOW_TRANSIENT_FAILURE',
        `IndexNow returned HTTP ${response.statusCode}`,
        response.statusCode
      );
      throw new AppError('IndexNow temporarily rejected the submission', 502, 'INDEXNOW_TRANSIENT_FAILURE');
    }

    const code = retryable ? 'INDEXNOW_RETRY_EXHAUSTED' : 'INDEXNOW_REJECTED';
    await markFailed(
      batch.id,
      attemptCount,
      code,
      `IndexNow returned HTTP ${response.statusCode}`,
      response.statusCode
    );
    throw new AppError(
      retryable ? 'IndexNow retry budget exhausted' : 'IndexNow rejected the submission',
      502,
      code
    );
  }

  return prisma.indexNowSubmissionBatch.update({
    where: { id: batch.id },
    data: {
      status: 'COMPLETED',
      attemptCount,
      responseStatusCode: response.statusCode,
      errorCode: null,
      errorMessage: null,
      urls: { updateMany: { where: {}, data: { status: 'COMPLETED', errorCode: null } } }
    },
    include: { urls: true }
  });
}

export async function processIndexNowSubmissionJob(
  job: IndexNowJobLike,
  dependencies: IndexNowWorkerDependencies = defaultDependencies()
) {
  if (!job.data.batchId?.trim()) {
    throw new AppError('IndexNow batch id is required', 400, 'INDEXNOW_BATCH_ID_REQUIRED');
  }
  return executeIndexNowBatch(job.data.batchId, dependencies, {
    attemptNumber: job.attemptsMade + 1,
    maxAttempts: job.opts.attempts ?? 3
  });
}
