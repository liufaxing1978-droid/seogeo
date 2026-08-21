import { Router } from 'express';
import { NotFoundError } from '../../core/errors.js';
import { distributionWebRepository } from './distribution.web.repository.js';

function routeParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0]! : value;
}

function render(res: any, bodyTemplate: string, locals: Record<string, unknown>) {
  return res.render('layout', {
    activeNav: 'distribution',
    currentProjectId: null,
    bodyTemplate,
    ...locals,
    title: 'P8-C 多渠道分发'
  });
}

export const distributionWebRoutes = Router();

distributionWebRoutes.get('/projects/:id/distribution', async (req, res, next) => {
  try {
    const projectId = routeParam(req.params.id);
    const model = await distributionWebRepository.getCenter(projectId);
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    render(res, 'distribution/index', {
      currentProjectId: model.project.id,
      ...model,
      primaryPublication: model.publications[0] ?? null
    });
  } catch (error) { next(error); }
});

distributionWebRoutes.get('/projects/:id/distribution/targets/:targetId', async (req, res, next) => {
  try {
    const projectId = routeParam(req.params.id);
    const targetId = routeParam(req.params.targetId);
    const model = await distributionWebRepository.getTarget(projectId, targetId);
    if (!model) throw new NotFoundError('Distribution target not found', 'DISTRIBUTION_TARGET_NOT_FOUND');
    render(res, 'distribution/show', {
      currentProjectId: model.project.id,
      ...model,
      manualHandoff: model.target.capability === 'MANUAL_HANDOFF',
      publishApi: model.target.capability === 'PUBLISH_API'
    });
  } catch (error) { next(error); }
});

distributionWebRoutes.get('/projects/:id/distribution/targets/:targetId/artifacts/:artifactId', async (req, res, next) => {
  try {
    const projectId = routeParam(req.params.id);
    const targetId = routeParam(req.params.targetId);
    const artifactId = routeParam(req.params.artifactId);
    const model = await distributionWebRepository.getArtifact(projectId, targetId, artifactId);
    if (!model) throw new NotFoundError('Distribution artifact not found', 'DISTRIBUTION_ARTIFACT_NOT_FOUND');
    render(res, 'distribution/artifact', {
      currentProjectId: model.project.id,
      ...model
    });
  } catch (error) { next(error); }
});