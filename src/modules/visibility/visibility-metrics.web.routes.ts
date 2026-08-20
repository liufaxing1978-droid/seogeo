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
import { visibilityMetricsWebRepository } from './visibility-metrics.web.repository.js';

const querySchema = z.object({
  snapshotId: z.string().uuid().optional()
}).strict();

const generationSchema = z.object({
  windowStart: z.string().min(1),
  windowEnd: z.string().min(1),
  extractorVersion: z.string().min(1).max(100),
  subjectSetHash: z.string().regex(/^[a-f0-9]{64}$/i)
}).strict();

class LazyVisibilityMetricsWebQueuePort implements VisibilityMetricsQueuePort {
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

function datetimeLocal(date: Date) {
  return date.toISOString().slice(0, 16);
}

export function createVisibilityMetricsWebRoutes(
  metricsQueue: VisibilityMetricsQueue = new VisibilityMetricsQueue(
    new LazyVisibilityMetricsWebQueuePort()
  ),
  metricsService = new VisibilityMetricsService()
) {
  const router = Router();

  router.get('/projects/:id/visibility/metrics', async (req, res, next) => {
    try {
      const projectId = req.params.id;
      await requireMetricsProject(projectId);
      const query = querySchema.parse(req.query);
      const data = await visibilityMetricsWebRepository.getMetricsPage(projectId, query.snapshotId);
      if (!data) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
      if (query.snapshotId && !data.snapshot) {
        throw new NotFoundError('Visibility metric snapshot not found', 'VISIBILITY_METRICS_SNAPSHOT_NOT_FOUND');
      }

      const now = new Date();
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      res.render('layout', {
        title: `Visibility 指标 · ${data.project.name}`,
        activeNav: 'visibility-metrics',
        currentProjectId: data.project.id,
        breadcrumbs: ['项目', data.project.name, 'AI Visibility', 'Visibility 指标'],
        bodyTemplate: 'visibility/metrics',
        formWindowStart: datetimeLocal(data.snapshot?.windowStart ?? sevenDaysAgo),
        formWindowEnd: datetimeLocal(data.snapshot?.windowEnd ?? now),
        ...data
      });
    } catch (error) { next(error); }
  });

  router.post('/projects/:id/visibility/metrics/snapshots', async (req, res, next) => {
    try {
      const projectId = req.params.id;
      await requireMetricsProject(projectId);
      const input = generationSchema.parse(req.body);
      const requestTime = new Date();
      const snapshot = await metricsService.prepareSnapshot({
        projectId,
        windowStart: new Date(input.windowStart),
        windowEnd: new Date(input.windowEnd),
        inputCutoffAt: requestTime,
        extractorVersion: input.extractorVersion,
        subjectSetHash: input.subjectSetHash.toLowerCase(),
        scope: { providers: [], promptSetIds: [] }
      });
      await metricsQueue.enqueueSnapshot({
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
      res.redirect(303, `/projects/${projectId}/visibility/metrics?snapshotId=${snapshot.id}`);
    } catch (error) {
      try { translateMetricsError(error); } catch (mapped) { next(mapped); }
    }
  });

  return router;
}
