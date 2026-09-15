import { Router } from 'express';
import { z } from 'zod';
import { requireAuthentication } from '../../auth/authentication.js';
import { deriveCsrfToken, requireCsrf } from '../../auth/csrf.js';
import { hasFeature } from '../../auth/feature-flags.js';
import { requireProjectCapability, requireProjectMembership } from '../../auth/project-access.js';
import { env } from '../../config/env.js';
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

function csrfTokenFor(req: any, res: any): string {
  const tokenHash = res.locals.authSessionTokenHash;
  if (!req.auth || typeof tokenHash !== 'string') {
    throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  }
  return deriveCsrfToken(env.SESSION_SECRET, req.auth.sessionId, tokenHash);
}

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value;
}

export function createVisibilityHistoryWebRoutes(alertsService = new VisibilityAlertsService()) {
  const router = Router();
  router.use(
    '/projects/:id/visibility',
    requireAuthentication(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_READ'),
  );
  const writeGuards = [requireCsrf(), requireProjectCapability('CONTENT_WRITE')];

  router.get('/projects/:id/visibility/history', async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.id);
      await requireHistoryProject(projectId);
      const data = await visibilityHistoryWebRepository.getHistory(projectId);
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
      const projectId = routeParam(req.params.id);
      await requireHistoryProject(projectId);
      const data = await visibilityHistoryWebRepository.getAlerts(projectId);
      if (!data) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
      res.render('layout', {
        title: `Visibility 告警 · ${data.project.name}`,
        activeNav: 'visibility-alerts',
        currentProjectId: data.project.id,
        breadcrumbs: ['项目', data.project.name, 'AI Visibility', '告警'],
        bodyTemplate: 'visibility/alerts',
        csrfToken: csrfTokenFor(req, res),
        ...data
      });
    } catch (error) { next(error); }
  });

  router.post('/projects/:id/visibility/alerts/rules', ...writeGuards, async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.id);
      await requireHistoryProject(projectId);
      const formBody = { ...(req.body ?? {}) };
      delete formBody._csrf;
      const input = ruleForm.parse(formBody);
      try {
        await alertsService.createRule(projectId, input);
      } catch (error) { alertToHttp(error); }
      res.redirect(303, `/projects/${projectId}/visibility/alerts`);
    } catch (error) { next(error); }
  });

  router.post('/projects/:id/visibility/alerts/rules/:ruleId', ...writeGuards, async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.id);
      await requireHistoryProject(projectId);
      const formBody = { ...(req.body ?? {}) };
      delete formBody._csrf;
      const input = updateRuleForm.parse(formBody);
      try {
        await alertsService.updateRule(projectId, routeParam(req.params.ruleId), input);
      } catch (error) { alertToHttp(error); }
      res.redirect(303, `/projects/${projectId}/visibility/alerts`);
    } catch (error) { next(error); }
  });

  router.post('/projects/:id/visibility/alerts/:alertId/acknowledge', ...writeGuards, async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.id);
      await requireHistoryProject(projectId);
      try {
        await alertsService.acknowledge(projectId, routeParam(req.params.alertId));
      } catch (error) { alertToHttp(error); }
      res.redirect(303, `/projects/${projectId}/visibility/alerts`);
    } catch (error) { next(error); }
  });

  return router;
}

export const visibilityHistoryWebRoutes = createVisibilityHistoryWebRoutes();
