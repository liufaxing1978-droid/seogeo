import { Router } from 'express';
import type { Feature } from '../../auth/feature-flags.js';
import { hasFeature } from '../../auth/feature-flags.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import type { GrowthRestRepository } from './growth.routes.js';
import { createGrowthWebRepository } from './growth.web.repository.js';

async function requireGrowthProject(projectId: string, feature: Feature) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, primaryDomain: true, planLevel: true }
  });
  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  if (!hasFeature(project.planLevel, feature)) {
    throw new AppError('This feature requires a higher plan', 403, 'FEATURE_NOT_AVAILABLE');
  }
  return project;
}

export function createGrowthWebRoutes(
  injectedRepository: Partial<GrowthRestRepository> = {}
) {
  const router = Router();
  const repository = createGrowthWebRepository(injectedRepository);

  router.get('/projects/:id/growth', async (req, res, next) => {
    try {
      const project = await requireGrowthProject(req.params.id, 'GROWTH_OPPORTUNITIES');
      const opportunities = await repository.listOpportunities(
        project.id,
        project.planLevel === 'STANDARD'
      );
      res.render('layout', {
        title: `Growth Opportunity Center · ${project.name}`,
        activeNav: 'growth',
        currentProjectId: project.id,
        breadcrumbs: ['项目', project.name, 'Growth Opportunity Center'],
        bodyTemplate: 'growth/index',
        project,
        opportunities,
        basicSurface: project.planLevel === 'STANDARD'
      });
    } catch (error) { next(error); }
  });

  router.get('/projects/:id/growth/opportunities/:opportunityId', async (req, res, next) => {
    try {
      const project = await requireGrowthProject(req.params.id, 'GROWTH_OPPORTUNITIES');
      const detail = await repository.getOpportunity(
        project.id,
        req.params.opportunityId,
        project.planLevel === 'STANDARD'
      );
      if (!detail) {
        throw new NotFoundError('Growth opportunity not found', 'GROWTH_OPPORTUNITY_NOT_FOUND');
      }
      res.render('layout', {
        title: `Growth Opportunity · ${project.name}`,
        activeNav: 'growth',
        currentProjectId: project.id,
        breadcrumbs: ['项目', project.name, 'Growth Opportunity Center', '详情'],
        bodyTemplate: 'growth/show',
        project,
        detail,
        basicSurface: project.planLevel === 'STANDARD'
      });
    } catch (error) { next(error); }
  });

  router.get('/projects/:id/growth/topics', async (req, res, next) => {
    try {
      const project = await requireGrowthProject(req.params.id, 'GROWTH_TOPIC_CLUSTERS');
      const topics = await repository.listTopics(project.id);
      res.render('layout', {
        title: `Topic Clusters · ${project.name}`,
        activeNav: 'growth-topics',
        currentProjectId: project.id,
        breadcrumbs: ['项目', project.name, 'Growth', 'Topic Clusters'],
        bodyTemplate: 'growth/topics',
        project,
        topics
      });
    } catch (error) { next(error); }
  });

  router.get('/projects/:id/growth/cannibalization', async (req, res, next) => {
    try {
      const project = await requireGrowthProject(req.params.id, 'GROWTH_CANNIBALIZATION');
      const opportunities = await repository.listCannibalization(project.id);
      res.render('layout', {
        title: `Keyword Cannibalization · ${project.name}`,
        activeNav: 'growth-cannibalization',
        currentProjectId: project.id,
        breadcrumbs: ['项目', project.name, 'Growth', 'Cannibalization'],
        bodyTemplate: 'growth/cannibalization',
        project,
        opportunities
      });
    } catch (error) { next(error); }
  });

  router.get('/projects/:id/growth/new-content', async (req, res, next) => {
    try {
      const project = await requireGrowthProject(req.params.id, 'GROWTH_NEW_CONTENT');
      const opportunities = await repository.listNewContent(project.id);
      res.render('layout', {
        title: `New Content Opportunities · ${project.name}`,
        activeNav: 'growth-new-content',
        currentProjectId: project.id,
        breadcrumbs: ['项目', project.name, 'Growth', 'New Content'],
        bodyTemplate: 'growth/new-content',
        project,
        opportunities
      });
    } catch (error) { next(error); }
  });

  return router;
}

export const growthWebRoutes = createGrowthWebRoutes();