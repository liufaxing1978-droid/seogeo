import { prisma } from '../../db/prisma.js';
import {
  VisibilityExtractionError,
  VisibilityExtractionService
} from './visibility-extraction.service.js';
import {
  VisibilityExtractionQueue,
  type BackfillVisibilityProjectJobData,
  type ExtractVisibilityObservationJobData
} from './visibility-extraction.queue.js';
import { emitVisibilityIntelligenceEvent } from './visibility-intelligence.observability.js';

const DEFAULT_BACKFILL_LIMIT = 50;
const MAX_BACKFILL_LIMIT = 100;
const TERMINAL_OBSERVATION_STATUSES = [
  'COMPLETED',
  'REFUSED',
  'UNSUPPORTED',
  'FAILED',
  'INCOMPLETE',
  'BUDGET_SKIPPED'
] as const;

export interface VisibilityExtractionJobLike {
  name: string;
  data: Record<string, unknown>;
}

export interface VisibilityExtractionWorkerDependencies {
  extractionService?: Pick<VisibilityExtractionService, 'extractObservation'>;
  queue?: VisibilityExtractionQueue;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new VisibilityExtractionError(
      'VISIBILITY_EXTRACTION_JOB_INVALID',
      `${field} is required for visibility extraction jobs`
    );
  }
  return value;
}

function backfillLimit(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    return DEFAULT_BACKFILL_LIMIT;
  }
  return Math.min(value, MAX_BACKFILL_LIMIT);
}

function extractJobData(data: Record<string, unknown>): ExtractVisibilityObservationJobData {
  return {
    projectId: requiredString(data.projectId, 'projectId'),
    observationId: requiredString(data.observationId, 'observationId'),
    extractorVersion: requiredString(data.extractorVersion, 'extractorVersion'),
    subjectSetHash: requiredString(data.subjectSetHash, 'subjectSetHash')
  };
}

function backfillJobData(data: Record<string, unknown>): BackfillVisibilityProjectJobData {
  return {
    projectId: requiredString(data.projectId, 'projectId'),
    extractorVersion: requiredString(data.extractorVersion, 'extractorVersion'),
    subjectSetHash: requiredString(data.subjectSetHash, 'subjectSetHash'),
    afterObservationId: typeof data.afterObservationId === 'string'
      ? data.afterObservationId
      : null,
    limit: backfillLimit(data.limit)
  };
}

function errorCode(error: unknown) {
  return error instanceof VisibilityExtractionError
    ? error.code
    : 'VISIBILITY_EXTRACTION_WORKER_FAILED';
}

export async function expandVisibilityExtractionBackfill(
  input: BackfillVisibilityProjectJobData,
  dependencies: { queue: VisibilityExtractionQueue }
) {
  const limit = backfillLimit(input.limit);
  const rows = await prisma.platformObservation.findMany({
    where: {
      projectId: input.projectId,
      status: { in: [...TERMINAL_OBSERVATION_STATUSES] },
      ...(input.afterObservationId ? { id: { gt: input.afterObservationId } } : {})
    },
    orderBy: { id: 'asc' },
    take: limit + 1,
    select: { id: true }
  });

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  for (const observation of page) {
    await dependencies.queue.enqueueObservation({
      projectId: input.projectId,
      observationId: observation.id,
      extractorVersion: input.extractorVersion,
      subjectSetHash: input.subjectSetHash
    });
  }

  return {
    enqueuedCount: page.length,
    nextCursor: hasMore && page.length ? page[page.length - 1]!.id : null
  };
}

export async function processVisibilityExtractionJob(
  job: VisibilityExtractionJobLike,
  dependencies: VisibilityExtractionWorkerDependencies = {}
) {
  if (job.name === 'extract-observation') {
    const data = extractJobData(job.data);
    const observation = await prisma.platformObservation.findFirst({
      where: { id: data.observationId, projectId: data.projectId },
      select: { id: true }
    });
    if (!observation) {
      throw new VisibilityExtractionError(
        'VISIBILITY_OBSERVATION_NOT_FOUND',
        'Visibility observation not found'
      );
    }

    const started = Date.now();
    emitVisibilityIntelligenceEvent('visibility.extraction.started', {
      projectId: data.projectId,
      observationId: data.observationId,
      extractorVersion: data.extractorVersion,
      subjectSetHash: data.subjectSetHash,
      status: 'RUNNING'
    });
    const service = dependencies.extractionService
      ?? new VisibilityExtractionService({ extractorVersion: data.extractorVersion });
    try {
      const result = await service.extractObservation(
        data.projectId,
        data.observationId,
        data.subjectSetHash
      );
      emitVisibilityIntelligenceEvent('visibility.extraction.completed', {
        projectId: data.projectId,
        observationId: data.observationId,
        extractionId: result.id,
        extractorVersion: data.extractorVersion,
        subjectSetHash: data.subjectSetHash,
        status: result.status,
        mentionStatus: 'mentionStatus' in result ? result.mentionStatus : undefined,
        citationStatus: 'citationStatus' in result ? result.citationStatus : undefined,
        mentionCount: 'mentionCount' in result ? result.mentionCount : undefined,
        citationCount: 'citationCount' in result ? result.citationCount : undefined,
        durationMs: Date.now() - started
      });
      return result;
    } catch (error) {
      emitVisibilityIntelligenceEvent('visibility.extraction.failed', {
        projectId: data.projectId,
        observationId: data.observationId,
        extractorVersion: data.extractorVersion,
        subjectSetHash: data.subjectSetHash,
        status: 'FAILED',
        errorCode: errorCode(error),
        durationMs: Date.now() - started
      });
      throw error;
    }
  }

  if (job.name === 'backfill-project') {
    if (!dependencies.queue) {
      throw new VisibilityExtractionError(
        'VISIBILITY_EXTRACTION_QUEUE_REQUIRED',
        'Visibility extraction queue is required for backfill jobs'
      );
    }
    return expandVisibilityExtractionBackfill(backfillJobData(job.data), {
      queue: dependencies.queue
    });
  }

  throw new VisibilityExtractionError(
    'VISIBILITY_EXTRACTION_JOB_UNSUPPORTED',
    `Unsupported visibility extraction job: ${job.name}`
  );
}
