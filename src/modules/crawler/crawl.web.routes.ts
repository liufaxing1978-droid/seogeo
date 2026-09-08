import { Router } from 'express';
import { requireAuthentication } from '../../auth/authentication.js';
import { requireCsrf } from '../../auth/csrf.js';
import {
  requireProjectCapability,
  requireProjectMembership,
} from '../../auth/project-access.js';
import { NotFoundError } from '../../core/errors.js';
import { CrawlService, crawlService } from './crawl.service.js';

function routeParam(value: string | string[] | undefined): string {
  const resolved = Array.isArray(value) ? value[0] : value;
  if (!resolved) throw new NotFoundError();
  return resolved;
}

export function createCrawlWebRoutes(service: CrawlService = crawlService) {
  const router = Router();

  router.post(
    '/projects/:id/crawls',
    requireAuthentication(),
    requireCsrf(),
    requireProjectMembership(),
    requireProjectCapability('CRAWL_RUN'),
    async (req, res, next) => {
      try {
        const run = await service.createProjectCrawl(routeParam(req.params.id), {
          runType: 'MANUAL',
        });
        res.redirect(303, `/crawls/${run.id}`);
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}
