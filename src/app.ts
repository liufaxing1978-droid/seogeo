import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { errorHandler } from './core/http.js';
import { createCrawlRoutes } from './modules/crawler/crawl.routes.js';
import type { CrawlService } from './modules/crawler/crawl.service.js';
import { createGeoRoutes } from './modules/geo/geo.routes.js';
import { geoWebRoutes } from './modules/geo/geo.web.routes.js';
import type { GeoService } from './modules/geo/geo.service.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { projectRoutes } from './modules/projects/project.routes.js';
import { createSeoRoutes } from './modules/seo/seo.routes.js';
import type { SeoService } from './modules/seo/seo.service.js';
import { webRoutes } from './web/routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export interface AppOptions {
  crawlService?: CrawlService;
  seoService?: SeoService;
  geoService?: GeoService;
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
  app.use('/', geoWebRoutes);
  app.use('/', webRoutes);

  app.use(errorHandler);

  return app;
}
