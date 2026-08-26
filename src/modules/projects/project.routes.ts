import { Router } from 'express';
import { requireAuthentication } from '../../auth/authentication.js';
import { requireCsrf } from '../../auth/csrf.js';
import {
  requireProjectCapability,
  requireProjectMembership,
} from '../../auth/project-access.js';
import { requireFeature } from '../../auth/require-feature.js';
import { NotFoundError } from '../../core/errors.js';
import { projectRepository } from './project.repository.js';
import { ProjectService } from './project.service.js';

export const projectService = new ProjectService(projectRepository);
export const projectRoutes = Router();

function routeParam(value: string | string[]): string {
  const normalized = Array.isArray(value) ? value[0] : value;
  if (!normalized) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  return normalized;
}

projectRoutes.post(
  '/',
  requireAuthentication(),
  requireCsrf(),
  async (req, res, next) => {
    try {
      const project = await projectService.createForOwner(req.auth!.userId, req.body);
      res.status(201).json({ data: project });
    } catch (error) {
      next(error);
    }
  },
);

projectRoutes.get(
  '/',
  requireAuthentication(),
  async (req, res, next) => {
    try {
      res.json({ data: await projectService.listForUser(req.auth!.userId) });
    } catch (error) {
      next(error);
    }
  },
);

projectRoutes.get(
  '/:id/features/ai-visibility',
  requireAuthentication(),
  requireProjectMembership(),
  requireProjectCapability('PROJECT_READ'),
  requireFeature('AI_VISIBILITY'),
  (_req, res) => {
    res.json({ enabled: true });
  },
);

projectRoutes.get(
  '/:id',
  requireAuthentication(),
  requireProjectMembership(),
  requireProjectCapability('PROJECT_READ'),
  (_req, res) => {
    res.json({ data: res.locals.project });
  },
);

projectRoutes.patch(
  '/:id',
  requireAuthentication(),
  requireCsrf(),
  requireProjectMembership(),
  requireProjectCapability('PROJECT_SETTINGS_WRITE'),
  async (req, res, next) => {
    try {
      res.json({
        data: await projectService.update(routeParam(req.params.id), req.body),
      });
    } catch (error) {
      next(error);
    }
  },
);
