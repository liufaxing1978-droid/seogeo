import { Router } from 'express';
import { NotFoundError } from '../core/errors.js';
import { crawlRepository } from '../modules/crawler/crawl.repository.js';
import { crawlerWebRepository } from '../modules/crawler/crawler.web.repository.js';
import { geoService } from '../modules/geo/geo.service.js';
import { geoWebRepository } from '../modules/geo/geo.web.repository.js';
import { ProjectService } from '../modules/projects/project.service.js';
import { projectRepository } from '../modules/projects/project.repository.js';
import { seoService } from '../modules/seo/seo.service.js';
import { seoWebRepository } from '../modules/seo/seo.web.repository.js';
import { dashboardMetrics, projectTabs } from './view-models.js';

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

webRoutes.get('/', async (_req, res, next) => {
  try {
    render(res, 'dashboard', { metrics: dashboardMetrics });
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/projects', async (_req, res, next) => {
  try {
    const projects = await projectService.list();
    render(res, 'projects/index', { title: '项目列表', activeNav: 'projects', projects });
  } catch (error) {
    next(error);
  }
});

webRoutes.get('/projects/new', (_req, res) => {
  render(res, 'projects/new', {
    title: '新建项目',
    activeNav: 'projects',
    values: {},
    errors: {}
  });
});

webRoutes.post('/projects', async (req, res) => {
  try {
    const project = await projectService.create(req.body);
    res.redirect(303, `/projects/${project.id}`);
  } catch (error: any) {
    const errors = error?.details?.fieldErrors ?? {};
    res.status(400);
    render(res, 'projects/new', {
      title: '新建项目',
      activeNav: 'projects',
      values: req.body,
      errors
    });
  }
});

webRoutes.get('/projects/:id/crawls', async (req, res, next) => {
  try {
    const project = await projectService.get(req.params.id);
    const result = await crawlRepository.listRuns(project.id, { limit: 100, offset: 0 });
    render(res, 'crawls/index', {
      title: '抓取历史',
      activeNav: 'crawls',
      currentProjectId: project.id,
      project,
      runs: result.data,
      total: result.total
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

webRoutes.get('/projects/:id', async (req, res, next) => {
  try {
    const project = await projectService.get(req.params.id);
    render(res, 'projects/show', {
      title: project.name,
      activeNav: 'projects',
      currentProjectId: project.id,
      project,
      tabs: projectTabs
    });
  } catch (error) {
    next(error);
  }
});
