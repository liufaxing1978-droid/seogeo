import { Router } from 'express';
import { requireAuthentication } from '../auth/authentication.js';
import { deriveCsrfToken, requireCsrf } from '../auth/csrf.js';
import { hasFeature } from '../auth/feature-flags.js';
import {
  requireProjectCapability,
  requireProjectMembership,
} from '../auth/project-access.js';
import { env } from '../config/env.js';
import { AppError, NotFoundError } from '../core/errors.js';
import { aiTaskService } from '../modules/ai/ai.service.js';
import { aiWebRepository } from '../modules/ai/ai.web.repository.js';
import { createEntityEnrichmentTask } from '../modules/ai/entity-intelligence.js';
import { createGeoAnalysisTask } from '../modules/ai/geo-intelligence.js';
import { createSeoAnalysisTask } from '../modules/ai/seo-intelligence.js';
import { crawlRepository } from '../modules/crawler/crawl.repository.js';
import { crawlerWebRepository } from '../modules/crawler/crawler.web.repository.js';
import { geoService } from '../modules/geo/geo.service.js';
import { geoWebRepository } from '../modules/geo/geo.web.repository.js';
import { ProjectService } from '../modules/projects/project.service.js';
import { projectRepository } from '../modules/projects/project.repository.js';
import { seoService } from '../modules/seo/seo.service.js';
import { seoWebRepository } from '../modules/seo/seo.web.repository.js';
import { dashboardRepository } from './dashboard.repository.js';
import { projectTabs } from './view-models.js';

const projectService = new ProjectService(projectRepository);
export const webRoutes = Router();

function render(res: any, bodyTemplate: string, locals: Record<string, unknown>) {
  return res.render('layout', {
    title: 'SEO GEO',
    activeNav: 'overview',
    currentProjectId: null,
    bodyTemplate,
    ...locals
  });
}

function csrfTokenFor(req: any, res: any): string {
  const tokenHash = res.locals.authSessionTokenHash;
  if (!req.auth || typeof tokenHash !== 'string') {
    throw new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  }
  return deriveCsrfToken(
    env.SESSION_SECRET,
    req.auth.sessionId,
    tokenHash,
  );
}

function assertAiAnalysisFeature(project: { planLevel: 'STANDARD' | 'ADVANCED' | 'ENTERPRISE' }) {
  if (!hasFeature(project.planLevel, 'AI_ANALYSIS')) {
    throw new AppError('AI analysis is not available for this project plan', 403, 'FEATURE_NOT_AVAILABLE');
  }
}

