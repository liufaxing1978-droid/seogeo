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
