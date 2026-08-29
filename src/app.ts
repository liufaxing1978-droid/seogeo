import express from 'express';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createAuthRoutes } from './auth/auth.routes.js';
import { authenticationMiddleware } from './auth/authentication.js';
import { env } from './config/env.js';
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
import {
  createDistributionRoutes,
  type DistributionApiPort
} from './modules/distribution/distribution.routes.js';
import { distributionWebRoutes } from './modules/distribution/distribution.web.routes.js';
import { createGeoRoutes } from './modules/geo/geo.routes.js';
import type { GeoService } from './modules/geo/geo.service.js';
import { createGrowthExplanationRoutes } from './modules/growth/growth-explanation.routes.js';
import { createGrowthRoutes, type GrowthRestRepository } from './modules/growth/growth.routes.js';
import { createGrowthWebRoutes } from './modules/growth/growth.web.routes.js';
import { healthRoutes } from './modules/health/health.routes.js';
import type { KeywordCoverageService } from './modules/keywords/keyword-coverage.service.js';
import { createKeywordRoutes } from './modules/keywords/keyword.routes.js';
import type { KeywordSearchEvidenceService } from './modules/keywords/keyword-search-evidence.service.js';
import type { KeywordService } from './modules/keywords/keyword.service.js';
import { createKeywordWebRoutes } from './modules/keywords/keyword.web.routes.js';
import { createMarketRoutes, type MarketApiPort } from './modules/market/market.routes.js';
import {
  createOptimizationExperimentRoutes,
  type OptimizationExperimentApiPort
} from './modules/optimization-experiments/experiment.routes.js';
import { optimizationExperimentWebRoutes } from './modules/optimization-experiments/experiment.web.routes.js';
import {
  createOptimizationFeedbackRoutes,
  type OptimizationFeedbackApiPort,
} from './modules/optimization-feedback/feedback.routes.js';
import {
  createOptimizationOperationsRoutes,
  type OperationsActorResolver,
  type OptimizationOperationsApiPort,
  type PolicyRevisionCommandPort,
} from './modules/optimization-operations/operations.routes.js';
import { createOptimizationOperationsWebRoutes } from './modules/optimization-operations/operations.web.routes.js';
import {
  createOptimizationOrchestrationRoutes,
  type OptimizationOrchestrationApiPort
} from './modules/optimization-orchestration/orchestration.routes.js';
import { createProjectAdminWebRoutes } from './modules/projects/project-admin.web.routes.js';
import { createProjectMembershipRoutes } from './modules/projects/project-membership.routes.js';
import { projectRoutes } from './modules/projects/project.routes.js';
import {
  createPublicationRoutes,
  type PublicationApiPort
} from './modules/publication/publication.routes.js';
import { publicationWebRoutes } from './modules/publication/publication.web.routes.js';
import { createReportRoutes } from './modules/reporting/report.routes.js';
import { reportWebRoutes } from './modules/reporting/report.web.routes.js';
import { createSearchConsoleRoutes } from './modules/search-console/search-console.routes.js';
import type { SearchConsoleService } from './modules/search-console/search-console.service.js';
import { searchConsoleWebRoutes } from './modules/search-console/search-console.web.routes.js';
import { createOfficialSearchSyncRoutes } from './modules/search-sync/official-search-sync.routes.js';
import type { OfficialSearchBindingRepositoryPort } from './modules/search-sync/official-search-sync.types.js';
import { createSeoRoutes } from './modules/seo/seo.routes.js';
import type { SeoService } from './modules/seo/seo.service.js';
import { createVisibilityRoutes } from './modules/visibility/visibility.routes.js';
import type { VisibilityRunService } from './modules/visibility/visibility-run.service.js';
import { visibilityWebRoutes } from './modules/visibility/visibility.web.routes.js';
import { createVisibilityIntelligenceRoutes } from './modules/visibility/visibility-intelligence.routes.js';
import { visibilityIntelligenceWebRoutes } from './modules/visibility/visibility-intelligence.web.routes.js';
import type { VisibilityExtractionQueue } from './modules/visibility/visibility-extraction.queue.js';
import { createVisibilityMetricsRoutes } from './modules/visibility/visibility-metrics.routes.js';
import type { VisibilityMetricsQueue } from './modules/visibility/visibility-metrics.queue.js';
import { createVisibilityMetricsWebRoutes } from './modules/visibility/visibility-metrics.web.routes.js';
import { createVisibilityHistoryRoutes } from './modules/visibility/visibility-history.routes.js';
import { visibilityHistoryWebRoutes } from './modules/visibility/visibility-history.web.routes.js';
import { configureTrustProxy } from './runtime/trust-proxy.js';
import { webRoutes } from './web/routes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const assetsDir = path.join(here, 'public');

