import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
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
import {
  IndexNowSubmissionService,
  indexNowSubmissionService
} from '../indexnow/indexnow.service.js';

const indexNowSubmissionSchema = z.object({
  urls: z.array(z.string().url()).min(1).max(10_000)
});

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

function safeIndexNowBatch(batch: {
  id: string;
  projectId: string;
  status: string;
  attemptCount: number;
  responseStatusCode: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  urls: Array<{ id: string; url: string; status: string; errorCode: string | null }>;
}) {
  return {
    id: batch.id,
    projectId: batch.projectId,
    status: batch.status,
    attemptCount: batch.attemptCount,
    responseStatusCode: batch.responseStatusCode,
    errorCode: batch.errorCode,
    errorMessage: batch.errorMessage,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    urls: batch.urls.map((url) => ({
      id: url.id,
      url: url.url,
      status: url.status,
      errorCode: url.errorCode
    }))
  };
}

export function createCrawlRoutes(
  service: CrawlService = crawlService,
  submissionService: IndexNowSubmissionService = indexNowSubmissionService
) {
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
    '/projects/:id/indexnow-submissions',
    requireAuthentication(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_READ'),
    async (req, res, next) => {
      try {
        const projectId = routeParam(req.params.id);
        const batches = await prisma.indexNowSubmissionBatch.findMany({
          where: { projectId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          include: { urls: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } }
        });
        res.json({ data: batches.map(safeIndexNowBatch) });
      } catch (error) {
        next(error);
      }
    }
  );

  router.get(
    '/projects/:id/crawler-health/latest',
    requireAuthentication(),
    requireProjectMembership(),
    requireProjectCapability('PROJECT_READ'),
    async (req, res, next) => {
      try {
        const projectId = routeParam(req.params.id);
        const snapshot = await prisma.crawlerHealthSnapshot.findFirst({
          where: { projectId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: {
            id: true,
            projectId: true,
            crawlRunId: true,
            status: true,
            calculationVersion: true,
            createdAt: true
          }
        });
        res.json({ data: snapshot });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    '/projects/:id/indexnow-submissions',
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('CRAWL_RUN'),
    async (req, res, next) => {
      try {
        const input = indexNowSubmissionSchema.parse(req.body);
        const batch = await submissionService.create({
          projectId: routeParam(req.params.id),
          urls: input.urls,
          actorUserId: req.auth!.userId
        });
        res.status(202).json({ data: safeIndexNowBatch(batch) });
      } catch (error) {
        next(error);
      }
    }
  );

  router.post(
    '/projects/:id/indexnow-submissions/:batchId/retry',
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('CRAWL_RUN'),
    async (req, res, next) => {
      try {
        const batch = await submissionService.retry({
          projectId: routeParam(req.params.id),
          batchId: routeParam(req.params.batchId)
        });
        res.status(202).json({ data: safeIndexNowBatch(batch) });
      } catch (error) {
        next(error);
      }
    }
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
