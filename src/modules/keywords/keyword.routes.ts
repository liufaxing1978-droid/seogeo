import { Router } from 'express';
import { requireAuthentication } from '../../auth/authentication.js';
import { requireCsrf } from '../../auth/csrf.js';
import {
  requireProjectCapability,
  requireProjectMembership,
} from '../../auth/project-access.js';
import { NotFoundError } from '../../core/errors.js';
import { aiTaskService, type AiTaskService } from '../ai/ai.service.js';
import { createKeywordExpansionTask } from './keyword-ai.js';
import {
  keywordCoverageService,
  type KeywordCoverageService,
} from './keyword-coverage.service.js';
import {
  keywordSearchEvidenceService,
  parseSearchEvidenceMarketFilter,
  parseSearchEvidenceOptionalTextFilter,
  parseSearchEvidenceProviderFilter,
  type KeywordSearchEvidenceService,
} from './keyword-search-evidence.service.js';
import { keywordService, type KeywordService } from './keyword.service.js';
import { KeywordTargetService } from './keyword-target.service.js';
import { KeywordCannibalizationService } from './keyword-cannibalization.service.js';
import {
  keywordOpportunityService,
  type KeywordOpportunityService,
} from './keyword-opportunity.service.js';
import {
  keywordBulkCreateSchema,
  keywordCreateSchema,
  emptyKeywordMutationSchema,
  keywordGroupCreateSchema,
  keywordGroupBulkAssignmentSchema,
  keywordGroupMembershipSchema,
  keywordGroupPrimarySchema,
  keywordGroupRenameSchema,
  keywordListQuerySchema,
  keywordLockSchema,
  keywordOpportunityCalculationSchema,
  keywordParentSchema,
  keywordStatusCommandSchema,
  keywordSuggestionDecisionSchema,
  keywordUpdateSchema,
  keywordTargetUrlSchema,
  keywordCannibalizationCalculationSchema,
} from './keyword.schema.js';

function routeParam(value: string | string[]): string {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  return normalized;
}

