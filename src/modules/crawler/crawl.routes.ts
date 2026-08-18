import { Router } from 'express';
import { CrawlService, crawlService } from './crawl.service.js';

export function createCrawlRoutes(service: CrawlService = crawlService) {
  const router = Router();

  router.post('/projects/:id/crawls', async (req, res, next) => {
    try {
      const run = await service.createProjectCrawl(req.params.id, req.body);
      res.status(202).json({ id: run.id, status: run.status });
    } catch (error) {
      next(error);
    }
  });

  router.get('/projects/:id/crawls', async (req, res, next) => {
    try {
      const result = await service.listProjectCrawls(req.params.id, req.query);
      res.json({
        data: result.data,
        pagination: {
          ...result.pagination,
          total: result.total
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/crawls/:crawlId', async (req, res, next) => {
    try {
      res.json({ data: await service.getCrawl(req.params.crawlId) });
    } catch (error) {
      next(error);
    }
  });

  router.get('/crawls/:crawlId/pages', async (req, res, next) => {
    try {
      const result = await service.listCrawlPages(req.params.crawlId, req.query);
      res.json({
        data: result.data,
        pagination: {
          ...result.pagination,
          total: result.total
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/pages/:pageId/crawl', async (req, res, next) => {
    try {
      const run = await service.createSinglePageCrawl(req.params.pageId);
      res.status(202).json({ id: run.id, status: run.status });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

export const crawlRoutes = createCrawlRoutes();
