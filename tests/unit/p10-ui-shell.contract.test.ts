import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

function compactCss(path: string) {
  return source(path).replace(/\s+/g, '').toLowerCase();
}

describe('P10 UI-01 shell design system contract', () => {
  it('defines the approved semantic token family', () => {
    const css = compactCss('src/public/css/p10.css');

    for (const token of [
      '--ui-bg:#f7f9fc',
      '--ui-surface:#ffffff',
      '--ui-surface-subtle:#fbfcfe',
      '--ui-border:#e8edf5',
      '--ui-border-strong:#d9e1ec',
      '--ui-text:#111827',
      '--ui-text-secondary:#667085',
      '--ui-text-tertiary:#98a2b3',
      '--ui-primary:#2563eb',
      '--ui-primary-soft:#eef4ff',
      '--ui-cyan:#06b6d4',
      '--ui-violet:#7c3aed',
      '--ui-success:#10b981',
      '--ui-warning:#f59e0b',
      '--ui-danger:#ef4444',
      '--ui-radius-card:16px',
      '--ui-radius-panel:20px',
    ]) {
      expect(css).toContain(token);
    }
  });

  it('provides keyboard focus and reduced-motion contracts', () => {
    const css = source('src/public/css/p10.css');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('keeps legacy component classes backed by semantic UI tokens', () => {
    const css = compactCss('src/public/css/app.css');
    expect(css).toContain('--bg:var(--ui-bg');
    expect(css).toContain('--surface:var(--ui-surface');
    expect(css).toContain('--accent:var(--ui-primary');
  });

  it('renders semantic shell landmarks and local icon infrastructure', () => {
    const layout = source('src/views/layout.ejs');
    expect(layout).toContain('class="skip-link"');
    expect(layout).toContain('href="#main-content"');
    expect(layout).toContain("include('partials/icon-sprite')");
    expect(layout).toContain('class="nav-backdrop"');
    expect(layout).toContain('data-ui="nav-backdrop"');
    expect(layout).toContain('aria-label="关闭导航"');
    expect(layout).toContain('id="main-content"');
  });

  it('uses the approved first-level information architecture without dead links', () => {
    const sidebar = source('src/views/partials/sidebar.ejs');
    for (const label of ['仪表盘','项目中心','SEO 中心','GEO / 可见度','AI 分析中心','内容与发布','竞品情报','报告中心','优化运营','成员与权限','设置']) {
      expect(sidebar).toContain(label);
    }
    expect(sidebar).toContain('id="primary-navigation"');
    expect(sidebar).toContain('aria-current="page"');
    // UI-05 is the approved unit that turns these formerly disabled IA placeholders into real routes.
    expect(sidebar).toContain("href: projectHref('/members')");
    expect(sidebar).toContain("href: projectHref('/settings')");
    expect(sidebar).not.toContain('disabled: true');
    expect(sidebar).not.toContain('href="#"');
  });

  it('keeps topbar controls truthful and non-deceptive', () => {
    const topbar = source('src/views/partials/topbar.ejs');
    expect(topbar).toContain('data-ui="nav-toggle"');
    expect(topbar).toContain('aria-controls="primary-navigation"');
    expect(topbar).toContain('切换项目');
    expect(topbar).toContain('已认证');
    expect(topbar).toContain('currentProjectId');
    expect(topbar).not.toContain('P10 · Identity &amp; RBAC');
    expect(topbar).not.toContain('aria-label="通知"');
    expect(topbar).not.toContain('class="avatar"');
  });

  it('provides progressive-enhancement drawer behavior', () => {
    const js = source('src/public/js/app.js');
    expect(js).toContain("querySelector('[data-ui=\"nav-toggle\"]')");
    expect(js).toContain("classList.toggle('nav-open'");
    expect(js).toContain("setAttribute('aria-expanded'");
    expect(js).toContain("event.key === 'Escape'");
    expect(js).toContain("matchMedia('(min-width: 1024px)')");
  });
});
