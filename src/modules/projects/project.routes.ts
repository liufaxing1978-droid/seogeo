import { Router } from 'express';
import { projectRepository } from './project.repository.js';
import { ProjectService } from './project.service.js';

export const projectService = new ProjectService(projectRepository);
export const projectRoutes = Router();

projectRoutes.post('/', async (req, res, next) => {
  try {
    const project = await projectService.create(req.body);
    res.status(201).json({ data: project });
  } catch (error) {
    next(error);
  }
});

projectRoutes.get('/', async (_req, res, next) => {
  try {
    res.json({ data: await projectService.list() });
  } catch (error) {
    next(error);
  }
});

projectRoutes.get('/:id', async (req, res, next) => {
  try {
    res.json({ data: await projectService.get(req.params.id) });
  } catch (error) {
    next(error);
  }
});

projectRoutes.patch('/:id', async (req, res, next) => {
  try {
    res.json({ data: await projectService.update(req.params.id, req.body) });
  } catch (error) {
    next(error);
  }
});