webRoutes.get('/', requireAuthentication(), async (req, res, next) => {
  try {
    const portfolio = await dashboardRepository.getPortfolioForUser(req.auth!.userId, { limit: 50 });
    render(res, 'dashboard', { portfolio });
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/projects', requireAuthentication(), async (req, res, next) => {
  try {
    const projects = await projectService.listForUser(req.auth!.userId);
    const projectRows = await Promise.all(projects.map(async (project) => ({
      project,
      facts: await dashboardRepository.getProjectFacts(project)
    })));
    const projectSummary = {
      total: projectRows.length,
      active: projectRows.filter(({ project }) => project.status === 'ACTIVE').length,
      advanced: projectRows.filter(({ project }) => project.planLevel === 'ADVANCED').length,
      enterprise: projectRows.filter(({ project }) => project.planLevel === 'ENTERPRISE').length
    };
    render(res, 'projects/index', {
      title: '项目中心',
      activeNav: 'projects',
      currentProjectId: projects.length === 1 ? projects[0].id : null,
      projectRows,
      projectSummary
    });
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/projects/new', requireAuthentication(), (req, res) => {
  render(res, 'projects/new', {
    title: '新建项目',
    activeNav: 'projects',
    values: {},
    errors: {},
    csrfToken: csrfTokenFor(req, res)
  });
});

webRoutes.post('/projects', requireAuthentication(), requireCsrf(), async (req, res) => {
  const projectInput = { ...(req.body ?? {}) };
  delete projectInput._csrf;
  try {
    const project = await projectService.createForOwner(req.auth!.userId, projectInput);
    res.redirect(303, `/projects/${project.id}`);
  } catch (error: any) {
    const errors = error?.details?.fieldErrors ?? {};
    res.status(400);
    render(res, 'projects/new', {
      title: '新建项目',
      activeNav: 'projects',
      values: projectInput,
      errors,
      csrfToken: csrfTokenFor(req, res)
    });
  }
});

webRoutes.get('/projects/:id/crawls', async (req, res, next) => {
  try {
    const project = await projectService.get(req.params.id);
    const [result, indexNow] = await Promise.all([
      crawlRepository.listRuns(project.id, { limit: 100, offset: 0 }),
      crawlerWebRepository.getProjectCrawlerHealthAndSubmissions(project.id)
    ]);
    render(res, 'crawls/index', {
      title: '抓取历史',
      activeNav: 'crawls',
      currentProjectId: project.id,
      project,
      runs: result.data,
      total: result.total,
      latestHealth: indexNow.latestHealth,
      submissions: indexNow.submissions
    });
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/crawls/:crawlId', async (req, res, next) => {
  try {
    const crawl = await crawlRepository.getRunDetail(req.params.crawlId);
    if (!crawl) throw new NotFoundError('Crawl not found', 'CRAWL_NOT_FOUND');
    const pageResult = await crawlRepository.listRunPages(crawl.id, { limit: 100, offset: 0 });
    render(res, 'crawls/show', {
      title: '抓取详情',
      activeNav: 'crawls',
      currentProjectId: crawl.project.id,
      crawl,
      pages: pageResult.data,
      pageTotal: pageResult.total
    });
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/projects/:id/pages', async (req, res, next) => {
  try {
    const project = await projectService.get(req.params.id);
    const result = await crawlerWebRepository.listProjectPages(project.id, { limit: 100, offset: 0 });
    render(res, 'pages/index', {
      title: '页面中心',
      activeNav: 'pages',
      currentProjectId: project.id,
      project,
      pages: result.data,
      total: result.total
    });
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/pages/:pageId', async (req, res, next) => {
  try {
    const page = await crawlerWebRepository.getPageDetail(req.params.pageId);
    if (!page) throw new NotFoundError('Page not found', 'PAGE_NOT_FOUND');
    render(res, 'pages/show', {
      title: '页面详情',
      activeNav: 'pages',
      currentProjectId: page.project.id,
      page,
      latest: page.snapshots[0] ?? null,
      snapshots: page.snapshots
    });
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/projects/:id/seo', async (req, res, next) => {
  try {
    const model = await seoWebRepository.getAuditDashboard(req.params.id);
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');

    render(res, 'seo/audit', {
      title: 'SEO 审计',
      activeNav: 'seo',
      currentProjectId: model.project.id,
      ...model
    });
  } catch (error) {
    next(error);
  }
});

webRoutes.post('/projects/:id/seo/run', async (req, res, next) => {
  try {
    await seoService.createProjectAudit(req.params.id, {});
    res.redirect(303, `/projects/${req.params.id}/seo`);
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/projects/:id/seo/issues', async (req, res, next) => {
  try {
    const model = await seoWebRepository.listProjectIssues(req.params.id);
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');

    render(res, 'seo/issues', {
      title: 'SEO 问题中心',
      activeNav: 'seo',
      currentProjectId: model.project.id,
      ...model
    });
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/projects/:id/seo/compare', async (req, res, next) => {
  try {
    const currentAuditId = typeof req.query.current === 'string' ? req.query.current : '';
    const previousAuditId = typeof req.query.previous === 'string' ? req.query.previous : '';
    if (!currentAuditId || !previousAuditId) {
      throw new NotFoundError('SEO audit comparison not found', 'SEO_COMPARE_NOT_FOUND');
    }

    const model = await seoWebRepository.getAuditComparison(
      req.params.id,
      currentAuditId,
      previousAuditId
    );
    if (!model) throw new NotFoundError('SEO audit comparison not found', 'SEO_COMPARE_NOT_FOUND');

    render(res, 'seo/compare', {
      title: 'SEO 审计对比',
      activeNav: 'seo',
      currentProjectId: model.project.id,
      ...model
    });
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/seo/issues/:issueId', async (req, res, next) => {
  try {
    const model = await seoWebRepository.getIssuePage(req.params.issueId);
    if (!model) throw new NotFoundError('SEO issue not found', 'SEO_ISSUE_NOT_FOUND');

    render(res, 'seo/issue-show', {
      title: model.issue.title,
      activeNav: 'seo',
      currentProjectId: model.project.id,
      ...model
    });
  } catch (error) {
    next(error);
  }
});

webRoutes.post('/seo/issues/:issueId/status', async (req, res, next) => {
  try {
    await seoService.updateIssueStatus(req.params.issueId, req.body);
    res.redirect(303, `/seo/issues/${req.params.issueId}`);
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/projects/:id/geo', async (req, res, next) => {
  try {
    const model = await geoWebRepository.getOverview(req.params.id);
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');

    render(res, 'geo/overview', {
      title: 'GEO 概览',
      activeNav: 'geo',
      currentProjectId: model.project.id,
      ...model
    });
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/projects/:id/geo/citability', async (req, res, next) => {
  try {
    const model = await geoWebRepository.getCitabilityPage(req.params.id);
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    render(res, 'geo/citability', {
      title: 'Citability',
      activeNav: 'geo',
      currentProjectId: model.project.id,
      ...model
    });
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/projects/:id/geo/entities', async (req, res, next) => {
  try {
    const model = await geoWebRepository.getEntitiesPage(req.params.id);
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    render(res, 'geo/entities', {
      title: 'Entity',
      activeNav: 'geo',
      currentProjectId: model.project.id,
      ...model
    });
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/projects/:id/geo/ai-crawlers', async (req, res, next) => {
  try {
    const model = await geoWebRepository.getAiCrawlerPage(req.params.id);
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    render(res, 'geo/ai-crawlers', {
      title: 'AI Crawler',
      activeNav: 'geo',
      currentProjectId: model.project.id,
      ...model
    });
  } catch (error) {
    next(error);
  }
});

webRoutes.post('/projects/:id/geo/run', async (req, res, next) => {
  try {
    await geoService.createProjectAudit(req.params.id, {});
    res.redirect(303, `/projects/${req.params.id}/geo`);
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/projects/:id/ai', async (req, res, next) => {
  try {
    const model = await aiWebRepository.getCenter(req.params.id);
    if (!model) throw new NotFoundError('Project not found', 'PROJECT_NOT_FOUND');
    assertAiAnalysisFeature(model.project);
    render(res, 'ai/index', {
      title: 'DeepSeek AI 分析中心',
      activeNav: 'ai',
      currentProjectId: model.project.id,
      ...model
    });
  } catch (error) {
    next(error);
  }
});

webRoutes.post('/projects/:id/ai/seo', async (req, res, next) => {
  try {
    const project = await projectService.get(req.params.id);
    assertAiAnalysisFeature(project);
    const auditRunId = typeof req.body.auditRunId === 'string' ? req.body.auditRunId : '';
    if (!auditRunId) throw new AppError('auditRunId is required', 400, 'AI_SOURCE_AUDIT_REQUIRED');
    const task = await createSeoAnalysisTask(project.id, auditRunId, aiTaskService);
    res.redirect(303, `/projects/${project.id}/ai/tasks/${task.id}`);
  } catch (error) {
    next(error);
  }
});

webRoutes.post('/projects/:id/ai/geo', async (req, res, next) => {
  try {
    const project = await projectService.get(req.params.id);
    assertAiAnalysisFeature(project);
    const geoAuditRunId = typeof req.body.geoAuditRunId === 'string' ? req.body.geoAuditRunId : '';
    if (!geoAuditRunId) throw new AppError('geoAuditRunId is required', 400, 'AI_SOURCE_AUDIT_REQUIRED');
    const task = await createGeoAnalysisTask(project.id, geoAuditRunId, aiTaskService);
    res.redirect(303, `/projects/${project.id}/ai/tasks/${task.id}`);
  } catch (error) {
    next(error);
  }
});

webRoutes.post('/projects/:id/ai/entity', async (req, res, next) => {
  try {
    const project = await projectService.get(req.params.id);
    assertAiAnalysisFeature(project);
    const geoAuditRunId = typeof req.body.geoAuditRunId === 'string' ? req.body.geoAuditRunId : '';
    if (!geoAuditRunId) throw new AppError('geoAuditRunId is required', 400, 'AI_SOURCE_AUDIT_REQUIRED');
    const task = await createEntityEnrichmentTask(project.id, geoAuditRunId, aiTaskService);
    res.redirect(303, `/projects/${project.id}/ai/tasks/${task.id}`);
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/projects/:id/ai/tasks/:taskId', async (req, res, next) => {
  try {
    const model = await aiWebRepository.getTaskPage(req.params.id, req.params.taskId);
    if (!model) throw new NotFoundError('AI task not found', 'AI_TASK_NOT_FOUND');
    assertAiAnalysisFeature(model.project);
    render(res, 'ai/task-show', {
      title: 'AI 任务详情',
      activeNav: 'ai',
      currentProjectId: model.project.id,
      ...model
    });
  } catch (error) {
    next(error);
  }
});

webRoutes.post('/projects/:id/ai/tasks/:taskId/retry', async (req, res, next) => {
  try {
    const model = await aiWebRepository.getTaskPage(req.params.id, req.params.taskId);
    if (!model) throw new NotFoundError('AI task not found', 'AI_TASK_NOT_FOUND');
    assertAiAnalysisFeature(model.project);
    await aiTaskService.retry(model.task.id);
    res.redirect(303, `/projects/${model.project.id}/ai/tasks/${model.task.id}`);
  } catch (error) {
    next(error);
  }
});

webRoutes.get(
  '/projects/:id',
  requireAuthentication(),
  requireProjectMembership(),
  requireProjectCapability('PROJECT_READ'),
  async (_req, res, next) => {
    try {
      const project = res.locals.project;
      const dashboard = await dashboardRepository.getProjectFacts(project);
      render(res, 'projects/show', {
        title: project.name,
        activeNav: 'projects',
        currentProjectId: project.id,
        project,
        tabs: projectTabs,
        dashboard
      });
    } catch (error) {
      next(error);
    }
  },
);
