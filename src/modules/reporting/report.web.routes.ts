import { Router } from 'express';
import { requireAuthentication } from '../../auth/authentication.js';
import { deriveCsrfToken, requireCsrf } from '../../auth/csrf.js';
import { hasFeature } from '../../auth/feature-flags.js';
import { requireProjectCapability, requireProjectMembership } from '../../auth/project-access.js';
import { env } from '../../config/env.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { createReportExecutiveSummaryTask } from '../ai/report-intelligence.js';
import { aiTaskService } from '../ai/ai.service.js';
import { generateProjectReport, generateProjectReportV2 } from './report-builder.js';
import { reportWebRepository } from './report.web.repository.js';

export const reportWebRoutes = Router();
reportWebRoutes.use('/projects/:id/reports', requireAuthentication(), requireProjectMembership(), requireProjectCapability('PROJECT_READ'));
const reportWriteGuards = [requireCsrf(), requireProjectCapability('CONTENT_WRITE')];

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value;
}

function render(res: any, bodyTemplate: string, locals: Record<string, unknown>) {
  return res.render('layout', { title: '报告', activeNav: 'reports', currentProjectId: null, bodyTemplate, ...locals });
}

function csrfTokenFor(req: any, res: any) {
  return deriveCsrfToken(env.SESSION_SECRET, req.auth.sessionId, res.locals.authSessionTokenHash);
}

function assertFeature(project: { planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE' }) {
  if (!hasFeature(project.planLevel, 'REPORTING')) throw new AppError('Reporting is not available for this project plan', 403, 'FEATURE_NOT_AVAILABLE');
}

reportWebRoutes.get('/projects/:id/reports', async (req, res, next) => {
  try {
    const model = await reportWebRepository.getCenter(routeParam(req.params.id));
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    assertFeature(model.project);
    render(res, 'reports/index', { title: '报告中心', currentProjectId: model.project.id, csrfToken: csrfTokenFor(req, res), ...model });
  } catch (error) { next(error); }
});

reportWebRoutes.post('/projects/:id/reports', ...reportWriteGuards, async (req, res, next) => {
  try {
    const model = await reportWebRepository.getCenter(routeParam(req.params.id));
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    assertFeature(model.project);
    await generateProjectReport(model.project.id);
    res.redirect(303, `/projects/${model.project.id}/reports`);
  } catch (error) { next(error); }
});

reportWebRoutes.post('/projects/:id/reports/v2', ...reportWriteGuards, async (req, res, next) => {
  try {
    const model = await reportWebRepository.getCenter(routeParam(req.params.id));
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    assertFeature(model.project);
    await generateProjectReportV2(model.project.id);
    res.redirect(303, `/projects/${model.project.id}/reports`);
  } catch (error) { next(error); }
});

reportWebRoutes.get('/projects/:id/reports/:reportId', async (req, res, next) => {
  try {
    const model = await reportWebRepository.getDetail(routeParam(req.params.id), routeParam(req.params.reportId));
    if (!model) throw new NotFoundError('Report not found', 'REPORT_NOT_FOUND');
    assertFeature(model.project);
    render(res, 'reports/show', { title: '项目报告', currentProjectId: model.project.id, csrfToken: csrfTokenFor(req, res), ...model });
  } catch (error) { next(error); }
});

reportWebRoutes.post('/projects/:id/reports/:reportId/ai-summary', ...reportWriteGuards, async (req, res, next) => {
  try {
    const model = await reportWebRepository.getDetail(routeParam(req.params.id), routeParam(req.params.reportId));
    if (!model) throw new NotFoundError('Report not found', 'REPORT_NOT_FOUND');
    assertFeature(model.project);
    const task = await createReportExecutiveSummaryTask(model.project.id, model.report.id, aiTaskService);
    res.redirect(303, `/projects/${model.project.id}/ai/tasks/${task.id}`);
  } catch (error) { next(error); }
});
