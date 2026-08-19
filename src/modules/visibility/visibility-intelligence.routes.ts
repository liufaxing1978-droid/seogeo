import { Queue } from 'bullmq';
import { Router } from 'express';
import { z } from 'zod';
import { hasFeature, type Feature } from '../../auth/feature-flags.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { createRedisConnection } from '../../queue/connection.js';
import { P6B_EXTRACTION_VERSION } from './visibility-extraction.service.js';
import {
  VisibilityExtractionQueue,
  type VisibilityExtractionQueuePort
} from './visibility-extraction.queue.js';
import {
  VisibilitySubjectError,
  VisibilitySubjectService
} from './visibility-subject.service.js';

const subjectSchema = z.discriminatedUnion('subjectType', [
  z.object({ subjectType: z.literal('OWNED_BRAND'), canonicalValue: z.string().min(1) }).strict(),
  z.object({ subjectType: z.literal('OWNED_DOMAIN'), canonicalValue: z.string().min(1) }).strict(),
  z.object({ subjectType: z.literal('OWNED_ENTITY'), entityId: z.string().uuid() }).strict(),
  z.object({ subjectType: z.literal('COMPETITOR'), competitorId: z.string().uuid() }).strict()
]);

const aliasSchema = z.object({
  alias: z.string().min(1),
  aliasType: z.enum(['NAME', 'DOMAIN', 'ENTITY_ALIAS'])
}).strict();

const refreshSchema = z.object({ observationId: z.string().uuid() }).strict();
const backfillSchema = z.object({
  afterObservationId: z.string().uuid().nullable().optional(),
  limit: z.number().int().positive().optional()
}).strict();
const listQuerySchema = z.object({
  afterId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().optional()
}).strict();

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

class LazyVisibilityExtractionQueuePort implements VisibilityExtractionQueuePort {
  private queue: Queue<Record<string, unknown>> | null = null;

  private getQueue() {
    if (!this.queue) {
      this.queue = new Queue<Record<string, unknown>>('visibility-extraction', {
        connection: createRedisConnection()
      });
    }
    return this.queue;
  }

  async add(name: string, data: Record<string, unknown>, options: { jobId: string; attempts: number }) {
    return this.getQueue().add(name, data, options);
  }
}

async function requireProject(projectId: string, feature: Feature) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, planLevel: true }
  });
  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  if (!hasFeature(project.planLevel, feature)) {
    throw new AppError('This feature requires a higher plan', 403, 'FEATURE_NOT_AVAILABLE');
  }
  return project;
}

function boundedLimit(value: number | undefined) {
  return Math.min(value ?? DEFAULT_LIMIT, MAX_LIMIT);
}

function translateSubjectError(error: unknown): never {
  if (!(error instanceof VisibilitySubjectError)) throw error;
  if (
    error.code === 'VISIBILITY_PROJECT_NOT_FOUND' ||
    error.code === 'VISIBILITY_ENTITY_NOT_FOUND' ||
    error.code === 'VISIBILITY_COMPETITOR_NOT_FOUND' ||
    error.code === 'VISIBILITY_SUBJECT_NOT_FOUND'
  ) {
    throw new NotFoundError(error.message, error.code);
  }
  if (error.code === 'AMBIGUOUS_ALIAS') {
    throw new AppError(error.message, 409, error.code);
  }
  throw new AppError(error.message, 400, error.code);
}

