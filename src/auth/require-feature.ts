import type { RequestHandler } from 'express';
import { NotFoundError } from '../core/errors.js';
import { projectRepository } from '../modules/projects/project.repository.js';
import { ProjectService } from '../modules/projects/project.service.js';
import { hasFeature, type Feature } from './feature-flags.js';

const projectService = new ProjectService(projectRepository);

function projectIdFromParams(params: Record<string, string | string[] | undefined>): string {
  const rawId = params.projectId ?? params.id;
  const projectId = Array.isArray(rawId) ? rawId[0] : rawId;
  if (!projectId) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  return projectId;
}

export function requireFeature(feature: Feature): RequestHandler {
  return async (req, res, next) => {
    try {
      const projectId = projectIdFromParams(req.params);
      const project = res.locals.project ?? await projectService.get(projectId);
      if (!hasFeature(project.planLevel, feature)) {
        return res.status(403).json({
          error: {
            code: 'FEATURE_NOT_AVAILABLE',
            message: 'This feature requires a higher plan'
          }
        });
      }
      res.locals.project = project;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}