export interface AppOptions {
  crawlService?: CrawlService;
  seoService?: SeoService;
  geoService?: GeoService;
  aiTaskService?: AiTaskService;
  contentService?: ContentService;
  competitorService?: CompetitorService;
  keywordService?: KeywordService;
  keywordCoverageService?: KeywordCoverageService;
  keywordSearchEvidenceService?: Pick<KeywordSearchEvidenceService, 'evaluateKeyword' | 'evaluateProject'>;
  searchConsoleService?: SearchConsoleService;
  officialSearchBindingRepository?: OfficialSearchBindingRepositoryPort;
  growthApiRepository?: Partial<GrowthRestRepository>;
  optimizationOrchestrationApi?: OptimizationOrchestrationApiPort;
  optimizationExperimentApi?: OptimizationExperimentApiPort;
  optimizationFeedbackApi?: OptimizationFeedbackApiPort;
  optimizationOperationsApi?: OptimizationOperationsApiPort;
  policyRevisionCommand?: PolicyRevisionCommandPort;
  operationsActorResolver?: OperationsActorResolver;
  publicationApi?: PublicationApiPort;
  distributionApi?: DistributionApiPort;
  marketService?: MarketApiPort;
  visibilityRunService?: VisibilityRunService;
  visibilityExtractionQueue?: VisibilityExtractionQueue;
  visibilityMetricsQueue?: VisibilityMetricsQueue;
}

export function createApp(options: AppOptions = {}) {
  const app = express();
  configureTrustProxy(app, env.TRUST_PROXY_HOPS);
  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(here, 'views'));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use('/assets', express.static(assetsDir));
  app.use('/health', healthRoutes);
  app.use(authenticationMiddleware);
  app.use('/auth', createAuthRoutes());
  app.use('/api/projects', createProjectMembershipRoutes());
  app.use('/api/projects', projectRoutes);
  app.use('/api', createMarketRoutes(options.marketService));
  app.use('/api', createCrawlRoutes(options.crawlService));
  app.use('/api', createSeoRoutes(options.seoService));
  app.use('/api', createGeoRoutes(options.geoService));
  app.use('/api', createSearchConsoleRoutes(options.searchConsoleService));
  app.use('/api', createGrowthRoutes(options.growthApiRepository));
  app.use('/api', createOptimizationFeedbackRoutes(options.optimizationFeedbackApi));
  app.use('/api/v1', createGrowthExplanationRoutes(options.aiTaskService));
  app.use('/api/v1', createAiRoutes(options.aiTaskService));
  app.use('/api/v1', createContentRoutes(options.contentService, options.aiTaskService));
  app.use('/api/v1', createCompetitorRoutes(options.competitorService, options.aiTaskService));
  app.use('/api/v1', createKeywordRoutes(
    options.keywordService,
    options.keywordCoverageService,
    options.aiTaskService,
    options.keywordSearchEvidenceService,
  ));
  app.use('/api/v1', createOfficialSearchSyncRoutes(options.officialSearchBindingRepository));
  app.use('/api/v1', createOptimizationOrchestrationRoutes(options.optimizationOrchestrationApi));
  app.use('/api/v1', createOptimizationOperationsRoutes(
    options.optimizationOperationsApi,
    options.policyRevisionCommand,
    options.operationsActorResolver,
  ));
  app.use('/api/v1', createOptimizationExperimentRoutes(options.optimizationExperimentApi));
  app.use('/api/v1', createPublicationRoutes(options.publicationApi));
  app.use('/api/v1', createDistributionRoutes(options.distributionApi));
  app.use('/api/v1', createReportRoutes(options.aiTaskService));
  app.use('/api/v1', createVisibilityRoutes(options.visibilityRunService));
  app.use('/api/v1', createVisibilityIntelligenceRoutes(options.visibilityExtractionQueue));
  app.use('/api/v1', createVisibilityMetricsRoutes(options.visibilityMetricsQueue));
  app.use('/api/v1', createVisibilityHistoryRoutes());
  app.use('/', contentWebRoutes);
  app.use('/', publicationWebRoutes);
  app.use('/', distributionWebRoutes);
  app.use('/', competitorWebRoutes);
  app.use('/', reportWebRoutes);
  app.use('/', visibilityWebRoutes);
  app.use('/', visibilityIntelligenceWebRoutes);
  app.use('/', createVisibilityMetricsWebRoutes(options.visibilityMetricsQueue));
  app.use('/', visibilityHistoryWebRoutes);
  app.use('/', searchConsoleWebRoutes);
  app.use('/', createGrowthWebRoutes(options.growthApiRepository));
  app.use('/', createOptimizationOperationsWebRoutes(
    options.optimizationOperationsApi,
    options.operationsActorResolver,
  ));
  app.use('/', optimizationExperimentWebRoutes);
  app.use('/', createKeywordWebRoutes(
    options.keywordService,
    options.keywordCoverageService,
    options.aiTaskService,
    options.keywordSearchEvidenceService,
  ));
  app.use('/', createProjectAdminWebRoutes());
  app.use('/', webRoutes);
  app.use(errorHandler);
  return app;
}