export function createVisibilityIntelligenceRoutes(
  extractionQueue: VisibilityExtractionQueue = new VisibilityExtractionQueue(
    new LazyVisibilityExtractionQueuePort()
  ),
  subjectService = new VisibilitySubjectService()
) {
  const router = Router();

  router.get('/projects/:projectId/visibility/subjects', async (req, res, next) => {
    try {
      await requireProject(req.params.projectId, 'AI_VISIBILITY');
      await subjectService.bootstrapOwnedDomain(req.params.projectId);
      const data = await prisma.visibilitySubject.findMany({
        where: { projectId: req.params.projectId },
        orderBy: [{ status: 'asc' }, { subjectType: 'asc' }, { normalizedValue: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          projectId: true,
          subjectType: true,
          canonicalValue: true,
          normalizedValue: true,
          status: true,
          entityId: true,
          competitorId: true,
          sourceType: true,
          createdAt: true,
          updatedAt: true
        }
      });
      res.json({ data });
    } catch (error) {
      try { translateSubjectError(error); } catch (mapped) { next(mapped); }
    }
  });

  router.post('/projects/:projectId/visibility/subjects/bootstrap', async (req, res, next) => {
    try {
      await requireProject(req.params.projectId, 'AI_VISIBILITY');
      const data = await subjectService.bootstrapOwnedDomain(req.params.projectId);
      res.status(201).json({ data });
    } catch (error) {
      try { translateSubjectError(error); } catch (mapped) { next(mapped); }
    }
  });

  router.post('/projects/:projectId/visibility/subjects', async (req, res, next) => {
    try {
      await requireProject(req.params.projectId, 'AI_VISIBILITY');
      const input = subjectSchema.parse(req.body);
      const data = await subjectService.createSubject(req.params.projectId, input);
      res.status(201).json({ data });
    } catch (error) {
      try { translateSubjectError(error); } catch (mapped) { next(mapped); }
    }
  });

  router.post('/projects/:projectId/visibility/subjects/:subjectId/aliases', async (req, res, next) => {
    try {
      await requireProject(req.params.projectId, 'AI_VISIBILITY');
      const input = aliasSchema.parse(req.body);
      const data = await subjectService.addAlias(req.params.projectId, req.params.subjectId, input);
      res.status(201).json({ data });
    } catch (error) {
      try { translateSubjectError(error); } catch (mapped) { next(mapped); }
    }
  });

  router.post('/projects/:projectId/visibility/extractions/refresh', async (req, res, next) => {
    try {
      await requireProject(req.params.projectId, 'CITATION_MONITOR');
      const input = refreshSchema.parse(req.body);
      const observation = await prisma.platformObservation.findFirst({
        where: { id: input.observationId, projectId: req.params.projectId },
        select: { id: true }
      });
      if (!observation) {
        throw new NotFoundError('Visibility observation not found', 'VISIBILITY_OBSERVATION_NOT_FOUND');
      }
      await subjectService.bootstrapOwnedDomain(req.params.projectId);
      const snapshot = await subjectService.buildActiveSnapshot(req.params.projectId);
      const job = await extractionQueue.enqueueObservation({
        projectId: req.params.projectId,
        observationId: observation.id,
        extractorVersion: P6B_EXTRACTION_VERSION,
        subjectSetHash: snapshot.subjectSetHash
      });
      res.status(202).json({
        data: {
          jobId: job.id ?? null,
          observationId: observation.id,
          extractorVersion: P6B_EXTRACTION_VERSION,
          subjectSetHash: snapshot.subjectSetHash
        }
      });
    } catch (error) {
      try { translateSubjectError(error); } catch (mapped) { next(mapped); }
    }
  });

  router.post('/projects/:projectId/visibility/extractions/backfill', async (req, res, next) => {
    try {
      await requireProject(req.params.projectId, 'CITATION_MONITOR');
      const input = backfillSchema.parse(req.body);
      await subjectService.bootstrapOwnedDomain(req.params.projectId);
      const snapshot = await subjectService.buildActiveSnapshot(req.params.projectId);
      const limit = boundedLimit(input.limit);
      const afterObservationId = input.afterObservationId ?? null;
      const job = await extractionQueue.enqueueBackfill({
        projectId: req.params.projectId,
        extractorVersion: P6B_EXTRACTION_VERSION,
        subjectSetHash: snapshot.subjectSetHash,
        afterObservationId,
        limit
      });
      res.status(202).json({
        data: {
          jobId: job.id ?? null,
          extractorVersion: P6B_EXTRACTION_VERSION,
          subjectSetHash: snapshot.subjectSetHash,
          afterObservationId,
          limit
        }
      });
    } catch (error) {
      try { translateSubjectError(error); } catch (mapped) { next(mapped); }
    }
  });

  router.get('/projects/:projectId/visibility/mentions', async (req, res, next) => {
    try {
      await requireProject(req.params.projectId, 'CITATION_MONITOR');
      const query = listQuerySchema.parse(req.query);
      const limit = boundedLimit(query.limit);
      const data = await prisma.mentionObservation.findMany({
        where: { projectId: req.params.projectId, ...(query.afterId ? { id: { gt: query.afterId } } : {}) },
        orderBy: { id: 'asc' },
        take: limit,
        select: {
          id: true,
          projectId: true,
          visibilityExtractionId: true,
          platformObservationId: true,
          subjectId: true,
          subjectType: true,
          subjectValue: true,
          matchedValue: true,
          mentionType: true,
          occurrenceCount: true,
          firstPosition: true,
          extractorVersion: true,
          createdAt: true
        }
      });
      res.json({ data, meta: { limit, nextCursor: data.at(-1)?.id ?? null } });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/visibility/citations', async (req, res, next) => {
    try {
      await requireProject(req.params.projectId, 'CITATION_MONITOR');
      const query = listQuerySchema.parse(req.query);
      const limit = boundedLimit(query.limit);
      const data = await prisma.citationObservation.findMany({
        where: { projectId: req.params.projectId, ...(query.afterId ? { id: { gt: query.afterId } } : {}) },
        orderBy: { id: 'asc' },
        take: limit,
        select: {
          id: true,
          projectId: true,
          visibilityExtractionId: true,
          platformObservationId: true,
          citationKey: true,
          url: true,
          normalizedUrl: true,
          domain: true,
          position: true,
          title: true,
          sourceType: true,
          occurrenceCount: true,
          isOwnedDomain: true,
          ownedSubjectId: true,
          competitorId: true,
          competitorSubjectId: true,
          extractorVersion: true,
          createdAt: true
        }
      });
      res.json({ data, meta: { limit, nextCursor: data.at(-1)?.id ?? null } });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/visibility/extractions', async (req, res, next) => {
    try {
      await requireProject(req.params.projectId, 'CITATION_MONITOR');
      const query = listQuerySchema.parse(req.query);
      const limit = boundedLimit(query.limit);
      const data = await prisma.visibilityExtraction.findMany({
        where: { projectId: req.params.projectId, ...(query.afterId ? { id: { gt: query.afterId } } : {}) },
        orderBy: { id: 'asc' },
        take: limit,
        select: {
          id: true,
          projectId: true,
          platformObservationId: true,
          status: true,
          extractorVersion: true,
          subjectSetHash: true,
          answerHash: true,
          mentionStatus: true,
          citationStatus: true,
          mentionCount: true,
          citationCount: true,
          errorCode: true,
          startedAt: true,
          completedAt: true,
          createdAt: true,
          updatedAt: true
        }
      });
      res.json({ data, meta: { limit, nextCursor: data.at(-1)?.id ?? null } });
    } catch (error) { next(error); }
  });

  return router;
}
