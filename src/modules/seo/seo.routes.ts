import { Router } from 'express';
import { SeoService, seoService } from './seo.service.js';

export function createSeoRoutes(service: SeoService = seoService) {
  const router = Router();

  router.post('/projects/:projectId/seo-audits', async (req, res, next) => {
    try {
      const result = await service.createProjectAudit(req.params.projectId, req.body);
      res.status(result.existing ? 200 : 202).json({
        id: result.audit.id,
        status: result.audit.status,
        existing: result.existing
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:projectId/seo/summary', async (req, res, next) => {
    try {
      res.json({ data: await service.getProjectSummary(req.params.projectId) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:projectId/seo/audits', async (req, res, next) => {
    try {
      res.json({ data: await service.listProjectAudits(req.params.projectId) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/seo/audits/:auditRunId', async (req, res, next) => {
    try {
      res.json({ data: await service.getAudit(req.params.auditRunId) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:projectId/seo/issues', async (req, res, next) => {
    try {
      const result = await service.listProjectIssues(req.params.projectId, req.query);
      res.json({
        data: result.data,
        pagination: {
          limit: result.pagination.limit,
          offset: result.pagination.offset,
          total: result.total
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/seo/issues/:issueId', async (req, res, next) => {
    try {
      res.json({ data: await service.getIssue(req.params.issueId) });
    } catch (error) {
      next(error);
    }
  });

  router.patch('/seo/issues/:issueId/status', async (req, res, next) => {
    try {
      res.json({ data: await service.updateIssueStatus(req.params.issueId, req.body) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:projectId/seo/compare', async (req, res, next) => {
    try {
      res.json({ data: await service.compareProjectAudits(req.params.projectId, req.query) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const seoRoutes = createSeoRoutes();
