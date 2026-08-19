import { Router } from 'express';
import { hasFeature, type Feature } from '../../auth/feature-flags.js';
import { AppError, NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import {
  VisibilitySubjectError,
  VisibilitySubjectService
} from './visibility-subject.service.js';
import { visibilityIntelligenceWebRepository } from './visibility-intelligence.web.repository.js';

async function requireProject(projectId: string, feature: Feature) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, planLevel: true }
  });
  if (!project) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
  if (!hasFeature(project.planLevel, feature)) {
    throw new AppError('This feature requires a higher plan', 403, 'FEATURE_NOT_AVAILABLE');
  }
  return project;
}

function mapSubjectError(error: unknown): never {
  if (!(error instanceof VisibilitySubjectError)) throw error;
  if (
    error.code === 'VISIBILITY_PROJECT_NOT_FOUND' ||
    error.code === 'VISIBILITY_ENTITY_NOT_FOUND' ||
    error.code === 'VISIBILITY_COMPETITOR_NOT_FOUND' ||
    error.code === 'VISIBILITY_SUBJECT_NOT_FOUND'
  ) {
    throw new NotFoundError(error.message, error.code);
  }
  if (error.code === 'AMBIGUOUS_ALIAS') throw new AppError(error.message, 409, error.code);
  throw new AppError(error.message, 400, error.code);
}

export function createVisibilityIntelligenceWebRoutes(
  subjectService = new VisibilitySubjectService()
) {
  const router = Router();

  router.get('/projects/:id/visibility/citations', async (req, res, next) => {
    try {
      await requireProject(req.params.id, 'CITATION_MONITOR');
      const data = await visibilityIntelligenceWebRepository.getCitationMonitor(req.params.id);
      if (!data) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
      res.render('layout', {
        title: `Citation 监控 · ${data.project.name}`,
        activeNav: 'visibility-citations',
        currentProjectId: data.project.id,
        breadcrumbs: ['项目', data.project.name, 'AI Visibility', 'Citation 监控'],
        bodyTemplate: 'visibility/citations',
        ...data
      });
    } catch (error) { next(error); }
  });

  router.get('/projects/:id/visibility/subjects', async (req, res, next) => {
    try {
      await requireProject(req.params.id, 'AI_VISIBILITY');
      await subjectService.bootstrapOwnedDomain(req.params.id);
      const data = await visibilityIntelligenceWebRepository.getSubjects(req.params.id);
      if (!data) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
      res.render('layout', {
        title: `监控主体 · ${data.project.name}`,
        activeNav: 'visibility-subjects',
        currentProjectId: data.project.id,
        breadcrumbs: ['项目', data.project.name, 'AI Visibility', '监控主体'],
        bodyTemplate: 'visibility/subjects',
        ...data
      });
    } catch (error) {
      try { mapSubjectError(error); } catch (mapped) { next(mapped); }
    }
  });

  router.post('/projects/:id/visibility/subjects', async (req, res, next) => {
    try {
      await requireProject(req.params.id, 'AI_VISIBILITY');
      const subjectType = req.body.subjectType === 'OWNED_DOMAIN' ? 'OWNED_DOMAIN' : 'OWNED_BRAND';
      const canonicalValue = typeof req.body.canonicalValue === 'string' ? req.body.canonicalValue : '';
      await subjectService.createSubject(req.params.id, { subjectType, canonicalValue });
      res.redirect(303, `/projects/${req.params.id}/visibility/subjects`);
    } catch (error) {
      try { mapSubjectError(error); } catch (mapped) { next(mapped); }
    }
  });

  router.post('/projects/:id/visibility/subjects/:subjectId/aliases', async (req, res, next) => {
    try {
      await requireProject(req.params.id, 'AI_VISIBILITY');
      const alias = typeof req.body.alias === 'string' ? req.body.alias : '';
      const aliasType = req.body.aliasType === 'DOMAIN'
        ? 'DOMAIN'
        : req.body.aliasType === 'ENTITY_ALIAS'
          ? 'ENTITY_ALIAS'
          : 'NAME';
      await subjectService.addAlias(req.params.id, req.params.subjectId, { alias, aliasType });
      res.redirect(303, `/projects/${req.params.id}/visibility/subjects`);
    } catch (error) {
      try { mapSubjectError(error); } catch (mapped) { next(mapped); }
    }
  });

  router.get('/projects/:id/visibility/extractions/:extractionId', async (req, res, next) => {
    try {
      await requireProject(req.params.id, 'CITATION_MONITOR');
      const data = await visibilityIntelligenceWebRepository.getExtractionDetail(
        req.params.id,
        req.params.extractionId
      );
      if (!data) {
        throw new NotFoundError('Visibility extraction not found', 'VISIBILITY_EXTRACTION_NOT_FOUND');
      }
      res.render('layout', {
        title: `Extraction 详情 · ${data.project.name}`,
        activeNav: 'visibility-citations',
        currentProjectId: data.project.id,
        breadcrumbs: ['项目', data.project.name, 'AI Visibility', 'Citation 监控', 'Extraction 详情'],
        bodyTemplate: 'visibility/extractions/show',
        ...data
      });
    } catch (error) { next(error); }
  });

  return router;
}

export const visibilityIntelligenceWebRoutes = createVisibilityIntelligenceWebRoutes();
