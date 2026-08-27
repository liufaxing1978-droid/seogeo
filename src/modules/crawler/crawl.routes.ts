import { Router, type RequestHandler } from 'express';
import { requireAuthentication } from '../../auth/authentication.js';
import { requireCsrf } from '../../auth/csrf.js';
import {
  assertProjectCapability,
  requireProjectCapability,
  requireProjectMembership,
} from '../../auth/project-access.js';
import type { ProjectCapability } from '../../auth/project-capabilities.js';
import { NotFoundError } from '../../core/errors.js';
import { prisma } from '../../db/prisma.js';
import { CrawlService, crawlService } from './crawl.service.js';

function routeParam(value: string | string[] | undefined): string {
  const resolved = Array.isArray(value) ? value[0] : value;
  if (!resolved) throw new NotFoundError();
  return resolved;
}

function requireCrawlCapability(capability: ProjectCapability): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.auth) throw new NotFoundError();
      const crawl = await prisma.crawlRun.findUnique({
        where: { id: routeParam(req.params.crawlId) },
        select: { projectId: true },
      });
      if (!crawl) throw new NotFoundError();
      await assertProjectCapability(req.auth.userId, crawl.projectId, capability);
      next();
    } catch (error) {
      next(error);
    }
  };
}

function requirePageCapability(capability: ProjectCapability): RequestHandler {
  return async (req, _res, next) => {
    try {
      if (!req.auth) throw new NotFoundError();
      const page = await prisma.page.findUnique({
        where: { id: routeParam(req.params.pageId) },
        select: { projectId: true },
      });
      if (!page) throw new NotFoundError();
      await assertProjectCapability(req.auth.userId, page.projectId, capability);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createCrawlRoutes(service: CrawlService = crawlService) {
  const router = Router();

  router.post(
    '/projects/:id/crawls',
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('CRAWL_RUN'),
    async (req, res, next) => {
      try {
        const run = await service.createProjectCrawl(
          routeParam(req.params.id),
          req.body,
        );
        res.status(202).json({ id: run.id, status: run.status });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/projects/:id/crawls',
    requireAuthentication(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_READ'),
    async (req, res, next) => {
      try {
        const result = await service.listProjectCrawls(
          routeParam(req.params.id),
          req.query,
        );
        res.json({
          data: result.data,
          pagination: {
            ...result.pagination,
            total: result.total,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/crawls/:crawlId',
    requireAuthentication(),
    requireCrawlCapability('PROJECT_READ'),
    async (req, res, next) => {
      try {
        res.json({ data: await service.getCrawl(routeParam(req.params.crawlId)) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get(
    '/crawls/:crawlId/pages',
    requireAuthentication(),
    requireCrawlCapability('PROJECT_READ'),
    async (req, res, next) => {
      try {
        const result = await service.listCrawlPages(
          routeParam(req.params.crawlId),
          req.query,
        );
        res.json({
          data: result.data,
          pagination: {
            ...result.pagination,
            total: result.total,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post(
    '/pages/:pageId/crawl',
    requireAuthentication(),
    requireCsrf(),
    requirePageCapability('CRAWL_RUN'),
    async (req, res, next) => {
      try {
        const run = await service.createSinglePageCrawl(
          routeParam(req.params.pageId),
        );
        res.status(202).json({ id: run.id, status: run.status });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export const crawlRoutes = createCrawlRoutes();
