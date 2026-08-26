import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('P10 UI-02 core pages contract', () => {
  it('productizes login without changing or inventing authentication behavior', () => {
    const login = source('src/views/auth/login.ejs');
    const css = source('src/public/css/p10.css');

    expect(login).toContain('lang="zh-CN"');
    expect(login).toContain('/assets/css/app.css');
    expect(login).toContain('/assets/css/p10.css');
    expect(login).toContain('data-ui="login-page"');
    expect(login).toContain('data-ui="login-marketing"');
    expect(login).toContain('data-ui="login-card"');
    expect(login).toContain('action="/auth/login"');
    expect(login).toContain('name="returnPath"');
    expect(login).toContain('autocomplete="username"');
    expect(login).toContain('autocomplete="current-password"');
    expect(login).not.toContain('name="remember');
    expect(login).not.toContain('忘记密码');
    expect(login).not.toContain('注册');
    expect(css).toContain('.auth-login-page');
  });

  it('builds Project Center from authorized projects and persisted project facts', () => {
    const routes = source('src/web/routes.ts');
    const projectIndex = source('src/views/projects/index.ejs');
    const css = source('src/public/css/p10.css');

    expect(routes).toContain('projectService.listForUser(req.auth!.userId)');
    expect(routes).toContain('dashboardRepository.getProjectFacts(project)');
    expect(routes).toContain('projectRows');
    expect(routes).toContain('projectSummary');

    expect(projectIndex).toContain('data-ui="project-center"');
    expect(projectIndex).toContain('data-ui="project-summary-grid"');
    expect(projectIndex).toContain('data-ui="project-table"');
    expect(projectIndex).toContain('projectSummary.total');
    expect(projectIndex).toContain('projectSummary.active');
    expect(projectIndex).toContain('projectSummary.advanced');
    expect(projectIndex).toContain('projectSummary.enterprise');
    expect(projectIndex).toContain('projectRows.forEach');
    expect(projectIndex).toContain('row.facts.seoScore');
    expect(projectIndex).toContain('row.facts.geoScore');
    expect(projectIndex).toContain("'--'");
    expect(css).toContain('.project-center');
  });

  it('productizes Dashboard from portfolio facts without invented aggregate metrics', () => {
    const dashboard = source('src/views/dashboard.ejs');
    const css = source('src/public/css/p10.css');

    expect(dashboard).toContain('data-ui="dashboard-summary-grid"');
    expect(dashboard).toContain('portfolio.projectCount');
    expect(dashboard).toContain('portfolio.advancedProjectCount');
    expect(dashboard).toContain('portfolio.criticalIssueCount');
    expect(dashboard).toContain('data-ui="dashboard-focus-project"');
    expect(dashboard).toContain('focusFacts?.seoScore');
    expect(dashboard).toContain('focusFacts?.geoScore');
    expect(dashboard).toContain('visibilityRatio');
    expect(dashboard).not.toContain('P10 · Platform Overview');
    expect(dashboard).not.toContain('AI Tasks');
    expect(dashboard).toContain('当前 Dashboard Repository 尚未提供统一活动事件流');
    expect(css).toContain('.dashboard-summary-grid');
    expect(css).toContain('.dashboard-focus-project');
  });
});
