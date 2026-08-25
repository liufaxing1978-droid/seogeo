import { Router } from 'express';
import { z } from 'zod';
import { hasFeature } from '../../auth/feature-flags.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import {
  OptimizationExperimentWebRepository,
  optimizationExperimentWebRepository
} from './experiment.web.repository.js';

const idSchema = z.string().uuid();

async function requireExperimentProject(rawProjectId: string) {
  const projectId = idSchema.parse(rawProjectId);
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, primaryDomain: true, planLevel: true }
  });
  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  if (!hasFeature(project.planLevel, 'OPTIMIZATION_EXPERIMENTS')) {
    throw new AppError('This feature requires a higher plan', 403, 'FEATURE_NOT_AVAILABLE');
  }
  return project;
}

export function createOptimizationExperimentWebRoutes(
  repository: OptimizationExperimentWebRepository = optimizationExperimentWebRepository
) {
  const router = Router();

  router.get('/projects/:id/optimization/experiments', async (req, res, next) => {
    try {
      const project = await requireExperimentProject(req.params.id);
      const experiments = await repository.listExperiments(project.id);
      res.render('layout', {
        title: `优化实验 · ${project.name}`,
        activeNav: 'optimization-experiments',
        currentProjectId: project.id,
        breadcrumbs: ['项目', project.name, '增长', '优化实验'],
        bodyTemplate: 'optimization-experiments/index',
        project,
        experiments
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:id/optimization/experiments/:experimentId', async (req, res, next) => {
    try {
      const project = await requireExperimentProject(req.params.id);
      const experimentId = idSchema.parse(req.params.experimentId);
      const experiment = await repository.getExperiment(project.id, experimentId);
      if (!experiment) {
        throw new NotFoundError('Optimization experiment not found', 'EXPERIMENT_NOT_FOUND');
      }
      res.render('layout', {
        title: `优化实验详情 · ${project.name}`,
        activeNav: 'optimization-experiments',
        currentProjectId: project.id,
        breadcrumbs: ['项目', project.name, '增长', '优化实验', '详情'],
        bodyTemplate: 'optimization-experiments/show',
        project,
        experiment
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const optimizationExperimentWebRoutes = createOptimizationExperimentWebRoutes();
