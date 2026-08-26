import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const cwd = process.cwd();

function read(relative: string): string {
  return fs.readFileSync(path.join(cwd, relative), 'utf8');
}

describe('P10 UI-04 content, publishing, intelligence contract', () => {
  it('defines shared content / publishing / distribution secondary navigation', () => {
    const nav = read('src/views/partials/content-publishing-nav.ejs');

    expect(nav).toContain('data-ui="content-publishing-nav"');
    expect(nav).toContain('data-ui="content-nav-content"');
    expect(nav).toContain('data-ui="content-nav-publication"');
    expect(nav).toContain('data-ui="content-nav-distribution"');
  });

  it('keeps the complete content lifecycle visible instead of collapsing it to draft/published', () => {
    const content = read('src/views/content/index.ejs');

    expect(content).toContain('data-ui="content-production-center"');
    expect(content).toContain('data-ui="content-state-machine"');
    expect(content).toContain('draft');
    expect(content).toContain('generated');
    expect(content).toContain('reviewed');
    expect(content).toContain('operator_reviewed');
    expect(content).toContain('approved');
    expect(content).toContain('publishing');
    expect(content).toContain('published');
    expect(content).toContain('verified');
    expect(content).toContain('AI 仅作为内容生成与建议辅助');
  });

  it('keeps publication deployment and verification authority explicit', () => {
    const publication = read('src/views/publication/index.ejs');

    expect(publication).toContain('data-ui="publishing-center"');
    expect(publication).toContain('data-ui="publication-boundary"');
    expect(publication).toContain('DEPLOYED');
    expect(publication).toContain('VERIFIED');
    expect(publication).toContain('不代表外部生产环境部署');
  });

  it('keeps distribution source and manual-handoff boundaries explicit', () => {
    const distribution = read('src/views/distribution/index.ejs');

    expect(distribution).toContain('data-ui="distribution-center"');
    expect(distribution).toContain('data-ui="distribution-boundary"');
    expect(distribution).toContain('只有主站 VERIFIED 内容可以进入正常分发');
    expect(distribution).toContain('MANUAL_HANDOFF');
    expect(distribution).toContain('不会伪装成自动发布');
  });

  it('keeps competitor intelligence project-owned and does not fabricate third-party metrics', () => {
    const competitors = read('src/views/competitors/index.ejs');

    expect(competitors).toContain('data-ui="competitor-intelligence-center"');
    expect(competitors).toContain('data-ui="competitor-fact-boundary"');
    expect(competitors).toContain('仅展示数据库中已绑定当前项目的竞品');
    expect(competitors).toContain('不生成第三方搜索排名、流量或 P6 AI Visibility 数据');
  });

  it('separates factual report snapshots from advisory snapshots', () => {
    const reports = read('src/views/reports/index.ejs');

    expect(reports).toContain('data-ui="report-center"');
    expect(reports).toContain('data-ui="report-snapshot-boundary"');
    expect(reports).toContain('Fact Snapshot');
    expect(reports).toContain('Advisory Snapshot');
    expect(reports).toContain('报告只读取数据库快照');
  });

  it('ships a dedicated responsive UI-04 stylesheet through the shared layout', () => {
    const layout = read('src/views/layout.ejs');
    const css = read('src/public/css/p10-ui-04.css');

    expect(layout).toContain('/css/p10-ui-04.css');
    expect(css).toContain('.content-publishing-subnav');
    expect(css).toContain('.product-center');
    expect(css).toContain('.workflow-strip');
    expect(css).toContain('.snapshot-boundary-grid');
    expect(css).toContain('@media (max-width: 1023px)');
    expect(css).toContain('@media (max-width: 640px)');
  });
});
