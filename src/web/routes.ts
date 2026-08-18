import { Router } from 'express';
import { ProjectService } from '../modules/projects/project.service.js';
import { projectRepository } from '../modules/projects/project.repository.js';
import { dashboardMetrics, projectTabs } from './view-models.js';

const projectService = new ProjectService(projectRepository);
export const webRoutes = Router();

function render(res: any, bodyTemplate: string, locals: Record<string, unknown>) {
  return res.render('layout', {
    title: 'SEO GEO',
    activeNav: 'overview',
    bodyTemplate,
    ...locals
  });
}

webRoutes.get('/', async (_req, res, next) => {
  try {
    render(res, 'dashboard', { metrics: dashboardMetrics });
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/projects', async (_req, res, next) => {
  try {
    const projects = await projectService.list();
    render(res, 'projects/index', { title: '项目列表', activeNav: 'projects', projects });
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/projects/new', (_req, res) => {
  render(res, 'projects/new', {
    title: '新建项目',
    activeNav: 'projects',
    values: {},
    errors: {}
  });
});

webRoutes.post('/projects', async (req, res) => {
  try {
    const project = await projectService.create(req.body);
    res.redirect(303, `/projects/${project.id}`);
  } catch (error: any) {
    const errors = error?.details?.fieldErrors ?? {};
    res.status(400);
    render(res, 'projects/new', {
      title: '新建项目',
      activeNav: 'projects',
      values: req.body,
      errors
    });
  }
});

webRoutes.get('/projects/:id', async (req, res, next) => {
  try {
    const project = await projectService.get(req.params.id);
    render(res, 'projects/show', {
      title: project.name,
      activeNav: 'projects',
      project,
      tabs: projectTabs
    });
  } catch (error) {
    next(error);
  }
});
