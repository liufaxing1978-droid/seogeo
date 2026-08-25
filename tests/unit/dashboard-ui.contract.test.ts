import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('P10.5 dashboard UI contract', () => {
  it('exposes the approved dashboard information architecture', () => {
    const dashboard = source('src/views/dashboard.ejs');

    for (const marker of [
      'data-ui="dashboard-overview"',
      'data-ui="seo-score"',
      'data-ui="geo-visibility"',
      'data-ui="ai-tasks"',
      'data-ui="project-status"',
      'data-ui="task-center"',
      'data-ui="activity-feed"',
      'data-ui="quick-actions"',
    ]) {
      expect(dashboard).toContain(marker);
    }
  });

  it('uses the P10 product shell without dead navigation placeholders', () => {
    const layout = source('src/views/layout.ejs');
    const sidebar = source('src/views/partials/sidebar.ejs');
    const topbar = source('src/views/partials/topbar.ejs');

    expect(layout).toContain('data-ui="app-shell"');
    expect(sidebar).not.toContain('href="#"');
    expect(topbar).toContain('P10');
    expect(topbar).not.toContain('P3');
  });

  it('uses the approved warm neutral and gold design tokens', () => {
    const css = source('src/public/css/app.css').toLowerCase();

    expect(css).toContain('--bg:#fafaf7');
    expect(css).toContain('--text:#111111');
    expect(css).toContain('--gold:#b08d57');
    expect(css).toContain('.dashboard-command-grid');
  });
});
