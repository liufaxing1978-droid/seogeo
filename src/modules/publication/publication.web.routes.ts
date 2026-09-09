import { Router } from 'express';
import { z } from 'zod';
import { requireAuthentication } from '../../auth/authentication.js';
import { deriveCsrfToken, requireCsrf } from '../../auth/csrf.js';
import { requireProjectCapability, requireProjectMembership } from '../../auth/project-access.js';
import { env } from '../../config/env.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { publicationService } from './publication.service.js';
import { publicationWebRepository } from './publication.web.repository.js';

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value;
}
const proposalQuerySchema = z.object({ proposalId: z.string().uuid().optional() }).strict();

function objectRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

const manualDraftFormSchema = z.object({
  title: z.string().trim().min(1).max(300),
  slugCandidate: z.string().trim().max(200).optional(),
  body: z.string().trim().min(1).max(200_000),
  excerpt: z.string().trim().max(2_000).optional(),
  metaTitle: z.string().trim().max(300).optional(),
  metaDescription: z.string().trim().max(1_000).optional(),
  canonicalCandidate: z.union([z.literal(''), z.string().url().max(2_048)]).optional(),
  author: z.string().trim().max(300).optional(),
  language: z.string().trim().min(2).max(32),
  reason: z.string().trim().min(1).max(1_000)
}).strict();

const sourceReferenceFormSchema = z.object({
  title: z.string().trim().min(1).max(500),
  sourceUrl: z.union([z.literal(''), z.string().url().max(2_048)]).optional(),
  sourceType: z.string().trim().min(1).max(64),
  author: z.string().trim().max(300).optional(),
  publisher: z.string().trim().max(300).optional()
}).strict();

function nullableText(value: string | undefined): string | null {
  return value ? value : null;
}

function csrfTokenFor(req: any, res: any): string {
  return deriveCsrfToken(env.SESSION_SECRET, req.auth!.sessionId, res.locals.authSessionTokenHash);
}

function validationModel(value: unknown) {
  const validation = objectRecord(value);
  return {
    canCreatePlan: validation.canCreatePlan === true,
    blockingCodes: stringArray(validation.blockingCodes),
    warningCodes: stringArray(validation.warningCodes),
    infoCodes: stringArray(validation.infoCodes),
    unconfirmedWarningCodes: stringArray(validation.unconfirmedWarningCodes),
    findings: Array.isArray(validation.findings) ? validation.findings.map(objectRecord) : []
  };
}

function previewModel(value: unknown) {
  const diff = objectRecord(value);
  const fileChanges = Array.isArray(diff.fileChanges) ? diff.fileChanges.map(objectRecord) : [];
  const files = [
    ...stringArray(diff.filesCreated),
    ...stringArray(diff.filesModified),
    ...fileChanges.map((item) => stringValue(item.path)).filter((item): item is string => Boolean(item))
  ];
  return {
    files: [...new Set(files)].sort((left, right) => left.localeCompare(right)),
    unifiedDiff: stringValue(diff.unifiedDiff) ?? '',
    raw: prettyJson(diff)
  };
}

function proposalMetadata(value: unknown) {
  const metadata = objectRecord(value);
  return {
    opportunityType: stringValue(metadata.opportunityType),
    normalizedQuery: stringValue(metadata.normalizedQuery),
    priority: stringValue(metadata.priority),
    score: typeof metadata.score === 'number' ? metadata.score : null
  };
}

function render(res: any, bodyTemplate: string, locals: Record<string, unknown>) {
  return res.render('layout', {
    activeNav: 'publication',
    currentProjectId: null,
    bodyTemplate,
    ...locals,
    title: 'P8-A 发布工作区'
  });
}

export const publicationWebRoutes = Router();

