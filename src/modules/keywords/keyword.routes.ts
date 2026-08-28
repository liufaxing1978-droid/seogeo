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
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('CONTENT_WRITE'),
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

  return router;
}
