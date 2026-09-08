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
import { contentQualityService, type ContentQualityService } from './content-quality.service.js';
import { contentService } from './content.service.js';
import { contentWebRepository } from './content.web.repository.js';

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

type EvidenceSnapshotView = {
  snapshotId?: string;
  capturedAt?: unknown;
  wordCount?: unknown;
  title?: unknown;
  h1?: unknown;
  statusCode?: unknown;
  contentType?: unknown;
  indexable?: unknown;
};

type QualityEvidenceModel = {
  status: string;
  references: Array<{ type: 'PAGE_SNAPSHOT' | 'CONTENT_OPPORTUNITY' | 'CONTENT_SIGNAL'; id: string }>;
  before: EvidenceSnapshotView;
  after: EvidenceSnapshotView;
  internalLink: { observed: number | null; required: number | null } | null;
  p5Qa: {
    opportunity: { id: string | null; key: string | null; version: number | null; status: string | null } | null;
    signal: { id: string | null; ruleKey: string | null; ruleVersion: number | null; status: string | null } | null;
  } | null;
  sourceSnapshotCapturedAt?: unknown;
};

function snapshotValues(snapshot: Record<string, unknown> | undefined): EvidenceSnapshotView {
  if (!snapshot) return {};
  return {
    snapshotId: nullableString(snapshot.id) ?? undefined,
    capturedAt: snapshot.capturedAt,
    wordCount: snapshot.wordCount,
    title: snapshot.title,
    h1: snapshot.h1,
    statusCode: snapshot.statusCode,
    contentType: snapshot.contentType,
    indexable: snapshot.indexable,
  };
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function evidenceModel(value: unknown, snapshots: Array<Record<string, unknown>> = []): QualityEvidenceModel {
  const evidence = record(value);
  const references: QualityEvidenceModel['references'] = [];
  if (Array.isArray(evidence.sourceReferences)) {
    for (const source of evidence.sourceReferences) {
      const reference = record(source);
      const id = nullableString(reference.id);
      if (!id) continue;
      if (reference.type === 'PAGE_SNAPSHOT') references.push({ type: 'PAGE_SNAPSHOT', id });
      if (reference.type === 'CONTENT_OPPORTUNITY') references.push({ type: 'CONTENT_OPPORTUNITY', id });
      if (reference.type === 'CONTENT_SIGNAL') references.push({ type: 'CONTENT_SIGNAL', id });
    }
  }
  const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const previousId = typeof evidence.previousSnapshotId === 'string' ? evidence.previousSnapshotId : undefined;
  const currentId = typeof evidence.currentSnapshotId === 'string' ? evidence.currentSnapshotId : undefined;
  const observedInternalLinkCount = nullableNumber(evidence.observedInternalLinkCount);
  const requiredInternalLinkCount = nullableNumber(evidence.requiredInternalLinkCount);
  const opportunityId = nullableString(evidence.p5OpportunityId);
  const opportunityKey = nullableString(evidence.p5OpportunityKey);
  const opportunityVersion = nullableNumber(evidence.p5OpportunityVersion);
  const opportunityStatus = nullableString(evidence.p5OpportunityStatus);
  const signalId = nullableString(evidence.p5SignalId);
  const signalRuleKey = nullableString(evidence.p5SignalRuleKey);
  const signalRuleVersion = nullableNumber(evidence.p5SignalRuleVersion);
  const signalStatus = nullableString(evidence.p5SignalStatus);
  const sourceSnapshotCapturedAt = snapshotById.get(currentId)?.capturedAt
    ?? references.map((reference) => snapshotById.get(reference.id)?.capturedAt).find((capturedAt) => capturedAt !== undefined);
  return {
    status: typeof evidence.status === 'string' ? evidence.status : 'UNKNOWN',
    references,
    before: {
      ...snapshotValues(snapshotById.get(previousId)),
      ...(evidence.previousWordCount !== undefined ? { wordCount: evidence.previousWordCount } : {}),
    },
    after: {
      ...snapshotValues(snapshotById.get(currentId)),
      ...(evidence.currentWordCount !== undefined ? { wordCount: evidence.currentWordCount } : {}),
    },
    internalLink: observedInternalLinkCount !== null || requiredInternalLinkCount !== null
      ? { observed: observedInternalLinkCount, required: requiredInternalLinkCount }
      : null,
    p5Qa: opportunityId || opportunityKey || opportunityVersion !== null || opportunityStatus || signalId || signalRuleKey || signalRuleVersion !== null || signalStatus
      ? {
        opportunity: opportunityId || opportunityKey || opportunityVersion !== null || opportunityStatus
          ? { id: opportunityId, key: opportunityKey, version: opportunityVersion, status: opportunityStatus }
          : null,
        signal: signalId || signalRuleKey || signalRuleVersion !== null || signalStatus
          ? { id: signalId, ruleKey: signalRuleKey, ruleVersion: signalRuleVersion, status: signalStatus }
          : null,
      }
      : null,
    sourceSnapshotCapturedAt,
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
function optionalQualityFilter<T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess((value) => value === '' ? undefined : value, z.enum(values).optional());
}
const qualityFilterSchema = z.object({
  status: optionalQualityFilter(['OPEN', 'IN_REVIEW', 'ACCEPTED', 'DISMISSED']),
  category: optionalQualityFilter(['INTERNAL_LINK_SUPPORT', 'CONTENT_DECAY', 'CONTENT_QA']),
  priority: optionalQualityFilter(['INFO', 'LOW', 'MEDIUM', 'HIGH']),
}).strict();
type QualityFilters = {
  status?: 'OPEN' | 'IN_REVIEW' | 'ACCEPTED' | 'DISMISSED';
  category?: 'INTERNAL_LINK_SUPPORT' | 'CONTENT_DECAY' | 'CONTENT_QA';
  priority?: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';
};

export function createContentWebRoutes(
  qualityService: Pick<ContentQualityService, 'enqueueRun'> = contentQualityService,
) {
  const contentWebRoutes = Router();

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
    const filters = qualityFilterSchema.parse(req.query) as QualityFilters;
    const model = await contentWebRepository.getQualityCenter(projectId, filters);
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    assertFeature(model.project);
    const membership = res.locals.projectMembership as { role: Parameters<typeof hasProjectCapability>[0] };
    render(res, 'content/quality-index', {
      title: '内容质量建议',
      currentProjectId: model.project.id,
      csrfToken: csrfTokenFor(req, res),
      canWriteQuality: hasProjectCapability(membership.role, 'CONTENT_WRITE'),
      evidenceModel,
      filters,
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
    await qualityService.enqueueRun(model.project.id, req.auth!.userId);
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

return contentWebRoutes;
}

export const contentWebRoutes = createContentWebRoutes();
