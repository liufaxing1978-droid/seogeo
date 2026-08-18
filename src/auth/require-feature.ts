import type { RequestHandler } from 'express';
import { projectService } from '../modules/projects/project.routes.js';
import { hasFeature, type Feature } from './feature-flags.js';

export function requireFeature(feature: Feature): RequestHandler {
  return async (req, res, next) => {
    try {
      const project = await projectService.get(req.params.id);
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