publicationWebRoutes.get('/projects/:id/publication', async (req, res, next) => {
  try {
    const projectId = routeParam(req.params.id);
    const model = await publicationWebRepository.getCenter(projectId);
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    const latestExecution = model.executions[0] ?? null;
    const latestVerification = model.verifications[0] ?? null;
    const primarySite = model.sites[0] ?? null;
    render(res, 'publication/index', {
      currentProjectId: model.project.id,
      ...model,
      latestExecution,
      latestVerification,
      primarySite,
      writeCapability: primarySite?.writeCapability ?? 'NOT_CONFIGURED',
      standardExportOnly: model.project.planLevel === 'STANDARD'
    });
  } catch (error) { next(error); }
});

publicationWebRoutes.get('/projects/:id/publication/opportunities',
  requireAuthentication(),
  requireProjectMembership(),
  requireProjectCapability('PROJECT_READ'),
  async (req, res, next) => {
  try {
    const projectId = routeParam(req.params.id);
    const proposalId = proposalQuerySchema.parse(req.query).proposalId;
    const model = await publicationWebRepository.listOpportunities(projectId, proposalId);
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    render(res, 'publication/opportunities', {
      currentProjectId: model.project.id,
      project: model.project,
      selectedProposalId: proposalId ?? null,
      proposals: model.proposals.map((proposal) => ({ ...proposal, metadata: proposalMetadata(proposal.sourceMetadata) }))
    });
  } catch (error) { next(error); }
  }
);

publicationWebRoutes.get('/projects/:id/publication/drafts', async (req, res, next) => {
  try {
    const projectId = routeParam(req.params.id);
    const model = await publicationWebRepository.listDrafts(projectId);
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    render(res, 'publication/drafts', {
      currentProjectId: model.project.id,
      ...model
    });
  } catch (error) { next(error); }
});

publicationWebRoutes.get(
  '/projects/:id/publication/drafts/new',
  requireAuthentication(),
  requireProjectMembership(),
  requireProjectCapability('CONTENT_WRITE'),
  async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.id);
      const model = await publicationWebRepository.listDrafts(projectId);
      if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
      render(res, 'publication/new-draft', {
        currentProjectId: model.project.id,
        project: model.project,
        values: { language: 'zh-CN', reason: '人工创建内容草稿' },
        errors: {},
        csrfToken: csrfTokenFor(req, res)
      });
    } catch (error) { next(error); }
  }
);

publicationWebRoutes.post(
  '/projects/:id/publication/drafts',
  requireAuthentication(),
  requireCsrf(),
  requireProjectMembership(),
  requireProjectCapability('CONTENT_WRITE'),
  async (req, res, next) => {
    const projectId = routeParam(req.params.id);
    const values = { ...(req.body ?? {}) } as Record<string, unknown>;
    delete values._csrf;
    try {
      const input = manualDraftFormSchema.parse(values);
      const proposal = await publicationService.createManualProposal(
        projectId,
        { reason: input.reason },
        `web:${req.auth!.userId}`
      );
      const draft = await publicationService.createDraftFromProposal(proposal.id, {
        title: input.title,
        slugCandidate: nullableText(input.slugCandidate),
        body: input.body,
        excerpt: nullableText(input.excerpt),
        metaTitle: nullableText(input.metaTitle),
        metaDescription: nullableText(input.metaDescription),
        canonicalCandidate: nullableText(input.canonicalCandidate),
        author: nullableText(input.author),
        language: input.language,
        generatedBy: 'HUMAN'
      });
      res.redirect(303, `/projects/${projectId}/publication/drafts/${draft.id}`);
    } catch (error) {
      if (!(error instanceof z.ZodError)) return next(error);
      const model = await publicationWebRepository.listDrafts(projectId).catch(() => null);
      if (!model) return next(error);
      res.status(400);
      render(res, 'publication/new-draft', {
        currentProjectId: model.project.id,
        project: model.project,
        values,
        errors: error.flatten().fieldErrors,
        csrfToken: csrfTokenFor(req, res)
      });
    }
  }
);

