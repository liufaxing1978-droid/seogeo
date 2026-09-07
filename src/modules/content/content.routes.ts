import type { AiTask } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuthentication } from '../../auth/authentication.js';
import { requireCsrf } from '../../auth/csrf.js';
import { hasFeature } from '../../auth/feature-flags.js';
import {
  requireProjectCapability,
  requireProjectMembership,
} from '../../auth/project-access.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { createContentBriefTask, createContentOptimizationTask } from '../ai/content-intelligence.js';
import { aiTaskService, type AiTaskService } from '../ai/ai.service.js';
import { contentQualityRepository } from './content-quality.repository.js';
import { contentQualityService, type ContentQualityService } from './content-quality.service.js';
import { contentService, type ContentService } from './content.service.js';

const emptyBodySchema = z.object({}).strict();
const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
}).strict();
const runListSchema = paginationSchema.extend({
  status: z.enum(['QUEUED', 'RUNNING', 'COMPLETED', 'FAILED']).optional(),
}).strict();
const findingListSchema = paginationSchema.extend({
  status: z.enum(['OPEN', 'IN_REVIEW', 'ACCEPTED', 'DISMISSED']).optional(),
  category: z.enum(['INTERNAL_LINK_SUPPORT', 'CONTENT_DECAY', 'CONTENT_QA']).optional(),
  priority: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH']).optional(),
  contentDocumentId: z.string().uuid().optional(),
  pageId: z.string().uuid().optional(),
}).strict();
const findingTransitionSchema = z.object({
  status: z.enum(['OPEN', 'IN_REVIEW', 'DISMISSED']),
  reason: z.string().trim().min(1).max(1_000),
}).strict();

export type ContentQualityApiService = Pick<ContentQualityService, 'enqueueRun'>;

function safeTask(task: AiTask) {
  return { id: task.id, projectId: task.projectId, taskType: task.taskType, status: task.status, promptVersion: task.promptVersion, errorCode: task.errorCode, createdAt: task.createdAt, updatedAt: task.updatedAt };
}

async function requireContentProject(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  if (!hasFeature(project.planLevel, 'CONTENT_INTELLIGENCE')) throw new AppError('Content Intelligence is not available for this project plan', 403, 'FEATURE_NOT_AVAILABLE');
  return project;
}

async function requireDocument(projectId: string, documentId: string) {
  await requireContentProject(projectId);
  const document = await prisma.contentDocument.findFirst({ where: { id: documentId, projectId } });
  if (!document) throw new NotFoundError('Content document not found', 'CONTENT_DOCUMENT_NOT_FOUND');
  return document;
}

function routeParam(value: string | string[] | undefined): string {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  return normalized;
}

async function requireQualityFinding(projectId: string, findingId: string): Promise<void> {
  const finding = await prisma.contentQualityFinding.findFirst({
    where: { id: findingId, projectId },
    select: { id: true },
  });
  if (!finding) {
    throw new NotFoundError('Content quality finding not found', 'CONTENT_QUALITY_FINDING_NOT_FOUND');
  }
}

function mapQualityError(error: unknown): unknown {
  if (!error || typeof error !== 'object' || !('code' in error)) return error;
  const code = error.code;
  if (code === 'CONTENT_QUALITY_FINDING_NOT_FOUND') {
    return new NotFoundError('Content quality finding not found', code);
  }
  if (code === 'CONTENT_QUALITY_INVALID_TRANSITION' || code === 'CONTENT_QUALITY_CONCURRENT_TRANSITION') {
    return new AppError('Content quality finding transition is not allowed', 409, code);
  }
  return error;
}

