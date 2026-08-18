import type { RequestHandler } from 'express';
import { projectRepository } from '../modules/projects/project.repository.js';
import { ProjectService } from '../modules/projects/project.service.js';
import { hasFeature, type Feature } from './feature-flags.js';

const projectService = new ProjectService(projectRepository);

export function requireFeature(feature: Feature): RequestHandler {
  return async (req, res, next) => {
    try {
      const rawId = req.params.id;
      const projectId = Array.isArray(rawId) ? rawId[0] : rawId;
      const project = await projectService.get(projectId);
      if (!hasFeature(project.planLevel, feature)) {
        return res.status(403).json({
          error: {
            code: 'FEATURE_NOT_AVAILABLE',
            message: 'This feature requires a higher plan'
          }
        });
      }
      res.locals.project = project;
      next();
    } catch (error) {
      next(error);
    }
  };
}
