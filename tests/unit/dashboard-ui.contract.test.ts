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

  it('uses the approved product shell without dead navigation placeholders', () => {
    const layout = source('src/views/layout.ejs');
    const sidebar = source('src/views/partials/sidebar.ejs');
    const topbar = source('src/views/partials/topbar.ejs');

    expect(layout).toContain('data-ui="app-shell"');
    expect(layout).toContain('/assets/css/p10.css');
    expect(sidebar).not.toContain('href="#"');
    expect(topbar).toContain('data-ui="topbar"');
    expect(topbar).not.toContain('P10 · Identity &amp; RBAC');
    expect(topbar).not.toContain('P3');
  });

  it('uses the approved P10 product design tokens', () => {
    const css = source('src/public/css/p10.css').replace(/\s+/g, '').toLowerCase();

    expect(css).toContain('--ui-bg:#f7f9fc');
    expect(css).toContain('--ui-text:#111827');
    expect(css).toContain('--ui-primary:#2563eb');
    expect(css).toContain('.dashboard-command-grid');
  });
});
