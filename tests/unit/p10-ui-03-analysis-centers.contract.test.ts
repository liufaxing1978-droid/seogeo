import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('P10 UI-03 analysis-center productization contract', () => {
  it('defines the SEO product surface for the current task only', () => {
    const seo = source('src/views/seo/audit.ejs');

    expect(seo).toContain('data-ui="seo-center"');
    expect(seo).toContain('data-ui="seo-score-summary"');
    expect(seo).toContain('data-ui="seo-priority-issues-cta"');
    expect(seo).toContain('处理高优先级问题');
  });

  it('locks the deterministic SEO center hierarchy without fabricated ranking facts', () => {
    const seo = source('src/views/seo/audit.ejs');

    expect(seo).toContain('data-ui="seo-center"');
    expect(seo).toContain('data-ui="seo-score-summary"');
    expect(seo).toContain('data-ui="seo-severity-summary"');
    expect(seo).toContain('data-ui="seo-evidence-table"');
    expect(seo).toContain('data-ui="seo-issues-table"');
    expect(seo).toContain('Issue 由 FAIL 规则结果聚合，不由 AI 推断');
    expect(seo).not.toContain('关键词排名');
    expect(seo).not.toContain('Keyword Ranking');
  });

  it('requires a truthful GEO and AI Visibility secondary navigation', () => {
    const navPath = resolve(process.cwd(), 'src/views/partials/geo-center-nav.ejs');
    expect(existsSync(navPath)).toBe(true);
    if (!existsSync(navPath)) return;

    const nav = readFileSync(navPath, 'utf8');
    for (const label of ['GEO Readiness', 'Citability', 'Entity', 'AI Crawler', 'AI Visibility', '历史', '告警', 'Prompt', '引用', '主体', '指标']) {
      expect(nav).toContain(label);
    }
    for (const route of ['/geo', '/geo/citability', '/geo/entities', '/geo/ai-crawlers', '/visibility', '/visibility/history', '/visibility/alerts', '/visibility/prompts', '/visibility/citations', '/visibility/subjects', '/visibility/metrics']) {
      expect(nav).toContain(route);
    }
    expect(nav).toContain('geoCenterActive');
    expect(nav).not.toContain('href="#"');
  });

  it('mounts the shared GEO / Visibility navigation on every planned subpage', () => {
    const geoPages = [
      ['src/views/geo/overview.ejs', 'readiness'],
      ['src/views/geo/citability.ejs', 'citability'],
      ['src/views/geo/entities.ejs', 'entities'],
      ['src/views/geo/ai-crawlers.ejs', 'ai-crawlers'],
    ] as const;
    const visibilityPages = [
      'src/views/visibility/index.ejs',
      'src/views/visibility/history.ejs',
      'src/views/visibility/alerts.ejs',
      'src/views/visibility/prompts.ejs',
      'src/views/visibility/citations.ejs',
      'src/views/visibility/subjects.ejs',
      'src/views/visibility/metrics.ejs',
    ] as const;

    for (const [path, active] of geoPages) {
      const page = source(path);
      expect(page).toContain("include('../partials/geo-center-nav'");
      expect(page).toContain(`geoCenterActive: '${active}'`);
    }
    for (const path of visibilityPages) {
      expect(source(path)).toContain("include('../partials/geo-center-nav'");
    }
  });

  it('keeps GEO Readiness separate from persisted AI Visibility metrics', () => {
    const geo = source('src/views/geo/overview.ejs');
    const visibility = source('src/views/visibility/index.ejs');

    expect(geo).toContain('data-ui="geo-readiness-center"');
    expect(geo).toContain('data-ui="geo-readiness-summary"');
    expect(geo).toContain('AI Visibility 与 GEO Readiness 是两个指标');
    expect(visibility).toContain('data-ui="visibility-center"');
    expect(visibility).toContain('data-ui="visibility-metrics-summary"');
    expect(visibility).toContain('Owned Mention Rate');
    expect(visibility).toContain('Owned Citation Rate');
    expect(visibility).toContain('Owned Mention SOV');
    expect(visibility).toContain('Evidence Coverage');
    expect(visibility).toContain('官方 Provider API');
    expect(visibility).toContain('UNKNOWN / NO_DATA');
    expect(visibility).not.toContain('ChatGPT 网页端排名');
  });

  it('preserves the existing AI advisory boundary while GEO and Visibility are productized', () => {
    const ai = source('src/views/ai/index.ejs');

    expect(ai).toContain('AI 只分析已保存事实');
    expect(ai).toContain('不展示 API Key');
    expect(ai).toContain('provider reasoning');
  });

  it('uses the approved AI advisory workspace markers', () => {
    const ai = source('src/views/ai/index.ejs');

    expect(ai).toContain('data-ui="ai-analysis-center"');
    expect(ai).toContain('data-ui="ai-advisory-boundary"');
    expect(ai).toContain('data-ui="ai-analysis-actions"');
    expect(ai).toContain('data-ui="ai-task-history"');
  });

  it('productizes AI analysis without turning advisory output into deterministic facts', () => {
    const ai = source('src/views/ai/index.ejs');
    const task = source('src/views/ai/task-show.ejs');

    expect(ai).toContain('data-ui="ai-analysis-center"');
    expect(ai).toContain('data-ui="ai-readiness-summary"');
    expect(ai).toContain('data-ui="ai-boundary-note"');
    expect(ai).toContain('data-ui="ai-task-table"');
    expect(ai).toContain("latestSeoAudit ? 'READY' : '--'");
    expect(ai).toContain("latestGeoAudit ? 'READY' : '--'");
    expect(ai).toContain('P4 不计算');
    expect(task).toContain('data-ui="ai-task-detail"');
    expect(task).toContain('data-ui="ai-result-summary"');
    expect(task).toContain('AI 建议，不会自动改写确定性 SEO/GEO/Entity 数据');
    expect(task).toContain("task.status === 'FAILED'");
    expect(ai).not.toContain('自动执行优化');
    expect(ai).not.toContain('AI 排名');
  });

  it('loads an isolated UI-03 stylesheet with reusable analysis primitives', () => {
    const layout = source('src/views/layout.ejs');
    const cssPath = resolve(process.cwd(), 'src/public/css/p10-ui-03.css');

    expect(layout).toContain('/assets/css/p10-ui-03.css');
    expect(existsSync(cssPath)).toBe(true);

    const css = readFileSync(cssPath, 'utf8');
    for (const selector of [
      '.analysis-center',
      '.analysis-hero',
      '.analysis-metric-grid',
      '.analysis-subnav',
      '.analysis-evidence-note',
      '.analysis-table-panel',
    ]) {
      expect(css).toContain(selector);
    }
  });
});
