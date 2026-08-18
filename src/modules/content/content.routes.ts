import type { AiTask } from '@prisma/client';
import { Router } from 'express';
import { hasFeature } from '../../auth/feature-flags.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { createContentBriefTask, createContentOptimizationTask } from '../ai/content-intelligence.js';
import { aiTaskService, type AiTaskService } from '../ai/ai.service.js';
import { contentService, type ContentService } from './content.service.js';

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

export function createContentRoutes(service: ContentService = contentService, aiService: AiTaskService = aiTaskService) {
  const router = Router();

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
