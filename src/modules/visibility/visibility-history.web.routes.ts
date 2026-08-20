import { Router } from 'express';
import { z } from 'zod';
import { hasFeature } from '../../auth/feature-flags.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { VisibilityAlertsError, VisibilityAlertsService } from './visibility-alerts.service.js';
import { visibilityHistoryWebRepository } from './visibility-history.web.repository.js';

const ruleForm = z.object({
  ruleType: z.enum([
    'OWNED_MENTION_RATE_DROP',
    'OWNED_CITATION_RATE_DROP',
    'OWNED_SOV_DROP',
    'COMPETITOR_SOV_RISE',
    'EVIDENCE_COVERAGE_DROP',
    'METRIC_BECAME_UNKNOWN'
  ]),
  name: z.string().trim().min(1).max(120),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).default('WARNING'),
  thresholdBasisPoints: z.preprocess((value) => value === '' || value == null ? null : Number(value), z.number().int().min(1).max(10_000).nullable()),
  actorSubjectId: z.preprocess((value) => typeof value === 'string' && value.trim() ? value.trim() : null, z.string().uuid().nullable())
}).strict();

const updateRuleForm = z.object({
  name: z.string().trim().min(1).max(120),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']),
  enabled: z.preprocess((value) => value === 'on' || value === 'true' || value === true, z.boolean()),
  thresholdBasisPoints: z.preprocess((value) => value === '' || value == null ? null : Number(value), z.number().int().min(1).max(10_000).nullable()),
  actorSubjectId: z.preprocess((value) => typeof value === 'string' && value.trim() ? value.trim() : null, z.string().uuid().nullable())
}).strict();

async function requireHistoryProject(projectId: string) {
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

function alertToHttp(error: unknown): never {
  if (error instanceof VisibilityAlertsError) {
    const status = error.code.endsWith('_NOT_FOUND') ? 404 : 400;
    throw new AppError(error.message, status, error.code);
  }
  throw error;
}

export function createVisibilityHistoryWebRoutes(alertsService = new VisibilityAlertsService()) {
  const router = Router();

  router.get('/projects/:id/visibility/history', async (req, res, next) => {
    try {
      await requireHistoryProject(req.params.id);
      const data = await visibilityHistoryWebRepository.getHistory(req.params.id);
      if (!data) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
      res.render('layout', {
        title: `Visibility 历史 · ${data.project.name}`,
        activeNav: 'visibility-history',
        currentProjectId: data.project.id,
        breadcrumbs: ['项目', data.project.name, 'AI Visibility', '历史趋势'],
        bodyTemplate: 'visibility/history',
        ...data
      });
    } catch (error) { next(error); }
  });

  router.get('/projects/:id/visibility/alerts', async (req, res, next) => {
    try {
      await requireHistoryProject(req.params.id);
      const data = await visibilityHistoryWebRepository.getAlerts(req.params.id);
      if (!data) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
      res.render('layout', {
        title: `Visibility 告警 · ${data.project.name}`,
        activeNav: 'visibility-alerts',
        currentProjectId: data.project.id,
        breadcrumbs: ['项目', data.project.name, 'AI Visibility', '告警'],
        bodyTemplate: 'visibility/alerts',
        ...data
      });
    } catch (error) { next(error); }
  });

  router.post('/projects/:id/visibility/alerts/rules', async (req, res, next) => {
    try {
      await requireHistoryProject(req.params.id);
      const input = ruleForm.parse(req.body);
      try {
        await alertsService.createRule(req.params.id, input);
      } catch (error) { alertToHttp(error); }
      res.redirect(303, `/projects/${req.params.id}/visibility/alerts`);
    } catch (error) { next(error); }
  });

  router.post('/projects/:id/visibility/alerts/rules/:ruleId', async (req, res, next) => {
    try {
      await requireHistoryProject(req.params.id);
      const input = updateRuleForm.parse(req.body);
      try {
        await alertsService.updateRule(req.params.id, req.params.ruleId, input);
      } catch (error) { alertToHttp(error); }
      res.redirect(303, `/projects/${req.params.id}/visibility/alerts`);
    } catch (error) { next(error); }
  });

  router.post('/projects/:id/visibility/alerts/:alertId/acknowledge', async (req, res, next) => {
    try {
      await requireHistoryProject(req.params.id);
      try {
        await alertsService.acknowledge(req.params.id, req.params.alertId);
      } catch (error) { alertToHttp(error); }
      res.redirect(303, `/projects/${req.params.id}/visibility/alerts`);
    } catch (error) { next(error); }
  });

  return router;
}

export const visibilityHistoryWebRoutes = createVisibilityHistoryWebRoutes();
