import type { ProjectRole } from '@prisma/client';
import { Router } from 'express';
import { requireAuthentication } from '../../auth/authentication.js';
import { deriveCsrfToken, requireCsrf } from '../../auth/csrf.js';
import { hasProjectCapability } from '../../auth/project-capabilities.js';
import {
  requireProjectCapability,
  requireProjectMembership,
} from '../../auth/project-access.js';
import { env } from '../../config/env.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { aiTaskService, type AiTaskService } from '../ai/ai.service.js';
import { createKeywordExpansionTask } from './keyword-ai.js';
import {
  keywordCoverageService,
  type KeywordCoverageService,
} from './keyword-coverage.service.js';
import {
  keywordSearchEvidenceService,
  type KeywordSearchEvidenceService,
} from './keyword-search-evidence.service.js';
import { keywordService, type KeywordService } from './keyword.service.js';
import { KeywordWebRepository } from './keyword.web.repository.js';
import {
  keywordBulkCreateSchema,
  keywordCreateSchema,
  keywordGroupCreateSchema,
  keywordGroupMembershipSchema,
  keywordListQuerySchema,
  keywordLockSchema,
  keywordParentSchema,
  keywordStatusCommandSchema,
  keywordSuggestionDecisionSchema,
  keywordUpdateSchema,
} from './keyword.schema.js';

function routeParam(value: string | string[] | undefined): string {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  return normalized;
}

function formBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === '1' || value === 'on';
}

function optionalString(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === 'string' && value) return [value];
  return [];
}

function csrfTokenFor(req: any, res: any): string {
  const tokenHash = res.locals.authSessionTokenHash;
  if (!req.auth || typeof tokenHash !== 'string') {
    throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  }
  return deriveCsrfToken(env.SESSION_SECRET, req.auth.sessionId, tokenHash);
}

