import { Queue } from 'bullmq';
import { Router } from 'express';
import { z } from 'zod';
import { hasFeature } from '../../auth/feature-flags.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { createRedisConnection } from '../../queue/connection.js';
import {
  VISIBILITY_METRICS_QUEUE_NAME,
  VisibilityMetricsQueue,
  type VisibilityMetricsQueuePort
} from './visibility-metrics.queue.js';
import {
  VisibilityMetricsError,
  VisibilityMetricsService
} from './visibility-metrics.service.js';

const providerSchema = z.enum(['OPENAI', 'GEMINI', 'PERPLEXITY', 'ANTHROPIC', 'DEEPSEEK']);

const scopeSchema = z.object({
  providers: z.array(providerSchema).max(5),
  promptSetIds: z.array(z.string().uuid()).max(20)
}).strict();

const createSnapshotSchema = z.object({
  windowStart: z.string().datetime({ offset: true }),
  windowEnd: z.string().datetime({ offset: true }),
  inputCutoffAt: z.string().datetime({ offset: true }).optional(),
  extractorVersion: z.string().min(1).max(100),
  subjectSetHash: z.string().regex(/^[a-f0-9]{64}$/i),
  scope: scopeSchema
}).strict();

const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional()
}).strict();

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

class LazyVisibilityMetricsQueuePort implements VisibilityMetricsQueuePort {
  private queue: Queue<Record<string, unknown>> | null = null;

  private getQueue() {
    if (!this.queue) {
      this.queue = new Queue<Record<string, unknown>>(VISIBILITY_METRICS_QUEUE_NAME, {
        connection: createRedisConnection()
      });
    }
    return this.queue;
  }

  async add(
    name: string,
    data: Record<string, unknown>,
    options: { jobId: string; attempts: number }
  ) {
    return this.getQueue().add(name, data, options);
  }
}

async function requireMetricsProject(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, planLevel: true }
  });
  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  if (!hasFeature(project.planLevel, 'COMPETITOR_SOV')) {
    throw new AppError('This feature requires a higher plan', 403, 'FEATURE_NOT_AVAILABLE');
  }
  return project;
}

function boundedLimit(value: number | undefined) {
  return Math.min(value ?? DEFAULT_LIMIT, MAX_LIMIT);
}

function translateMetricsError(error: unknown): never {
  if (!(error instanceof VisibilityMetricsError)) throw error;

  if (
    error.code === 'VISIBILITY_METRICS_PROJECT_NOT_FOUND'
    || error.code === 'VISIBILITY_METRICS_PROMPT_SET_NOT_FOUND'
    || error.code === 'VISIBILITY_METRICS_SNAPSHOT_NOT_FOUND'
  ) {
    throw new NotFoundError(error.message, error.code);
  }

  if (error.code === 'VISIBILITY_METRICS_SNAPSHOT_BUSY') {
    throw new AppError(error.message, 409, error.code);
  }

  throw new AppError(error.message, 400, error.code);
}

function safeSnapshot(snapshot: {
  id: string;
  projectId: string;
  status: string;
  formulaVersion: string;
  extractorVersion: string;
  subjectSetHash: string;
  windowStart: Date;
  windowEnd: Date;
  inputCutoffAt: Date;
  scopeHash: string;
  inputFingerprint: string | null;
  candidateObservationCount: number;
  completedExtractionCount: number;
  missingExtractionCount: number;
  failedExtractionCount: number;
  errorCode: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    status: snapshot.status,
    formulaVersion: snapshot.formulaVersion,
    extractorVersion: snapshot.extractorVersion,
    subjectSetHash: snapshot.subjectSetHash,
    windowStart: snapshot.windowStart,
    windowEnd: snapshot.windowEnd,
    inputCutoffAt: snapshot.inputCutoffAt,
    scopeHash: snapshot.scopeHash,
    inputFingerprint: snapshot.inputFingerprint,
    candidateObservationCount: snapshot.candidateObservationCount,
    completedExtractionCount: snapshot.completedExtractionCount,
    missingExtractionCount: snapshot.missingExtractionCount,
    failedExtractionCount: snapshot.failedExtractionCount,
    errorCode: snapshot.errorCode,
    startedAt: snapshot.startedAt,
    completedAt: snapshot.completedAt,
    createdAt: snapshot.createdAt,
    updatedAt: snapshot.updatedAt
  };
}

function safeRow(row: {
  metricType: string;
  metricStatus: string;
  dimensionType: string;
  dimensionKey: string;
  dimensionLabelSnapshot: string | null;
  actorType: string;
  actorSubjectId: string | null;
  actorKey: string;
  numerator: number;
  denominator: number;
  candidateObservationCount: number;
  eligibleObservationCount: number;
  notEligibleObservationCount: number;
  unknownObservationCount: number;
  createdAt: Date;
}) {
  return {
    metricType: row.metricType,
    metricStatus: row.metricStatus,
    dimensionType: row.dimensionType,
    dimensionKey: row.dimensionType === 'OVERALL' ? null : row.dimensionKey,
    dimensionLabel: row.dimensionLabelSnapshot,
    actorType: row.actorType,
    actorSubjectId: row.actorSubjectId,
    actorKey: row.actorKey,
    numerator: row.numerator,
    denominator: row.denominator,
    ratio: row.metricStatus === 'CALCULATED' && row.denominator > 0
      ? Number((row.numerator / row.denominator).toFixed(4))
      : null,
    candidateObservationCount: row.candidateObservationCount,
    eligibleObservationCount: row.eligibleObservationCount,
    notEligibleObservationCount: row.notEligibleObservationCount,
    unknownObservationCount: row.unknownObservationCount,
    createdAt: row.createdAt
  };
}

