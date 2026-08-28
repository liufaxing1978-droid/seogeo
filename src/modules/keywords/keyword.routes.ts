import { Router } from 'express';
import { requireAuthentication } from '../../auth/authentication.js';
import { requireCsrf } from '../../auth/csrf.js';
import {
  requireProjectCapability,
  requireProjectMembership,
} from '../../auth/project-access.js';
import { NotFoundError } from '../../core/errors.js';
import { keywordService, type KeywordService } from './keyword.service.js';

function routeParam(value: string | string[]): string {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  return normalized;
}

export function createKeywordRoutes(service: KeywordService = keywordService) {
  const router = Router();
  const keywordMutationGuards = [
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('CONTENT_WRITE'),
  ];

  router.get(
    '/projects/:projectId/keywords',
    requireAuthentication(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_READ'),
    async (req, res, next) => {
      try {
        res.json({ data: await service.list(routeParam(req.params.projectId)) });
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
        const data = await service.createManual({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          text: req.body?.text,
          type: req.body?.type,
          intent: req.body?.intent ?? null,
          priority: req.body?.priority,
          parentKeywordId: req.body?.parentKeywordId ?? null,
          groupIds: req.body?.groupIds,
          language: req.body?.language ?? null,
          targetCountry: req.body?.targetCountry ?? null,
          notes: req.body?.notes ?? null,
          locked: req.body?.locked,
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
        const data = await service.updateManual({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          keywordId: routeParam(req.params.keywordId),
          acknowledgeLock: req.body?.acknowledgeLock ?? false,
          text: req.body?.text,
          type: req.body?.type,
          intent: req.body?.intent,
          priority: req.body?.priority,
          status: req.body?.status,
          language: req.body?.language,
          targetCountry: req.body?.targetCountry,
          notes: req.body?.notes,
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
        const data = await service.setLocked({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          keywordId: routeParam(req.params.keywordId),
          locked: req.body?.locked,
          acknowledgeLock: req.body?.acknowledgeLock ?? false,
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
        const data = await service.archive({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          keywordId: routeParam(req.params.keywordId),
          acknowledgeLock: req.body?.acknowledgeLock ?? false,
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
        const data = await service.restore({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          keywordId: routeParam(req.params.keywordId),
          acknowledgeLock: req.body?.acknowledgeLock ?? false,
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
        const data = await service.setParent({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          keywordId: routeParam(req.params.keywordId),
          parentKeywordId: req.body?.parentKeywordId,
          acknowledgeLock: req.body?.acknowledgeLock ?? false,
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
        const data = await service.removeParent({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          keywordId: routeParam(req.params.keywordId),
          acknowledgeLock: req.body?.acknowledgeLock ?? false,
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
        const data = await service.createGroup({
          projectId: routeParam(req.params.projectId),
          name: req.body?.name,
          description: req.body?.description ?? null,
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
        const data = await service.setGroups({
          actorUserId: req.auth!.userId,
          projectId: routeParam(req.params.projectId),
          keywordId: routeParam(req.params.keywordId),
          groupIds: req.body?.groupIds,
          acknowledgeLock: req.body?.acknowledgeLock ?? false,
        });
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
