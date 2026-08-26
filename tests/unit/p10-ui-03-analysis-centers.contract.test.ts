import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('P10 UI-03 analysis-center productization contract', () => {
  it('defines explicit SEO, GEO, Visibility, and AI product surfaces', () => {
    const seo = source('src/views/seo/audit.ejs');
    const geo = source('src/views/geo/overview.ejs');
    const visibility = source('src/views/visibility/index.ejs');
    const ai = source('src/views/ai/index.ejs');

    expect(seo).toContain('data-ui="seo-center"');
    expect(seo).toContain('data-ui="seo-score-summary"');
    expect(geo).toContain('data-ui="geo-readiness-center"');
    expect(geo).toContain('data-ui="geo-readiness-summary"');
    expect(visibility).toContain('data-ui="visibility-center"');
    expect(visibility).toContain('data-ui="visibility-metrics-summary"');
    expect(ai).toContain('data-ui="ai-analysis-center"');
    expect(ai).toContain('data-ui="ai-advisory-boundary"');
  });

  it('keeps measurement and AI authority boundaries explicit', () => {
    const geo = source('src/views/geo/overview.ejs');
    const visibility = source('src/views/visibility/index.ejs');
    const ai = source('src/views/ai/index.ejs');

    expect(geo).toContain('AI Visibility 与 GEO Readiness');
    expect(visibility).toContain('官方 Provider API');
    expect(visibility).toContain('UNKNOWN / NO_DATA');
    expect(ai).toContain('AI 只分析已保存事实');
    expect(ai).toContain('不会展示原始 fact pack、API Key 或 provider reasoning');
  });

  it('ships reusable analysis-center primitives', () => {
    const css = source('src/public/css/p10.css');

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