publicationWebRoutes.get('/projects/:id/publication/drafts/:draftId', requireAuthentication(), requireProjectMembership(), requireProjectCapability('PROJECT_READ'), async (req, res, next) => {
  try {
    const projectId = routeParam(req.params.id);
    const draftId = routeParam(req.params.draftId);
    const model = await publicationWebRepository.getDraft(projectId, draftId);
    if (!model) throw new NotFoundError('Content draft not found', 'PUBLICATION_DRAFT_NOT_FOUND');
    const latestPlan = model.draft.plans[0] ?? null;
    const validation = validationModel(latestPlan?.preview?.validationResult);
    render(res, 'publication/editor', {
      currentProjectId: model.project.id,
      ...model,
      latestPlan,
      validation,
      schemaJson: prettyJson(model.draft.schemaJson),
      csrfToken: csrfTokenFor(req, res),
      canDelete: !model.draft.plans.length && ['OWNER', 'ADMIN'].includes(res.locals.projectMembership.role)
    });
  } catch (error) { next(error); }
});

publicationWebRoutes.get('/projects/:id/publication/drafts/:draftId/manual-site-handoff',
  requireAuthentication(), requireProjectMembership(), requireProjectCapability('PROJECT_READ'), async (req, res, next) => {
    try {
      const model = await publicationWebRepository.getDraft(routeParam(req.params.id), routeParam(req.params.draftId));
      if (!model) throw new NotFoundError('Content draft not found', 'PUBLICATION_DRAFT_NOT_FOUND');
      render(res, 'publication/manual-site-handoff', {
        currentProjectId: model.project.id,
        ...model,
        csrfToken: csrfTokenFor(req, res),
        canWrite: res.locals.projectMembership.capabilities.includes('CONTENT_WRITE')
      });
    } catch (error) { next(error); }
  }
);

publicationWebRoutes.post('/projects/:id/publication/drafts/:draftId/manual-site-handoff/:state',
  requireAuthentication(), requireCsrf(), requireProjectMembership(), requireProjectCapability('CONTENT_WRITE'), async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.id); const draftId = routeParam(req.params.draftId);
      const target = routeParam(req.params.state);
      const status = target === 'ready' ? 'MAIN_SITE_HANDOFF' : target === 'published' ? 'MAIN_SITE_PUBLISHED' : null;
      if (!status) throw new NotFoundError('Manual handoff state not found', 'PUBLICATION_HANDOFF_STATE_NOT_FOUND');
      const model = await publicationWebRepository.getDraft(projectId, draftId);
      if (!model) throw new NotFoundError('Content draft not found', 'PUBLICATION_DRAFT_NOT_FOUND');
      if (model.draft.status === 'ARCHIVED') throw new AppError('Archived drafts cannot be handed off', 409, 'PUBLICATION_DRAFT_ARCHIVED');
      await publicationService.saveDraftVersion(draftId, model.draft.currentVersion, { status }, 'HUMAN');
      res.redirect(303, `/projects/${projectId}/publication/drafts/${draftId}/manual-site-handoff`);
    } catch (error) { next(error); }
  }
);

publicationWebRoutes.post('/projects/:id/publication/drafts/:draftId/delete',
  requireAuthentication(), requireCsrf(), requireProjectMembership(), requireProjectCapability('PROJECT_SETTINGS_WRITE'),
  async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.id); const draftId = routeParam(req.params.draftId);
      const draft = await prisma.contentDraft.findFirst({ where: { id: draftId, projectId }, include: { _count: { select: { plans: true } } } });
      if (!draft) throw new NotFoundError('Content draft not found', 'PUBLICATION_DRAFT_NOT_FOUND');
      if (draft._count.plans > 0) throw new AppError('Planned drafts cannot be deleted', 409, 'PUBLICATION_DRAFT_DELETE_BLOCKED');
      await prisma.contentDraft.delete({ where: { id: draft.id } });
      res.redirect(303, `/projects/${projectId}/publication/drafts`);
    } catch (error) { next(error); }
  }
);

