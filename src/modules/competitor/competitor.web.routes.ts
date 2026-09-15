import { Router } from 'express';
import { requireAuthentication } from '../../auth/authentication.js';
import { deriveCsrfToken, requireCsrf } from '../../auth/csrf.js';
import { requireProjectCapability, requireProjectMembership } from '../../auth/project-access.js';
import { env } from '../../config/env.js';
import { hasFeature } from '../../auth/feature-flags.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { createCompetitorGapTask } from '../ai/competitor-intelligence.js';
import { aiTaskService } from '../ai/ai.service.js';
import { createCompetitorComparison } from './competitor-comparison.js';
import { competitorService } from './competitor.service.js';
import { competitorWebRepository } from './competitor.web.repository.js';

export const competitorWebRoutes = Router();
competitorWebRoutes.use('/projects/:id/competitors', requireAuthentication(), requireProjectMembership(), requireProjectCapability('PROJECT_READ'));
const competitorWriteGuards = [requireCsrf(), requireProjectCapability('CONTENT_WRITE')];

function render(res: any, bodyTemplate: string, locals: Record<string, unknown>) {
  return res.render('layout', { title: '竞争对手', activeNav: 'competitors', currentProjectId: null, bodyTemplate, ...locals });
}
function csrfTokenFor(req: any, res: any) { return deriveCsrfToken(env.SESSION_SECRET, req.auth!.sessionId, res.locals.authSessionTokenHash); }

function assertFeature(project: { planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE' }) {
  if (!hasFeature(project.planLevel, 'COMPETITOR_INTELLIGENCE')) {
    throw new AppError('Competitor Intelligence is not available for this project plan', 403, 'FEATURE_NOT_AVAILABLE');
  }
}

competitorWebRoutes.get('/projects/:id/competitors', async (req, res, next) => {
  try {
    const model = await competitorWebRepository.getCenter((Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id));
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    assertFeature(model.project);
    render(res, 'competitors/index', { title: '竞争对手中心', currentProjectId: model.project.id, csrfToken: csrfTokenFor(req, res), ...model });
  } catch (error) { next(error); }
});

competitorWebRoutes.post('/projects/:id/competitors', ...competitorWriteGuards, async (req, res, next) => {
  try {
    const model = await competitorWebRepository.getCenter((Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id));
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    assertFeature(model.project);
    await competitorService.createCompetitor(model.project.id, {
      name: String(req.body?.name ?? ''),
      domain: String(req.body?.domain ?? '')
    });
    res.redirect(303, `/projects/${model.project.id}/competitors`);
  } catch (error) { next(error); }
});

competitorWebRoutes.get('/projects/:id/competitors/:competitorId', async (req, res, next) => {
  try {
    const model = await competitorWebRepository.getDetail((Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id), (Array.isArray(req.params.competitorId) ? req.params.competitorId[0]! : req.params.competitorId));
    if (!model) throw new NotFoundError('Competitor not found', 'COMPETITOR_NOT_FOUND');
    assertFeature(model.project);
    render(res, 'competitors/show', { title: model.competitor.name, currentProjectId: model.project.id, csrfToken: csrfTokenFor(req, res), ...model });
  } catch (error) { next(error); }
});

competitorWebRoutes.post('/projects/:id/competitors/:competitorId/crawls', ...competitorWriteGuards, async (req, res, next) => {
  try {
    const model = await competitorWebRepository.getDetail((Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id), (Array.isArray(req.params.competitorId) ? req.params.competitorId[0]! : req.params.competitorId));
    if (!model) throw new NotFoundError('Competitor not found', 'COMPETITOR_NOT_FOUND');
    assertFeature(model.project);
    const maxPages = req.body?.maxPages === undefined || req.body?.maxPages === '' ? undefined : Number(req.body.maxPages);
    await competitorService.createCrawl(model.project.id, model.competitor.id, { maxPages });
    res.redirect(303, `/projects/${model.project.id}/competitors/${model.competitor.id}`);
  } catch (error) { next(error); }
});

competitorWebRoutes.post('/projects/:id/competitors/:competitorId/compare', ...competitorWriteGuards, async (req, res, next) => {
  try {
    const model = await competitorWebRepository.getDetail((Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id), (Array.isArray(req.params.competitorId) ? req.params.competitorId[0]! : req.params.competitorId));
    if (!model) throw new NotFoundError('Competitor not found', 'COMPETITOR_NOT_FOUND');
    assertFeature(model.project);
    await createCompetitorComparison(model.project.id, model.competitor.id);
    res.redirect(303, `/projects/${model.project.id}/competitors/${model.competitor.id}`);
  } catch (error) { next(error); }
});

competitorWebRoutes.post('/projects/:id/competitors/comparisons/:comparisonId/ai', ...competitorWriteGuards, async (req, res, next) => {
  try {
    const model = await competitorWebRepository.getCenter((Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id));
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    assertFeature(model.project);
    const task = await createCompetitorGapTask(model.project.id, (Array.isArray(req.params.comparisonId) ? req.params.comparisonId[0]! : req.params.comparisonId), aiTaskService);
    res.redirect(303, `/projects/${model.project.id}/ai/tasks/${task.id}`);
  } catch (error) { next(error); }
});
