import { Router } from 'express';
import { z } from 'zod';
import { requireAuthentication } from '../../auth/authentication.js';
import { requireCsrf } from '../../auth/csrf.js';
import {
  requireProjectCapability,
  requireProjectMembership,
} from '../../auth/project-access.js';
import { NotFoundError } from '../../core/errors.js';
import { officialSearchSyncObservability } from '../search-sync/official-search-sync.observability.js';
import { KeywordDiscoveryRepository } from './keyword-discovery.repository.js';
import { KeywordDiscoveryService } from './keyword-discovery.service.js';

const windowSchema = z.object({
  dateFrom: z.string().trim().min(1).optional(),
  dateTo: z.string().trim().min(1).optional(),
}).strict();

const acceptSchema = z.object({
  type: z.enum(['CORE', 'LONG_TAIL', 'BRAND', 'QUESTION', 'LOCAL', 'COMMERCIAL']),
  intent: z.enum([
    'INFORMATIONAL',
    'NAVIGATIONAL',
    'COMMERCIAL_INVESTIGATION',
    'TRANSACTIONAL',
    'LOCAL',
    'UNKNOWN',
  ]).nullable().optional(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).optional(),
  language: z.string().trim().min(1).max(64).nullable().optional(),
  targetCountry: z.string().trim().min(1).max(64).nullable().optional(),
}).strict();

export type KeywordDiscoveryApiService = Pick<
  KeywordDiscoveryService,
  'list' | 'refresh' | 'accept' | 'reject'
>;

function routeParam(value: string | string[] | undefined): string {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  return normalized;
}

function defaultKeywordDiscoveryService(): KeywordDiscoveryService {
  return new KeywordDiscoveryService({
    repository: new KeywordDiscoveryRepository(),
  });
}

export function createKeywordDiscoveryRoutes(
  service: KeywordDiscoveryApiService = defaultKeywordDiscoveryService(),
) {
  const router = Router();
  const readGuards = [
    requireAuthentication(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_READ'),
  ];
  const mutationGuards = [
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('CONTENT_WRITE'),
  ];

  router.get(
    '/projects/:projectId/keyword-discoveries',
    ...readGuards,
    async (req, res, next) => {
      try {
        const projectId = routeParam(req.params.projectId);
        const query = windowSchema.parse(req.query);
        const data = await service.list({ projectId, ...query });
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:projectId/keyword-discoveries/refresh',
    ...mutationGuards,
    async (req, res, next) => {
      try {
        const projectId = routeParam(req.params.projectId);
        const body = windowSchema.parse(req.body);
        const data = await service.refresh({ projectId, ...body });
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:projectId/keyword-discoveries/:candidateId/accept',
    ...mutationGuards,
    async (req, res, next) => {
      try {
        const projectId = routeParam(req.params.projectId);
        const candidateId = routeParam(req.params.candidateId);
        const body = acceptSchema.parse(req.body);
        const data = await service.accept({
          actorUserId: req.auth!.userId,
          projectId,
          candidateId,
          ...body,
        });
        officialSearchSyncObservability.emit({
          event: 'keyword_discovery.accepted',
          projectId,
          candidateId,
        });
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:projectId/keyword-discoveries/:candidateId/reject',
    ...mutationGuards,
    async (req, res, next) => {
      try {
        const projectId = routeParam(req.params.projectId);
        const candidateId = routeParam(req.params.candidateId);
        const data = await service.reject({
          actorUserId: req.auth!.userId,
          projectId,
          candidateId,
        });
        officialSearchSyncObservability.emit({
          event: 'keyword_discovery.rejected',
          projectId,
          candidateId,
        });
        res.json({ data });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
