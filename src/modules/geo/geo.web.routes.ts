import { Router } from 'express';
import { NotFoundError } from '../../core/errors.js';
import { ProjectService } from '../projects/project.service.js';
import { projectRepository } from '../projects/project.repository.js';
import { geoService } from './geo.service.js';
import { geoWebRepository } from './geo.web.repository.js';

const projectService = new ProjectService(projectRepository);
export const geoWebRoutes = Router();

function render(res: any, bodyTemplate: string, locals: Record<string, unknown>) {
  return res.render('layout', {
    title: 'SEO GEO',
    activeNav: 'geo',
    currentProjectId: null,
    bodyTemplate,
    ...locals
  });
}

geoWebRoutes.get('/projects/:id/geo', async (req, res, next) => {
  try {
    const project = await projectService.get(req.params.id);
    const model = await geoWebRepository.getOverview(project.id);

    render(res, 'geo/overview', {
      title: 'GEO Readiness',
      activeNav: 'geo',
      currentProjectId: project.id,
      project,
      ...model
    });
  } catch (error) {
    next(error);
  }
});

geoWebRoutes.post('/projects/:id/geo/run', async (req, res, next) => {
  try {
    await projectService.get(req.params.id);
    await geoService.createProjectAudit(req.params.id, {});
    res.redirect(303, `/projects/${req.params.id}/geo`);
  } catch (error) {
    if (error instanceof NotFoundError) return next(error);
    next(error);
  }
});
