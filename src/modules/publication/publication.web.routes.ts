import { Router } from 'express';
import { NotFoundError } from '../../core/errors.js';
import { publicationWebRepository } from './publication.web.repository.js';

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value;
}

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
    title: '内容与发布',
    activeNav: 'publication',
    currentProjectId: null,
    bodyTemplate,
    ...locals
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
      title: '内容与发布',
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

publicationWebRoutes.get('/projects/:id/publication/opportunities', async (req, res, next) => {
  try {
    const projectId = routeParam(req.params.id);
    const model = await publicationWebRepository.listOpportunities(projectId);
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    render(res, 'publication/opportunities', {
      title: '内容机会',
      currentProjectId: model.project.id,
      project: model.project,
      proposals: model.proposals.map((proposal) => ({ ...proposal, metadata: proposalMetadata(proposal.sourceMetadata) }))
    });
  } catch (error) { next(error); }
});

publicationWebRoutes.get('/projects/:id/publication/drafts', async (req, res, next) => {
  try {
    const projectId = routeParam(req.params.id);
    const model = await publicationWebRepository.listDrafts(projectId);
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    render(res, 'publication/drafts', {
      title: '内容草稿',
      currentProjectId: model.project.id,
      ...model
    });
  } catch (error) { next(error); }
});

publicationWebRoutes.get('/projects/:id/publication/drafts/:draftId', async (req, res, next) => {
  try {
    const projectId = routeParam(req.params.id);
    const draftId = routeParam(req.params.draftId);
    const model = await publicationWebRepository.getDraft(projectId, draftId);
    if (!model) throw new NotFoundError('Content draft not found', 'PUBLICATION_DRAFT_NOT_FOUND');
    const latestPlan = model.draft.plans[0] ?? null;
    const validation = validationModel(latestPlan?.preview?.validationResult);
    render(res, 'publication/editor', {
      title: model.draft.title,
      currentProjectId: model.project.id,
      ...model,
      latestPlan,
      validation,
      schemaJson: prettyJson(model.draft.schemaJson)
    });
  } catch (error) { next(error); }
});

publicationWebRoutes.get('/projects/:id/publication/plans/:planId', async (req, res, next) => {
  try {
    const projectId = routeParam(req.params.id);
    const planId = routeParam(req.params.planId);
    const model = await publicationWebRepository.getPlan(projectId, planId);
    if (!model) throw new NotFoundError('Publication plan not found', 'PUBLICATION_PLAN_NOT_FOUND');
    const validation = validationModel(model.plan.preview?.validationResult);
    const preview = previewModel(model.plan.preview?.diffPayload);
    render(res, 'publication/preview', {
      title: '发布预览',
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
      title: '发布执行',
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
      title: '发布验证',
      currentProjectId: model.project.id,
      ...model,
      regressionFindings: stringArray(model.verification.regressionFindings)
    });
  } catch (error) { next(error); }
});