async function loadSafeSnapshot(projectId: string, snapshotId: string) {
  const snapshot = await prisma.visibilityMetricSnapshot.findFirst({
    where: { id: snapshotId, projectId },
    select: {
      id: true,
      projectId: true,
      status: true,
      formulaVersion: true,
      extractorVersion: true,
      subjectSetHash: true,
      windowStart: true,
      windowEnd: true,
      inputCutoffAt: true,
      scopeHash: true,
      inputFingerprint: true,
      candidateObservationCount: true,
      completedExtractionCount: true,
      missingExtractionCount: true,
      failedExtractionCount: true,
      errorCode: true,
      startedAt: true,
      completedAt: true,
      createdAt: true,
      updatedAt: true
    }
  });
  if (!snapshot) {
    throw new NotFoundError('Visibility metric snapshot not found', 'VISIBILITY_METRICS_SNAPSHOT_NOT_FOUND');
  }

  const rows = await prisma.visibilityMetricRow.findMany({
    where: { projectId, visibilityMetricSnapshotId: snapshotId },
    orderBy: [
      { metricType: 'asc' },
      { dimensionType: 'asc' },
      { dimensionKey: 'asc' },
      { actorKey: 'asc' },
      { id: 'asc' }
    ],
    select: {
      metricType: true,
      metricStatus: true,
      dimensionType: true,
      dimensionKey: true,
      dimensionLabelSnapshot: true,
      actorType: true,
      actorSubjectId: true,
      actorKey: true,
      numerator: true,
      denominator: true,
      candidateObservationCount: true,
      eligibleObservationCount: true,
      notEligibleObservationCount: true,
      unknownObservationCount: true,
      createdAt: true
    }
  });

  return { snapshot: safeSnapshot(snapshot), rows: rows.map(safeRow) };
}

export function createVisibilityMetricsRoutes(
  metricsQueue: VisibilityMetricsQueue = new VisibilityMetricsQueue(
    new LazyVisibilityMetricsQueuePort()
  ),
  metricsService = new VisibilityMetricsService()
) {
  const router = Router();

  router.post('/projects/:projectId/visibility/metrics/snapshots', async (req, res, next) => {
    try {
      const projectId = req.params.projectId;
      await requireMetricsProject(projectId);
      const requestTime = new Date();
      const input = createSnapshotSchema.parse(req.body);
      const snapshot = await metricsService.prepareSnapshot({
        projectId,
        windowStart: new Date(input.windowStart),
        windowEnd: new Date(input.windowEnd),
        inputCutoffAt: input.inputCutoffAt ? new Date(input.inputCutoffAt) : requestTime,
        extractorVersion: input.extractorVersion,
        subjectSetHash: input.subjectSetHash.toLowerCase(),
        scope: input.scope
      });
      const job = await metricsQueue.enqueueSnapshot({
        projectId,
        snapshotId: snapshot.id,
        formulaVersion: snapshot.formulaVersion,
        extractorVersion: snapshot.extractorVersion,
        subjectSetHash: snapshot.subjectSetHash,
        windowStart: snapshot.windowStart.toISOString(),
        windowEnd: snapshot.windowEnd.toISOString(),
        inputCutoffAt: snapshot.inputCutoffAt.toISOString(),
        scopeHash: snapshot.scopeHash
      });
      res.status(202).json({
        data: {
          jobId: job.id ?? null,
          snapshot: safeSnapshot(snapshot)
        }
      });
    } catch (error) {
      try { translateMetricsError(error); } catch (mapped) { next(mapped); }
    }
  });

  router.get('/projects/:projectId/visibility/metrics/snapshots', async (req, res, next) => {
    try {
      const projectId = req.params.projectId;
      await requireMetricsProject(projectId);
      const query = listQuerySchema.parse(req.query);
      const limit = boundedLimit(query.limit);
      const snapshots = await prisma.visibilityMetricSnapshot.findMany({
        where: { projectId },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: limit,
        select: {
          id: true,
          projectId: true,
          status: true,
          formulaVersion: true,
          extractorVersion: true,
          subjectSetHash: true,
          windowStart: true,
          windowEnd: true,
          inputCutoffAt: true,
          scopeHash: true,
          inputFingerprint: true,
          candidateObservationCount: true,
          completedExtractionCount: true,
          missingExtractionCount: true,
          failedExtractionCount: true,
          errorCode: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true
        }
      });
      res.json({ data: snapshots.map(safeSnapshot), meta: { limit } });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/visibility/metrics/snapshots/:snapshotId', async (req, res, next) => {
    try {
      const projectId = req.params.projectId;
      await requireMetricsProject(projectId);
      res.json({ data: await loadSafeSnapshot(projectId, req.params.snapshotId) });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/visibility/metrics/latest', async (req, res, next) => {
    try {
      const projectId = req.params.projectId;
      await requireMetricsProject(projectId);
      const latest = await prisma.visibilityMetricSnapshot.findFirst({
        where: { projectId, status: 'COMPLETED' },
        orderBy: [
          { completedAt: 'desc' },
          { createdAt: 'desc' },
          { id: 'asc' }
        ],
        select: { id: true }
      });
      if (!latest) {
        throw new NotFoundError('Visibility metric snapshot not found', 'VISIBILITY_METRICS_SNAPSHOT_NOT_FOUND');
      }
      res.json({ data: await loadSafeSnapshot(projectId, latest.id) });
    } catch (error) { next(error); }
  });

  return router;
}