export function createKeywordWebRoutes(
  service: KeywordService = keywordService,
  coverageService: KeywordCoverageService = keywordCoverageService,
  aiService: Pick<AiTaskService, 'createAndEnqueue'> = aiTaskService,
  searchEvidenceService: Pick<KeywordSearchEvidenceService, 'evaluateProject'> = keywordSearchEvidenceService,
) {
  const router = Router();
  const readGuards = [
    requireAuthentication(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_READ'),
  ];
  const writeGuards = [
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('CONTENT_WRITE'),
  ];
  const aiRunGuards = [
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('AI_RUN'),
  ];
  const webRepository = new KeywordWebRepository(coverageService, undefined, searchEvidenceService);

  router.get('/projects/:projectId/keywords', ...readGuards, async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const filters = keywordListQuerySchema.parse(req.query);
      const model = await webRepository.load(projectId, filters);
      const membership = res.locals.projectMembership as { role: ProjectRole };

      res.render('layout', {
        title: `关键词中心 · ${model.project.name}`,
        heading: '关键词中心',
        activeNav: 'keywords',
        currentProjectId: projectId,
        currentProjectName: model.project.name,
        bodyTemplate: 'keywords/index',
        csrfToken: csrfTokenFor(req, res),
        canWriteKeywords: hasProjectCapability(membership.role, 'CONTENT_WRITE'),
        canRunKeywordAi: hasProjectCapability(membership.role, 'AI_RUN'),
        keywordCenter: model,
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects/:projectId/keywords', ...writeGuards, async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const body = keywordCreateSchema.parse({
        text: req.body?.text,
        type: req.body?.type,
        intent: optionalString(req.body?.intent),
        priority: req.body?.priority,
        lifecycleStatus: req.body?.lifecycleStatus,
        parentKeywordId: optionalString(req.body?.parentKeywordId),
        groupIds: stringList(req.body?.groupIds),
        language: optionalString(req.body?.language),
        targetCountry: optionalString(req.body?.targetCountry),
        notes: optionalString(req.body?.notes),
        locked: formBoolean(req.body?.locked),
      });
      await service.createManual({
        actorUserId: req.auth!.userId,
        projectId,
        ...body,
      });
      res.redirect(303, `/projects/${projectId}/keywords`);
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects/:projectId/keywords/bulk', ...writeGuards, async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const body = keywordBulkCreateSchema.parse({
        text: req.body?.text,
        type: req.body?.type,
        intent: optionalString(req.body?.intent),
        priority: req.body?.priority,
        lifecycleStatus: req.body?.lifecycleStatus,
        groupIds: stringList(req.body?.groupIds),
        language: optionalString(req.body?.language),
        targetCountry: optionalString(req.body?.targetCountry),
        notes: optionalString(req.body?.notes),
        locked: formBoolean(req.body?.locked),
      });
      await service.createManualBulk({
        actorUserId: req.auth!.userId,
        projectId,
        ...body,
      });
      res.redirect(303, `/projects/${projectId}/keywords`);
    } catch (error) {
      next(error);
    }
  });

  router.post(
    '/projects/:projectId/keywords/:keywordId/suggestions/generate',
    ...aiRunGuards,
    async (req, res, next) => {
      try {
        const projectId = routeParam(req.params.projectId);
        await createKeywordExpansionTask(
          projectId,
          routeParam(req.params.keywordId),
          aiService,
        );
        res.redirect(303, `/projects/${projectId}/keywords`);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:projectId/keyword-suggestions/:suggestionId/accept',
    ...writeGuards,
    async (req, res, next) => {
      try {
        const projectId = routeParam(req.params.projectId);
        const body = keywordSuggestionDecisionSchema.parse({
          editedText: optionalString(req.body?.editedText),
        });
        await service.acceptSuggestion({
          actorUserId: req.auth!.userId,
          projectId,
          suggestionId: routeParam(req.params.suggestionId),
          editedText: body.editedText,
        });
        res.redirect(303, `/projects/${projectId}/keywords`);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:projectId/keyword-suggestions/:suggestionId/reject',
    ...writeGuards,
    async (req, res, next) => {
      try {
        const projectId = routeParam(req.params.projectId);
        await service.rejectSuggestion({
          actorUserId: req.auth!.userId,
          projectId,
          suggestionId: routeParam(req.params.suggestionId),
        });
        res.redirect(303, `/projects/${projectId}/keywords`);
      } catch (error) {
        next(error);
      }
    },
  );

  router.post('/projects/:projectId/keywords/:keywordId/update', ...writeGuards, async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const body = keywordUpdateSchema.parse({
        text: req.body?.text,
        type: req.body?.type,
        intent: optionalString(req.body?.intent),
        priority: req.body?.priority,
        status: req.body?.status,
        lifecycleStatus: req.body?.lifecycleStatus,
        language: optionalString(req.body?.language),
        targetCountry: optionalString(req.body?.targetCountry),
        notes: optionalString(req.body?.notes),
        acknowledgeLock: formBoolean(req.body?.acknowledgeLock),
      });
      await service.updateManual({
        actorUserId: req.auth!.userId,
        projectId,
        keywordId: routeParam(req.params.keywordId),
        ...body,
      });
      res.redirect(303, `/projects/${projectId}/keywords`);
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects/:projectId/keywords/:keywordId/lock', ...writeGuards, async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const body = keywordLockSchema.parse({
        locked: formBoolean(req.body?.locked),
        acknowledgeLock: formBoolean(req.body?.acknowledgeLock),
      });
      await service.setLocked({
        actorUserId: req.auth!.userId,
        projectId,
        keywordId: routeParam(req.params.keywordId),
        ...body,
      });
      res.redirect(303, `/projects/${projectId}/keywords`);
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects/:projectId/keywords/:keywordId/archive', ...writeGuards, async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const body = keywordStatusCommandSchema.parse({
        acknowledgeLock: formBoolean(req.body?.acknowledgeLock),
      });
      await service.archive({
        actorUserId: req.auth!.userId,
        projectId,
        keywordId: routeParam(req.params.keywordId),
        ...body,
      });
      res.redirect(303, `/projects/${projectId}/keywords`);
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects/:projectId/keywords/:keywordId/restore', ...writeGuards, async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const body = keywordStatusCommandSchema.parse({
        acknowledgeLock: formBoolean(req.body?.acknowledgeLock),
      });
      await service.restore({
        actorUserId: req.auth!.userId,
        projectId,
        keywordId: routeParam(req.params.keywordId),
        ...body,
      });
      res.redirect(303, `/projects/${projectId}/keywords`);
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects/:projectId/keywords/:keywordId/parent', ...writeGuards, async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const body = keywordParentSchema.parse({
        parentKeywordId: String(req.body?.parentKeywordId ?? ''),
        acknowledgeLock: formBoolean(req.body?.acknowledgeLock),
      });
      await service.setParent({
        actorUserId: req.auth!.userId,
        projectId,
        childKeywordId: routeParam(req.params.keywordId),
        ...body,
      });
      res.redirect(303, `/projects/${projectId}/keywords`);
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects/:projectId/keywords/:keywordId/parent/remove', ...writeGuards, async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const body = keywordStatusCommandSchema.parse({
        acknowledgeLock: formBoolean(req.body?.acknowledgeLock),
      });
      await service.removeParent({
        actorUserId: req.auth!.userId,
        projectId,
        childKeywordId: routeParam(req.params.keywordId),
        ...body,
      });
      res.redirect(303, `/projects/${projectId}/keywords`);
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects/:projectId/keyword-groups', ...writeGuards, async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const body = keywordGroupCreateSchema.parse({
        name: req.body?.name,
        description: optionalString(req.body?.description),
      });
      await service.createGroup({
        projectId,
        ...body,
      });
      res.redirect(303, `/projects/${projectId}/keywords`);
    } catch (error) {
      next(error);
    }
  });

  router.post('/projects/:projectId/keywords/:keywordId/groups', ...writeGuards, async (req, res, next) => {
    try {
      const projectId = routeParam(req.params.projectId);
      const body = keywordGroupMembershipSchema.parse({
        groupIds: stringList(req.body?.groupIds),
        acknowledgeLock: formBoolean(req.body?.acknowledgeLock),
      });
      await service.setGroups({
        actorUserId: req.auth!.userId,
        projectId,
        keywordId: routeParam(req.params.keywordId),
        ...body,
      });
      res.redirect(303, `/projects/${projectId}/keywords`);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
