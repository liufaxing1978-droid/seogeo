import { Router } from 'express';
import { z } from 'zod';
import { requireAuthentication } from '../../auth/authentication.js';
import { deriveCsrfToken, requireCsrf } from '../../auth/csrf.js';
import { hasFeature } from '../../auth/feature-flags.js';
import { hasProjectCapability } from '../../auth/project-capabilities.js';
import { requireProjectCapability, requireProjectMembership } from '../../auth/project-access.js';
import { env } from '../../config/env.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { createContentBriefTask, createContentOptimizationTask } from '../ai/content-intelligence.js';
import { aiTaskService } from '../ai/ai.service.js';
import { contentQualityRepository } from './content-quality.repository.js';
import { contentQualityService } from './content-quality.service.js';
import { contentService } from './content.service.js';
import { contentWebRepository } from './content.web.repository.js';

export const contentWebRoutes = Router();

function render(res: any, bodyTemplate: string, locals: Record<string, unknown>) {
  return res.render('layout', { title: '内容', activeNav: 'content', currentProjectId: null, bodyTemplate, ...locals });
}

function assertFeature(project: { planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE' }) {
  if (!hasFeature(project.planLevel, 'CONTENT_INTELLIGENCE')) throw new AppError('Content Intelligence is not available for this project plan', 403, 'FEATURE_NOT_AVAILABLE');
}

function routeParam(value: string | string[] | undefined): string {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  return normalized;
}

function csrfTokenFor(req: any, res: any): string {
  const tokenHash = res.locals.authSessionTokenHash;
  if (!req.auth || typeof tokenHash !== 'string') {
    throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  }
  return deriveCsrfToken(env.SESSION_SECRET, req.auth.sessionId, tokenHash);
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function snapshotValues(snapshot: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!snapshot) return {};
  return {
    snapshotId: snapshot.id,
    capturedAt: snapshot.capturedAt,
    wordCount: snapshot.wordCount,
    title: snapshot.title,
    h1: snapshot.h1,
    statusCode: snapshot.statusCode,
    contentType: snapshot.contentType,
    indexable: snapshot.indexable,
  };
}

function evidenceModel(value: unknown, snapshots: Array<Record<string, unknown>> = []) {
  const evidence = record(value);
  const references = Array.isArray(evidence.sourceReferences)
    ? evidence.sourceReferences.map(record).filter((reference) => typeof reference.id === 'string')
    : [];
  const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const previousId = typeof evidence.previousSnapshotId === 'string' ? evidence.previousSnapshotId : undefined;
  const currentId = typeof evidence.currentSnapshotId === 'string' ? evidence.currentSnapshotId : undefined;
  const explicitBefore = record(evidence.before);
  const explicitAfter = record(evidence.after);
  return {
    status: typeof evidence.status === 'string' ? evidence.status : 'UNKNOWN',
    references,
    before: Object.keys(explicitBefore).length ? explicitBefore : {
      ...snapshotValues(snapshotById.get(previousId)),
      ...(evidence.previousWordCount !== undefined ? { wordCount: evidence.previousWordCount } : {}),
    },
    after: Object.keys(explicitAfter).length ? explicitAfter : {
      ...snapshotValues(snapshotById.get(currentId)),
      ...(evidence.currentWordCount !== undefined ? { wordCount: evidence.currentWordCount } : {}),
    },
  };
}

function qualityError(error: unknown): unknown {
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

const qualityReadGuards = [
  requireAuthentication(),
  requireProjectMembership(),
  requireProjectCapability('PROJECT_READ'),
];
const qualityWriteGuards = [
  requireAuthentication(),
  requireCsrf(),
  requireProjectMembership(),
  requireProjectCapability('CONTENT_WRITE'),
];
const qualityTransitionSchema = z.object({
  status: z.enum(['IN_REVIEW', 'DISMISSED']),
  reason: z.string().trim().min(1).max(1_000),
});

contentWebRoutes.get('/projects/:id/content', async (req, res, next) => {
  try {
    const model = await contentWebRepository.getCenter(req.params.id);
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    assertFeature(model.project);
    render(res, 'content/index', { title: '内容中心', currentProjectId: model.project.id, ...model });
  } catch (error) { next(error); }
});

contentWebRoutes.get('/projects/:id/content/quality', ...qualityReadGuards, async (req, res, next) => {
  try {
    const projectId = routeParam(req.params.id);
    const model = await contentWebRepository.getQualityCenter(projectId);
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    assertFeature(model.project);
    const membership = res.locals.projectMembership as { role: Parameters<typeof hasProjectCapability>[0] };
    render(res, 'content/quality-index', {
      title: '内容质量建议',
      currentProjectId: model.project.id,
      csrfToken: csrfTokenFor(req, res),
      canWriteQuality: hasProjectCapability(membership.role, 'CONTENT_WRITE'),
      evidenceModel,
      ...model,
    });
  } catch (error) { next(qualityError(error)); }
});

contentWebRoutes.post('/projects/:id/content/quality/runs', ...qualityWriteGuards, async (req, res, next) => {
  try {
    const projectId = routeParam(req.params.id);
    const model = await contentWebRepository.getQualityCenter(projectId);
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    assertFeature(model.project);
    await contentQualityService.enqueueRun(model.project.id, req.auth!.userId);
    res.redirect(303, `/projects/${model.project.id}/content/quality`);
  } catch (error) { next(qualityError(error)); }
});

contentWebRoutes.get('/projects/:id/content/quality/:findingId', ...qualityReadGuards, async (req, res, next) => {
  try {
    const projectId = routeParam(req.params.id);
    const findingId = routeParam(req.params.findingId);
    const model = await contentWebRepository.getQualityFinding(projectId, findingId);
    if (!model) throw new NotFoundError('Content quality finding not found', 'CONTENT_QUALITY_FINDING_NOT_FOUND');
    assertFeature(model.project);
    const membership = res.locals.projectMembership as { role: Parameters<typeof hasProjectCapability>[0] };
    render(res, 'content/quality-detail', {
      title: '内容质量建议详情',
      currentProjectId: model.project.id,
      csrfToken: csrfTokenFor(req, res),
      canWriteQuality: hasProjectCapability(membership.role, 'CONTENT_WRITE'),
      evidence: evidenceModel(model.finding.evidence, model.finding.evidenceSnapshots),
      ...model,
    });
  } catch (error) { next(qualityError(error)); }
});

contentWebRoutes.post('/projects/:id/content/quality/:findingId/transition', ...qualityWriteGuards, async (req, res, next) => {
  try {
    const projectId = routeParam(req.params.id);
    const findingId = routeParam(req.params.findingId);
    const body = qualityTransitionSchema.parse({ status: req.body?.status, reason: req.body?.reason });
    const model = await contentWebRepository.getQualityFinding(projectId, findingId);
    if (!model) throw new NotFoundError('Content quality finding not found', 'CONTENT_QUALITY_FINDING_NOT_FOUND');
    assertFeature(model.project);
    await contentQualityRepository.transitionFinding(model.project.id, model.finding.id, body.status, req.auth!.userId, body.reason);
    res.redirect(303, `/projects/${model.project.id}/content/quality/${model.finding.id}`);
  } catch (error) { next(qualityError(error)); }
});

contentWebRoutes.post('/projects/:id/content/quality/:findingId/accept', ...qualityWriteGuards, async (req, res, next) => {
  try {
    const projectId = routeParam(req.params.id);
    const findingId = routeParam(req.params.findingId);
    const model = await contentWebRepository.getQualityFinding(projectId, findingId);
    if (!model) throw new NotFoundError('Content quality finding not found', 'CONTENT_QUALITY_FINDING_NOT_FOUND');
    assertFeature(model.project);
    const proposal = await contentQualityRepository.acceptFinding(model.project.id, model.finding.id, req.auth!.userId);
    res.redirect(303, `/projects/${model.project.id}/publication/opportunities?proposalId=${encodeURIComponent(proposal.id)}`);
  } catch (error) { next(qualityError(error)); }
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
