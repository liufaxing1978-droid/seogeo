import type { AiTask } from '@prisma/client';
import { Router } from 'express';
import { hasFeature } from '../../auth/feature-flags.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { createEntityEnrichmentTask } from './entity-intelligence.js';
import { createGeoAnalysisTask } from './geo-intelligence.js';
import { AiRepository } from './ai.repository.js';
import { aiTaskService, type AiTaskService } from './ai.service.js';
import { createSeoAnalysisTask } from './seo-intelligence.js';

function safeTask(task: AiTask) {
  return {
    id: task.id,
    projectId: task.projectId,
    taskType: task.taskType,
    status: task.status,
    promptVersion: task.promptVersion,
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  };
}

async function requireAiProject(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  if (!hasFeature(project.planLevel, 'AI_ANALYSIS')) {
    throw new AppError('AI analysis is not available for this project plan', 403, 'FEATURE_NOT_AVAILABLE');
  }
  return project;
}

export function createAiRoutes(
  service: AiTaskService = aiTaskService,
  repository: AiRepository = new AiRepository()
) {
  const router = Router();

  async function requireProjectTask(projectId: string, taskId: string) {
    await requireAiProject(projectId);
    const task = await repository.getTaskDetail(taskId);
    if (!task || task.projectId !== projectId) {
      throw new NotFoundError('AI task not found', 'AI_TASK_NOT_FOUND');
    }
    return task;
  }

  router.post('/projects/:projectId/ai/seo-analysis', async (req, res, next) => {
    try {
      await requireAiProject(req.params.projectId);
      const auditRunId = typeof req.body?.auditRunId === 'string' ? req.body.auditRunId : '';
      if (!auditRunId) throw new AppError('auditRunId is required', 400, 'AI_SOURCE_AUDIT_REQUIRED');
      const task = await createSeoAnalysisTask(req.params.projectId, auditRunId, service);
      res.status(202).json({ data: safeTask(task) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects/:projectId/ai/geo-analysis', async (req, res, next) => {
    try {
      await requireAiProject(req.params.projectId);
      const geoAuditRunId = typeof req.body?.geoAuditRunId === 'string' ? req.body.geoAuditRunId : '';
      if (!geoAuditRunId) throw new AppError('geoAuditRunId is required', 400, 'AI_SOURCE_AUDIT_REQUIRED');
      const task = await createGeoAnalysisTask(req.params.projectId, geoAuditRunId, service);
      res.status(202).json({ data: safeTask(task) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects/:projectId/ai/entity-enrichment', async (req, res, next) => {
    try {
      await requireAiProject(req.params.projectId);
      const geoAuditRunId = typeof req.body?.geoAuditRunId === 'string' ? req.body.geoAuditRunId : '';
      if (!geoAuditRunId) throw new AppError('geoAuditRunId is required', 400, 'AI_SOURCE_AUDIT_REQUIRED');
      const task = await createEntityEnrichmentTask(req.params.projectId, geoAuditRunId, service);
      res.status(202).json({ data: safeTask(task) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:projectId/ai/tasks', async (req, res, next) => {
    try {
      await requireAiProject(req.params.projectId);
      res.json({ data: await repository.listProjectTasks(req.params.projectId) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/ai/tasks/:taskId', async (req, res, next) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : '';
      if (!projectId) throw new AppError('projectId is required', 400, 'PROJECT_ID_REQUIRED');
      res.json({ data: await requireProjectTask(projectId, req.params.taskId) });
    } catch (error) {
      next(error);
    }
  });

  router.post('/ai/tasks/:taskId/retry', async (req, res, next) => {
    try {
      const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId : '';
      if (!projectId) throw new AppError('projectId is required', 400, 'PROJECT_ID_REQUIRED');
      await requireProjectTask(projectId, req.params.taskId);
      const task = await service.retry(req.params.taskId);
      res.status(202).json({ data: safeTask(task) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const aiRoutes = createAiRoutes();
