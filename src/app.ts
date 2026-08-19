import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { errorHandler } from './core/http.js';
import { createAiRoutes } from './modules/ai/ai.routes.js';
import type { AiTaskService } from './modules/ai/ai.service.js';
import { createCompetitorRoutes } from './modules/competitor/competitor.routes.js';
import type { CompetitorService } from './modules/competitor/competitor.service.js';
import { competitorWebRoutes } from './modules/competitor/competitor.web.routes.js';
import { createContentRoutes } from './modules/content/content.routes.js';
import type { ContentService } from './modules/content/content.service.js';
import { contentWebRoutes } from './modules/content/content.web.routes.js';
import { createCrawlRoutes } from './modules/crawler/crawl.routes.js';
import type { CrawlService } from './modules/crawler/crawl.service.js';
import { createGeoRoutes } from './modules/geo/geo.routes.js';
import type { GeoService } from './modules/geo/geo.service.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { projectRoutes } from './modules/projects/project.routes.js';
import { createReportRoutes } from './modules/reporting/report.routes.js';
import { reportWebRoutes } from './modules/reporting/report.web.routes.js';
import { createSeoRoutes } from './modules/seo/seo.routes.js';
import type { SeoService } from './modules/seo/seo.service.js';
import { createVisibilityRoutes } from './modules/visibility/visibility.routes.js';
import type { VisibilityRunService } from './modules/visibility/visibility-run.service.js';
import { webRoutes } from './web/routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface AppOptions {
  crawlService?: CrawlService;
  seoService?: SeoService;
  geoService?: GeoService;
  aiTaskService?: AiTaskService;
  contentService?: ContentService;
  competitorService?: CompetitorService;
  visibilityRunService?: VisibilityRunService;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(here, 'views'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/assets', express.static(path.join(here, 'public')));
  app.use('/health', healthRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api', createCrawlRoutes(options.crawlService));
  app.use('/api', createSeoRoutes(options.seoService));
  app.use('/api', createGeoRoutes(options.geoService));
  app.use('/api/v1', createAiRoutes(options.aiTaskService));
  app.use('/api/v1', createContentRoutes(options.contentService, options.aiTaskService));
  app.use('/api/v1', createCompetitorRoutes(options.competitorService, options.aiTaskService));
  app.use('/api/v1', createReportRoutes(options.aiTaskService));
  app.use('/api/v1', createVisibilityRoutes(options.visibilityRunService));
  app.use('/', contentWebRoutes);
  app.use('/', competitorWebRoutes);
  app.use('/', reportWebRoutes);
  app.use('/', webRoutes);
  app.use(errorHandler);
  return app;
}