publicationWebRoutes.get(
  '/projects/:id/publication/drafts/:draftId/edit',
  requireAuthentication(),
  requireProjectMembership(),
  requireProjectCapability('CONTENT_WRITE'),
  async (req, res, next) => {
    try {
      const model = await publicationWebRepository.getDraft(routeParam(req.params.id), routeParam(req.params.draftId));
      if (!model) throw new NotFoundError('Content draft not found', 'PUBLICATION_DRAFT_NOT_FOUND');
      if (model.draft.status === 'ARCHIVED') throw new AppError('Archived drafts cannot be edited', 409, 'PUBLICATION_DRAFT_ARCHIVED');
      render(res, 'publication/edit-draft', { currentProjectId: model.project.id, ...model, values: model.draft, errors: {}, csrfToken: csrfTokenFor(req, res) });
    } catch (error) { next(error); }
  }
);

publicationWebRoutes.post(
  '/projects/:id/publication/drafts/:draftId',
  requireAuthentication(), requireCsrf(), requireProjectMembership(), requireProjectCapability('CONTENT_WRITE'),
  async (req, res, next) => {
    const projectId = routeParam(req.params.id); const draftId = routeParam(req.params.draftId);
    const values = { ...(req.body ?? {}) } as Record<string, unknown>; delete values._csrf;
    try {
      const input = manualDraftFormSchema.parse({ ...values, reason: '保存人工草稿新版本' });
      const model = await publicationWebRepository.getDraft(projectId, draftId);
      if (!model) throw new NotFoundError('Content draft not found', 'PUBLICATION_DRAFT_NOT_FOUND');
      if (model.draft.status === 'ARCHIVED') throw new AppError('Archived drafts cannot be edited', 409, 'PUBLICATION_DRAFT_ARCHIVED');
      await publicationService.saveDraftVersion(draftId, model.draft.currentVersion, {
        title: input.title, slugCandidate: nullableText(input.slugCandidate), body: input.body, excerpt: nullableText(input.excerpt), metaTitle: nullableText(input.metaTitle), metaDescription: nullableText(input.metaDescription), canonicalCandidate: nullableText(input.canonicalCandidate), author: nullableText(input.author), language: input.language
      }, 'HUMAN');
      res.redirect(303, `/projects/${projectId}/publication/drafts/${draftId}`);
    } catch (error) {
      if (!(error instanceof z.ZodError)) return next(error);
      const model = await publicationWebRepository.getDraft(projectId, draftId).catch(() => null); if (!model) return next(error);
      res.status(400); render(res, 'publication/edit-draft', { currentProjectId: model.project.id, ...model, values, errors: error.flatten().fieldErrors, csrfToken: csrfTokenFor(req, res) });
    }
  }
);

publicationWebRoutes.post(
  '/projects/:id/publication/drafts/:draftId/archive',
  requireAuthentication(),
  requireCsrf(),
  requireProjectMembership(),
  requireProjectCapability('CONTENT_WRITE'),
  async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.id);
      const draftId = routeParam(req.params.draftId);
      const model = await publicationWebRepository.getDraft(projectId, draftId);
      if (!model) throw new NotFoundError('Content draft not found', 'PUBLICATION_DRAFT_NOT_FOUND');
      if (model.draft.plans.length > 0) {
        throw new AppError('Planned drafts cannot be archived', 409, 'PUBLICATION_DRAFT_ARCHIVE_BLOCKED');
      }
      await publicationService.saveDraftVersion(draftId, model.draft.currentVersion, { status: 'ARCHIVED' }, 'HUMAN');
      res.redirect(303, `/projects/${projectId}/publication/drafts/${draftId}`);
    } catch (error) { next(error); }
  }
);

publicationWebRoutes.get(
  '/projects/:id/publication/drafts/:draftId/sources/new',
  requireAuthentication(),
  requireProjectMembership(),
  requireProjectCapability('CONTENT_WRITE'),
  async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.id);
      const draftId = routeParam(req.params.draftId);
      const model = await publicationWebRepository.getDraft(projectId, draftId);
      if (!model) throw new NotFoundError('Content draft not found', 'PUBLICATION_DRAFT_NOT_FOUND');
      render(res, 'publication/new-source-reference', {
        currentProjectId: model.project.id,
        project: model.project,
        draft: model.draft,
        values: { sourceType: 'PUBLIC_WEB' },
        errors: {},
        csrfToken: csrfTokenFor(req, res)
      });
    } catch (error) { next(error); }
  }
);

