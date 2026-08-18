import { Router } from 'express';
import { GeoService, geoService } from './geo.service.js';

export function createGeoRoutes(service: GeoService = geoService) {
  const router = Router();

  router.post('/projects/:projectId/geo-audits', async (req, res, next) => {
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

  router.get('/projects/:projectId/geo/summary', async (req, res, next) => {
    try {
      res.json({ data: await service.getProjectSummary(req.params.projectId) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:projectId/geo/audits', async (req, res, next) => {
    try {
      res.json({ data: await service.listProjectAudits(req.params.projectId) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/geo/audits/:auditRunId', async (req, res, next) => {
    try {
      res.json({ data: await service.getAudit(req.params.auditRunId) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:projectId/geo/citability', async (req, res, next) => {
    try {
      res.json({ data: await service.listCitability(req.params.projectId) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:projectId/geo/entities', async (req, res, next) => {
    try {
      res.json({ data: await service.listEntities(req.params.projectId) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:projectId/geo/ai-crawlers', async (req, res, next) => {
    try {
      res.json({ data: await service.listAiCrawlers(req.params.projectId) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:projectId/geo/opportunities', async (req, res, next) => {
    try {
      res.json({ data: await service.listOpportunities(req.params.projectId) });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const geoRoutes = createGeoRoutes();
