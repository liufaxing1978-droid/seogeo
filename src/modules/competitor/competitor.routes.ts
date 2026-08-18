import { Router } from 'express';
import { hasFeature } from '../../auth/feature-flags.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { createCompetitorGapTask } from '../ai/competitor-intelligence.js';
import { aiTaskService, type AiTaskService } from '../ai/ai.service.js';
import { createCompetitorComparison } from './competitor-comparison.js';
import { competitorService, type CompetitorService } from './competitor.service.js';

async function requireProject(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  if (!hasFeature(project.planLevel, 'COMPETITOR_INTELLIGENCE')) throw new AppError('Competitor Intelligence is not available for this project plan', 403, 'FEATURE_NOT_AVAILABLE');
  return project;
}

async function requireCompetitor(projectId: string, competitorId: string) {
  await requireProject(projectId);
  const competitor = await prisma.competitor.findFirst({ where: { id: competitorId, projectId } });
  if (!competitor) throw new NotFoundError('Competitor not found', 'COMPETITOR_NOT_FOUND');
  return competitor;
}

export function createCompetitorRoutes(service: CompetitorService = competitorService, aiService: AiTaskService = aiTaskService) {
  const router = Router();

  router.get('/projects/:projectId/competitors', async (req, res, next) => {
    try {
      await requireProject(req.params.projectId);
      const data = await prisma.competitor.findMany({ where: { projectId: req.params.projectId }, include: { crawls: { orderBy: { createdAt: 'desc' }, take: 1 }, comparisons: { orderBy: { createdAt: 'desc' }, take: 1 } }, orderBy: { createdAt: 'asc' } });
      res.json({ data });
    } catch (error) { next(error); }
  });

  router.post('/projects/:projectId/competitors', async (req, res, next) => {
    try {
      await requireProject(req.params.projectId);
      const competitor = await service.createCompetitor(req.params.projectId, { name: String(req.body?.name ?? ''), domain: String(req.body?.domain ?? '') });
      res.status(201).json({ data: competitor });
    } catch (error) { next(error); }
  });

  router.get('/projects/:projectId/competitors/:competitorId', async (req, res, next) => {
    try {
      await requireCompetitor(req.params.projectId, req.params.competitorId);
      const data = await prisma.competitor.findUnique({ where: { id: req.params.competitorId }, include: { crawls: { include: { snapshots: true }, orderBy: { createdAt: 'desc' }, take: 10 }, comparisons: { orderBy: { createdAt: 'desc' }, take: 10 } } });
      res.json({ data });
    } catch (error) { next(error); }
  });

  router.post('/projects/:projectId/competitors/:competitorId/crawls', async (req, res, next) => {
    try {
      await requireCompetitor(req.params.projectId, req.params.competitorId);
      const maxPages = req.body?.maxPages === undefined ? undefined : Number(req.body.maxPages);
      const crawl = await service.createCrawl(req.params.projectId, req.params.competitorId, { maxPages });
      res.status(202).json({ data: crawl });
    } catch (error) { next(error); }
  });

  router.post('/projects/:projectId/competitors/:competitorId/compare', async (req, res, next) => {
    try {
      await requireCompetitor(req.params.projectId, req.params.competitorId);
      res.status(201).json({ data: await createCompetitorComparison(req.params.projectId, req.params.competitorId) });
    } catch (error) { next(error); }
  });

  router.post('/projects/:projectId/competitors/comparisons/:comparisonId/ai', async (req, res, next) => {
    try {
      await requireProject(req.params.projectId);
      const task = await createCompetitorGapTask(req.params.projectId, req.params.comparisonId, aiService);
      res.status(202).json({ data: { id: task.id, taskType: task.taskType, status: task.status, promptVersion: task.promptVersion } });
    } catch (error) { next(error); }
  });

  return router;
}