export function createContentRoutes(
  service: ContentService = contentService,
  aiService: AiTaskService = aiTaskService,
  qualityService: ContentQualityApiService = contentQualityService,
) {
  const router = Router();
  const qualityReadGuards = [
    requireAuthentication(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_READ'),
  ];
  const qualityMutationGuards = [
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('CONTENT_WRITE'),
  ];

  router.post('/projects/:projectId/content-quality/runs', ...qualityMutationGuards, async (req, res, next) => {
    try {
      emptyBodySchema.parse(req.body);
      const projectId = routeParam(req.params.projectId);
      const data = await qualityService.enqueueRun(projectId, req.auth!.userId);
      res.status(202).json({ data });
    } catch (error) { next(mapQualityError(error)); }
  });

  router.get('/projects/:projectId/content-quality/runs', ...qualityReadGuards, async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const query = runListSchema.parse(req.query);
      const data = await prisma.contentQualityRun.findMany({
        where: { projectId, ...(query.status ? { status: query.status } : {}) },
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: query.limit,
        skip: query.offset,
      });
      res.json({ data });
    } catch (error) { next(mapQualityError(error)); }
  });

  router.get('/projects/:projectId/content-quality/findings', ...qualityReadGuards, async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const query = findingListSchema.parse(req.query);
      const data = await prisma.contentQualityFinding.findMany({
        where: {
          projectId,
          ...(query.status ? { status: query.status } : {}),
          ...(query.category ? { category: query.category } : {}),
          ...(query.priority ? { priority: query.priority } : {}),
          ...(query.contentDocumentId ? { contentDocumentId: query.contentDocumentId } : {}),
          ...(query.pageId ? { document: { pageId: query.pageId } } : {}),
        },
        include: { document: { select: { id: true, pageId: true, canonicalUrl: true } } },
        orderBy: [{ priority: 'desc' }, { lastDetectedAt: 'desc' }, { id: 'asc' }],
        take: query.limit,
        skip: query.offset,
      });
      res.json({ data });
    } catch (error) { next(mapQualityError(error)); }
  });

  router.get('/projects/:projectId/content-quality/findings/:findingId', ...qualityReadGuards, async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const findingId = routeParam(req.params.findingId);
      const data = await prisma.contentQualityFinding.findFirst({
        where: { id: findingId, projectId },
        include: {
          document: { select: { id: true, pageId: true, canonicalUrl: true } },
          latestRun: true,
          history: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
        },
      });
      if (!data) throw new NotFoundError('Content quality finding not found', 'CONTENT_QUALITY_FINDING_NOT_FOUND');
      res.json({ data });
    } catch (error) { next(mapQualityError(error)); }
  });

  router.post('/projects/:projectId/content-quality/findings/:findingId/transition', ...qualityMutationGuards, async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const findingId = routeParam(req.params.findingId);
      const body = findingTransitionSchema.parse(req.body);
      await requireQualityFinding(projectId, findingId);
      const data = await contentQualityRepository.transitionFinding(
        projectId,
        findingId,
        body.status,
        req.auth!.userId,
        body.reason,
      );
      res.json({ data });
    } catch (error) { next(mapQualityError(error)); }
  });

  router.post('/projects/:projectId/content-quality/findings/:findingId/accept', ...qualityMutationGuards, async (req, res, next) => {
    try {
      emptyBodySchema.parse(req.body);
      const projectId = routeParam(req.params.projectId);
      const findingId = routeParam(req.params.findingId);
      await requireQualityFinding(projectId, findingId);
      const proposal = await contentQualityRepository.acceptFinding(projectId, findingId, req.auth!.userId);
      res.status(201).json({ data: { proposalId: proposal.id } });
    } catch (error) { next(mapQualityError(error)); }
  });

  router.get('/projects/:projectId/content/documents', async (req, res, next) => {
    try {
      await requireContentProject(req.params.projectId);
      const data = await prisma.contentDocument.findMany({
        where: { projectId: req.params.projectId },
        include: { _count: { select: { signals: true, opportunities: true, briefs: true } } },
        orderBy: [{ extractedAt: 'desc' }, { id: 'asc' }]
      });
      res.json({ data });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/content/documents/:documentId', async (req, res, next) => {
    try {
      await requireDocument(req.params.projectId, req.params.documentId);
      const data = await prisma.contentDocument.findUnique({
        where: { id: req.params.documentId },
        include: { signals: { orderBy: { ruleKey: 'asc' } }, opportunities: { orderBy: [{ priority: 'desc' }, { lastDetectedAt: 'desc' }] }, briefs: { orderBy: { createdAt: 'desc' } } }
      });
      res.json({ data });
    } catch (error) { next(error); }
  });

  router.post('/projects/:projectId/content/refresh', async (req, res, next) => {
    try {
      await requireContentProject(req.params.projectId);
      res.status(202).json({ data: await service.enqueueRefresh(req.params.projectId) });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/content/opportunities', async (req, res, next) => {
    try {
      await requireContentProject(req.params.projectId);
      const data = await prisma.contentOpportunity.findMany({ where: { projectId: req.params.projectId }, orderBy: [{ priority: 'desc' }, { lastDetectedAt: 'desc' }] });
      res.json({ data });
    } catch (error) { next(error); }
  });

  router.patch('/projects/:projectId/content/opportunities/:opportunityId', async (req, res, next) => {
    try {
      await requireContentProject(req.params.projectId);
      const existing = await prisma.contentOpportunity.findFirst({ where: { id: req.params.opportunityId, projectId: req.params.projectId } });
      if (!existing) throw new NotFoundError('Content opportunity not found', 'CONTENT_OPPORTUNITY_NOT_FOUND');
      const status = req.body?.status;
      if (status !== 'IN_PROGRESS' && status !== 'IGNORED') throw new AppError('Manual opportunity status must be IN_PROGRESS or IGNORED', 400, 'INVALID_CONTENT_OPPORTUNITY_STATUS');
      const data = await prisma.contentOpportunity.update({ where: { id: existing.id }, data: { status, verifiedFixedAt: null } });
      res.json({ data });
    } catch (error) { next(error); }
  });

  router.post('/projects/:projectId/content/documents/:documentId/brief', async (req, res, next) => {
    try {
      await requireDocument(req.params.projectId, req.params.documentId);
      const task = await createContentBriefTask(req.params.projectId, req.params.documentId, aiService);
      res.status(202).json({ data: safeTask(task) });
    } catch (error) { next(error); }
  });

  router.post('/projects/:projectId/content/documents/:documentId/optimization', async (req, res, next) => {
    try {
      await requireDocument(req.params.projectId, req.params.documentId);
      const task = await createContentOptimizationTask(req.params.projectId, req.params.documentId, aiService);
      res.status(202).json({ data: safeTask(task) });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/content/briefs', async (req, res, next) => {
    try {
      await requireContentProject(req.params.projectId);
      const data = await prisma.contentBrief.findMany({ where: { projectId: req.params.projectId }, orderBy: { createdAt: 'desc' } });
      res.json({ data });
    } catch (error) { next(error); }
  });

  return router;
}

export const contentRoutes = createContentRoutes();