publicationWebRoutes.post(
  '/projects/:id/publication/drafts/:draftId/sources',
  requireAuthentication(),
  requireCsrf(),
  requireProjectMembership(),
  requireProjectCapability('CONTENT_WRITE'),
  async (req, res, next) => {
    const projectId = routeParam(req.params.id);
    const draftId = routeParam(req.params.draftId);
    const values = { ...(req.body ?? {}) } as Record<string, unknown>;
    delete values._csrf;
    try {
      const input = sourceReferenceFormSchema.parse(values);
      const model = await publicationWebRepository.getDraft(projectId, draftId);
      if (!model) throw new NotFoundError('Content draft not found', 'PUBLICATION_DRAFT_NOT_FOUND');
      await publicationService.addSourceReference(draftId, {
        title: input.title,
        sourceUrl: nullableText(input.sourceUrl),
        sourceType: input.sourceType,
        author: nullableText(input.author),
        publisher: nullableText(input.publisher),
        userProvided: true
      });
      res.redirect(303, `/projects/${projectId}/publication/drafts/${draftId}`);
    } catch (error) {
      if (!(error instanceof z.ZodError)) return next(error);
      const model = await publicationWebRepository.getDraft(projectId, draftId).catch(() => null);
      if (!model) return next(error);
      res.status(400);
      render(res, 'publication/new-source-reference', {
        currentProjectId: model.project.id,
        project: model.project,
        draft: model.draft,
        values,
        errors: error.flatten().fieldErrors,
        csrfToken: csrfTokenFor(req, res)
      });
    }
  }
);

publicationWebRoutes.get('/projects/:id/publication/plans/:planId', async (req, res, next) => {
  try {
    const projectId = routeParam(req.params.id);
    const planId = routeParam(req.params.planId);
    const model = await publicationWebRepository.getPlan(projectId, planId);
    if (!model) throw new NotFoundError('Publication plan not found', 'PUBLICATION_PLAN_NOT_FOUND');
    const validation = validationModel(model.plan.preview?.validationResult);
    const preview = previewModel(model.plan.preview?.diffPayload);
    render(res, 'publication/preview', {
      currentProjectId: model.project.id,
      ...model,
      validation,
      preview,
      approvalAvailable: validation.canCreatePlan && model.plan.riskClass !== 'HIGH',
      latestExecution: model.plan.executions[0] ?? null,
      gitCapable: model.project.planLevel !== 'STANDARD' && model.plan.site.writeCapability === 'GIT_DRAFT_PR'
    });
  } catch (error) { next(error); }
});

publicationWebRoutes.get('/projects/:id/publication/executions/:executionId', async (req, res, next) => {
  try {
    const projectId = routeParam(req.params.id);
    const executionId = routeParam(req.params.executionId);
    const model = await publicationWebRepository.getExecution(projectId, executionId);
    if (!model) throw new NotFoundError('Publication execution not found', 'PUBLICATION_EXECUTION_NOT_FOUND');
    render(res, 'publication/show', {
      currentProjectId: model.project.id,
      ...model,
      staleReviewRequired: model.execution.status === 'STALE_REVIEW_REQUIRED'
        || model.execution.status === 'APPROVAL_STALE'
        || model.execution.status === 'TARGET_REVISION_CHANGED'
    });
  } catch (error) { next(error); }
});

publicationWebRoutes.get('/projects/:id/publication/verifications/:verificationId', async (req, res, next) => {
  try {
    const projectId = routeParam(req.params.id);
    const verificationId = routeParam(req.params.verificationId);
    const model = await publicationWebRepository.getVerification(projectId, verificationId);
    if (!model) throw new NotFoundError('Publication verification not found', 'PUBLICATION_VERIFICATION_NOT_FOUND');
    render(res, 'publication/verification', {
      currentProjectId: model.project.id,
      ...model,
      regressionFindings: stringArray(model.verification.regressionFindings)
    });
  } catch (error) { next(error); }
});