export function createKeywordRoutes(
  service: KeywordService = keywordService,
  coverageService: KeywordCoverageService = keywordCoverageService,
  aiService: Pick<AiTaskService, 'createAndEnqueue'> = aiTaskService,
  searchEvidenceService: Pick<KeywordSearchEvidenceService, 'evaluateKeyword'> = keywordSearchEvidenceService,
  opportunityService: Pick<KeywordOpportunityService, 'calculate' | 'findLatest'> = keywordOpportunityService,
  targetService = new KeywordTargetService(),
  cannibalizationService = new KeywordCannibalizationService(),
) {
  const router = Router();
  const keywordMutationGuards = [
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('CONTENT_WRITE'),
  ];
  const keywordAiGuards = [
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('AI_RUN'),
  ];

  router.get(
    '/projects/:projectId/keywords/:keywordId/cannibalization',
    requireAuthentication(), requireProjectMembership(), requireProjectCapability('PROJECT_READ'),
    async (req, res, next) => { try { res.json({ data: await cannibalizationService.findLatestKeyword(routeParam(req.params.projectId), routeParam(req.params.keywordId)) }); } catch (error) { next(error); } },
  );

  router.post(
    '/projects/:projectId/keywords/:keywordId/cannibalization',
    ...keywordMutationGuards,
    async (req, res, next) => { try { keywordCannibalizationCalculationSchema.parse(req.body ?? {}); const data = await cannibalizationService.calculateKeyword(routeParam(req.params.projectId), routeParam(req.params.keywordId), req.auth!.userId); res.status(201).json({ data }); } catch (error) { next(error); } },
  );

  router.put(
    '/projects/:projectId/keywords/:keywordId/target-url',
    ...keywordMutationGuards,
    async (req, res, next) => { try { const input = keywordTargetUrlSchema.parse(req.body ?? {}); const data = await targetService.setKeywordTargetUrl({ ...input, actorUserId: req.auth!.userId, projectId: routeParam(req.params.projectId), keywordId: routeParam(req.params.keywordId) }); res.json({ data }); } catch (error) { next(error); } },
  );

  router.get(
    '/projects/:projectId/keywords',
    requireAuthentication(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_READ'),
    async (req, res, next) => {
      try {
        const filters = keywordListQuerySchema.parse(req.query);
        res.json({ data: await service.list(routeParam(req.params.projectId), filters) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/projects/:projectId/keywords/:keywordId/opportunity-score',
    requireAuthentication(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_READ'),
    async (req, res, next) => {
      try {
        const data = await opportunityService.findLatest(
          routeParam(req.params.projectId),
          routeParam(req.params.keywordId),
        );
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:projectId/keywords/:keywordId/opportunity-score',
    ...keywordMutationGuards,
    async (req, res, next) => {
      try {
        keywordOpportunityCalculationSchema.parse(req.body ?? {});
        const data = await opportunityService.calculate(
          routeParam(req.params.projectId),
          routeParam(req.params.keywordId),
          req.auth!.userId,
        );
        res.status(201).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/projects/:projectId/keywords/:keywordId/coverage',
    requireAuthentication(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_READ'),
    async (req, res, next) => {
      try {
        const data = await coverageService.evaluateKeyword(
          routeParam(req.params.projectId),
          routeParam(req.params.keywordId),
        );
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/projects/:projectId/keywords/:keywordId/search-evidence',
    requireAuthentication(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_READ'),
    async (req, res, next) => {
      try {
        const data = await searchEvidenceService.evaluateKeyword(
          routeParam(req.params.projectId),
          routeParam(req.params.keywordId),
          {
            ...(req.query.from !== undefined
              ? { from: parseSearchEvidenceOptionalTextFilter(req.query.from) }
              : {}),
            ...(req.query.to !== undefined
              ? { to: parseSearchEvidenceOptionalTextFilter(req.query.to) }
              : {}),
            ...(req.query.provider !== undefined
              ? { provider: parseSearchEvidenceProviderFilter(req.query.provider) }
              : {}),
            ...(req.query.marketCode !== undefined
              ? { marketCode: parseSearchEvidenceMarketFilter(req.query.marketCode) }
              : {}),
            ...(req.query.locale !== undefined
              ? { locale: parseSearchEvidenceOptionalTextFilter(req.query.locale) }
              : {}),
            ...(req.query.propertyRef !== undefined
              ? { propertyRef: parseSearchEvidenceOptionalTextFilter(req.query.propertyRef) }
              : {}),
          },
        );
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:projectId/keywords/:keywordId/suggestions/generate',
    ...keywordAiGuards,
    async (req, res, next) => {
      try {
        emptyKeywordMutationSchema.parse(req.body ?? {});
        const task = await createKeywordExpansionTask(
          routeParam(req.params.projectId),
          routeParam(req.params.keywordId),
          aiService,
        );
        res.status(202).json({ data: { aiTaskId: task.id } });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:projectId/keyword-suggestions/:suggestionId/accept',
    ...keywordMutationGuards,
    async (req, res, next) => {
      try {
        const body = keywordSuggestionDecisionSchema.parse(req.body ?? {});
        const data = await service.acceptSuggestion({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          suggestionId: routeParam(req.params.suggestionId),
          editedText: body.editedText,
        });
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:projectId/keyword-suggestions/:suggestionId/reject',
    ...keywordMutationGuards,
    async (req, res, next) => {
      try {
        emptyKeywordMutationSchema.parse(req.body ?? {});
        const data = await service.rejectSuggestion({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          suggestionId: routeParam(req.params.suggestionId),
        });
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:projectId/keywords',
    ...keywordMutationGuards,
    async (req, res, next) => {
      try {
        const body = keywordCreateSchema.parse(req.body);
        const data = await service.createManual({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          ...body,
        });
        res.status(201).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:projectId/keywords/bulk',
    ...keywordMutationGuards,
    async (req, res, next) => {
      try {
        const body = keywordBulkCreateSchema.parse(req.body);
        const data = await service.createManualBulk({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          ...body,
        });
        res.status(201).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    '/projects/:projectId/keywords/:keywordId',
    ...keywordMutationGuards,
    async (req, res, next) => {
      try {
        const body = keywordUpdateSchema.parse(req.body);
        const data = await service.updateManual({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          keywordId: routeParam(req.params.keywordId),
          ...body,
        });
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    '/projects/:projectId/keyword-groups/:groupId',
    ...keywordMutationGuards,
    async (req, res, next) => {
      try {
        const body = keywordGroupRenameSchema.parse(req.body);
        const data = await service.renameGroup({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          groupId: routeParam(req.params.groupId),
          ...body,
        });
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/projects/:projectId/keyword-groups/:groupId/primary-keyword',
    ...keywordMutationGuards,
    async (req, res, next) => {
      try {
        const body = keywordGroupPrimarySchema.parse(req.body);
        const data = await service.setGroupPrimaryKeyword({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          groupId: routeParam(req.params.groupId),
          ...body,
        });
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/projects/:projectId/keyword-groups/:groupId/keywords',
    ...keywordMutationGuards,
    async (req, res, next) => {
      try {
        const body = keywordGroupBulkAssignmentSchema.parse(req.body);
        const data = await service.assignKeywordsToGroup({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          groupId: routeParam(req.params.groupId),
          ...body,
        });
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/projects/:projectId/keywords/:keywordId/lock',
    ...keywordMutationGuards,
    async (req, res, next) => {
      try {
        const body = keywordLockSchema.parse(req.body);
        const data = await service.setLocked({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          keywordId: routeParam(req.params.keywordId),
          ...body,
        });
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:projectId/keywords/:keywordId/archive',
    ...keywordMutationGuards,
    async (req, res, next) => {
      try {
        const body = keywordStatusCommandSchema.parse(req.body ?? {});
        const data = await service.archive({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          keywordId: routeParam(req.params.keywordId),
          ...body,
        });
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:projectId/keywords/:keywordId/restore',
    ...keywordMutationGuards,
    async (req, res, next) => {
      try {
        const body = keywordStatusCommandSchema.parse(req.body ?? {});
        const data = await service.restore({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          keywordId: routeParam(req.params.keywordId),
          ...body,
        });
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/projects/:projectId/keywords/:keywordId/parent',
    ...keywordMutationGuards,
    async (req, res, next) => {
      try {
        const body = keywordParentSchema.parse(req.body);
        const data = await service.setParent({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          childKeywordId: routeParam(req.params.keywordId),
          ...body,
        });
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.delete(
    '/projects/:projectId/keywords/:keywordId/parent',
    ...keywordMutationGuards,
    async (req, res, next) => {
      try {
        const body = keywordStatusCommandSchema.parse(req.body ?? {});
        const data = await service.removeParent({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          childKeywordId: routeParam(req.params.keywordId),
          ...body,
        });
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:projectId/keyword-groups',
    ...keywordMutationGuards,
    async (req, res, next) => {
      try {
        const body = keywordGroupCreateSchema.parse(req.body);
        const data = await service.createGroup({
          projectId: routeParam(req.params.projectId),
          ...body,
        });
        res.status(201).json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.put(
    '/projects/:projectId/keywords/:keywordId/groups',
    ...keywordMutationGuards,
    async (req, res, next) => {
      try {
        const body = keywordGroupMembershipSchema.parse(req.body);
        const data = await service.setGroups({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          keywordId: routeParam(req.params.keywordId),
          ...body,
        });
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
