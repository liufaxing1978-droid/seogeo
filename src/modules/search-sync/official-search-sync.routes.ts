import { Router } from 'express';
import { z } from 'zod';
import { requireAuthentication } from '../../auth/authentication.js';
import { requireCsrf } from '../../auth/csrf.js';
import {
  requireProjectCapability,
  requireProjectMembership,
} from '../../auth/project-access.js';
import { NotFoundError } from '../../core/errors.js';
import { officialSearchSyncRepository } from './official-search-sync.repository.js';
import type { OfficialSearchBindingRepositoryPort } from './official-search-sync.types.js';

const marketCodeSchema = z.enum(['CN', 'GLOBAL', 'HK', 'TW', 'SG', 'MY']);
const bindingBodySchema = z.object({
  provider: z.enum(['GOOGLE_SEARCH_CONSOLE', 'BING_WEBMASTER']),
  propertyRef: z.string().trim().min(1).max(2048),
  marketCode: marketCodeSchema,
  locale: z.string().trim().min(1).max(64),
}).strict();
const bindingPatchSchema = z.object({
  isActive: z.boolean(),
}).strict();

function routeParam(value: string | string[]): string {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  return normalized;
}

export function createOfficialSearchSyncRoutes(
  repository: OfficialSearchBindingRepositoryPort = officialSearchSyncRepository,
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
    requireProjectCapability('PROJECT_SETTINGS_WRITE'),
  ];

  router.get(
    '/projects/:projectId/search-provider-bindings',
    ...readGuards,
    async (req, res, next) => {
      try {
        const projectId = routeParam(req.params.projectId);
        res.json({ data: await repository.listBindings(projectId) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/projects/:projectId/search-provider-bindings',
    ...mutationGuards,
    async (req, res, next) => {
      try {
        const projectId = routeParam(req.params.projectId);
        const body = bindingBodySchema.parse(req.body);
        const input = { projectId, ...body };
        const existing = await repository.findBindingByIdentity(input);
        if (existing) {
          return res.json({ data: existing });
        }
        const created = await repository.createBinding(input);
        return res.status(201).json({ data: created });
      } catch (error) {
        next(error);
      }
    },
  );

  router.patch(
    '/projects/:projectId/search-provider-bindings/:bindingId',
    ...mutationGuards,
    async (req, res, next) => {
      try {
        const projectId = routeParam(req.params.projectId);
        const bindingId = routeParam(req.params.bindingId);
        const body = bindingPatchSchema.parse(req.body);
        const updated = await repository.setBindingActive(
          projectId,
          bindingId,
          body.isActive,
        );
        if (!updated) {
          throw new NotFoundError(
            'Search provider binding not found',
            'SEARCH_PROVIDER_BINDING_NOT_FOUND',
          );
        }
        res.json({ data: updated });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
