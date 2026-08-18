import { Router } from 'express';
import { hasFeature } from '../../auth/feature-flags.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { createContentBriefTask, createContentOptimizationTask } from '../ai/content-intelligence.js';
import { aiTaskService } from '../ai/ai.service.js';
import { contentService } from './content.service.js';
import { contentWebRepository } from './content.web.repository.js';

export const contentWebRoutes = Router();

function render(res: any, bodyTemplate: string, locals: Record<string, unknown>) {
  return res.render('layout', { title: '内容', activeNav: 'content', currentProjectId: null, bodyTemplate, ...locals });
}

function assertFeature(project: { planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE' }) {
  if (!hasFeature(project.planLevel, 'CONTENT_INTELLIGENCE')) throw new AppError('Content Intelligence is not available for this project plan', 403, 'FEATURE_NOT_AVAILABLE');
}

contentWebRoutes.get('/projects/:id/content', async (req, res, next) => {
  try {
    const model = await contentWebRepository.getCenter(req.params.id);
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    assertFeature(model.project);
    render(res, 'content/index', { title: '内容中心', currentProjectId: model.project.id, ...model });
  } catch (error) { next(error); }
});

contentWebRoutes.post('/projects/:id/content/refresh', async (req, res, next) => {
  try {
    const model = await contentWebRepository.getCenter(req.params.id);
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    assertFeature(model.project);
    await contentService.enqueueRefresh(model.project.id);
    res.redirect(303, `/projects/${model.project.id}/content`);
  } catch (error) { next(error); }
});

contentWebRoutes.get('/projects/:id/content/documents/:documentId', async (req, res, next) => {
  try {
    const model = await contentWebRepository.getDocument(req.params.id, req.params.documentId);
    if (!model) throw new NotFoundError('Content document not found', 'CONTENT_DOCUMENT_NOT_FOUND');
    assertFeature(model.project);
    render(res, 'content/document-show', { title: model.document.title ?? '内容详情', currentProjectId: model.project.id, ...model });
  } catch (error) { next(error); }
});

contentWebRoutes.post('/projects/:id/content/documents/:documentId/brief', async (req, res, next) => {
  try {
    const model = await contentWebRepository.getDocument(req.params.id, req.params.documentId);
    if (!model) throw new NotFoundError('Content document not found', 'CONTENT_DOCUMENT_NOT_FOUND');
    assertFeature(model.project);
    const task = await createContentBriefTask(model.project.id, model.document.id, aiTaskService);
    res.redirect(303, `/projects/${model.project.id}/ai/tasks/${task.id}`);
  } catch (error) { next(error); }
});

contentWebRoutes.post('/projects/:id/content/documents/:documentId/optimization', async (req, res, next) => {
  try {
    const model = await contentWebRepository.getDocument(req.params.id, req.params.documentId);
    if (!model) throw new NotFoundError('Content document not found', 'CONTENT_DOCUMENT_NOT_FOUND');
    assertFeature(model.project);
    const task = await createContentOptimizationTask(model.project.id, model.document.id, aiTaskService);
    res.redirect(303, `/projects/${model.project.id}/ai/tasks/${task.id}`);
  } catch (error) { next(error); }
});

contentWebRoutes.get('/projects/:id/content/briefs/:briefId', async (req, res, next) => {
  try {
    const model = await contentWebRepository.getBrief(req.params.id, req.params.briefId);
    if (!model) throw new NotFoundError('Content brief not found', 'CONTENT_BRIEF_NOT_FOUND');
    assertFeature(model.project);
    render(res, 'content/brief-show', { title: '内容 Brief', currentProjectId: model.project.id, ...model });
  } catch (error) { next(error); }
});
