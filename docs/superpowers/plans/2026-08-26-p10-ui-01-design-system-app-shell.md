# P10 UI-01 Design System + Application Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Productize the existing Express + EJS shell with one canonical design system, truthful first-level navigation, a non-deceptive top bar, accessible responsive navigation, and reusable visual primitives without changing P0-P10 business authority.

**Architecture:** Preserve `layout.ejs -> sidebar/topbar -> bodyTemplate`. Keep `app.css` as the structural/base layer and make `p10.css` the canonical P10 product-design layer using `--ui-*` tokens plus backward-compatible aliases. Add only small progressive-enhancement JavaScript for the sub-1024 px navigation drawer; no new frontend framework, data layer, schema, provider, or dependency.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Express 5, EJS 3, CSS custom properties/Grid/Flexbox, browser JavaScript, Vitest 3, Playwright 1.62, PostgreSQL 17, Redis 7.

**Spec:** `docs/superpowers/specs/2026-08-26-p10-ui-productization-design.md`

## Global Constraints

- UI-01 only. Stop before UI-02 and do not enter P11.
- Preserve Express + EJS; do not add React/Next/Vue/Tailwind/Bootstrap/icon packages/remote fonts.
- Do not change Prisma schema, API semantics, repositories/services, authentication, session, CSRF, membership/RBAC, feature gates, last-owner protection, P8 publication authority, or P9 automation authority.
- Never hard-code screenshot values, users, projects, status, activity, notifications, search results, quota, trends, ranks, or metrics.
- `UNKNOWN`, missing evidence, unsupported evidence, `NO_DATA`, and `NOT_ELIGIBLE` are never numeric zero.
- `res.locals.auth` currently exposes only `userId` and `sessionId`; UI-01 must not invent a human name, email, avatar, or initials. Show only a truthful authenticated-session state.
- Shared render locals guarantee `currentProjectId` only on project-scoped pages, not a full project list. UI-01 therefore renders current-project context plus a truthful `切换项目` link to `/projects`; a real multi-project selector is deferred until a persisted list is mapped in UI-02.
- No truthful global-search or notification feed is wired into the shell; omit those controls rather than rendering placeholders.
- `成员与权限` and `设置` remain visible first-level destinations but are disabled non-links with `aria-disabled="true"` until UI-05 adds dedicated pages.
- Project-scoped destinations preserve `currentProjectId`; without project context they go to `/projects`.
- Canonical tokens start with `--ui-bg:#f7f9fc`, `--ui-surface:#ffffff`, `--ui-border:#e8edf5`, `--ui-text:#111827`, `--ui-primary:#2563eb`.
- Font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif`.
- Breakpoints: `>=1440` full desktop, `1024-1439` compact desktop/tablet, `<1024` drawer navigation; no viewport overflow at 1440, 1024, or 820 px.
- Visible `:focus-visible`, `aria-current="page"`, accessible icon-only controls, no `href="#"`, and `prefers-reduced-motion` support are mandatory.
- Reference image `docs/ui/reference/02-dashboard.jpg` is visual-only authority.
- Execution must use an isolated worktree created with `superpowers:using-git-worktrees`.
- Recommended implementation branch: `feat/p10-ui-01-shell` from the exact approved documentation head. Until PR #163 is merged, target the stacked UI-01 PR at `docs/p10-ui-productization`; after #163 merges, retarget to `main` without rewriting business code.
- No production deployment.

---

## File Map

**Modify**
- `src/views/layout.ejs` — semantic shell, skip link, icon sprite include, backdrop, main landmark.
- `src/views/partials/sidebar.ejs` — 11-center IA, active-center mapping, project-scoped links, disabled future destinations.
- `src/views/partials/topbar.ejs` — title, mobile trigger, project context, authenticated-session state.
- `src/public/css/app.css` — structural/base rules and legacy token aliases.
- `src/public/css/p10.css` — canonical tokens, shell/primitives, responsive drawer, focus/reduced motion.
- `src/public/js/app.js` — drawer open/close only.
- `tests/unit/dashboard-ui.contract.test.ts` — update token expectation while retaining dashboard fact markers.
- `tests/e2e/p10-dashboard-screenshot.spec.ts` — retain deterministic screenshot and add shell markers.

**Create**
- `src/views/partials/icon-sprite.ejs`
- `tests/unit/p10-ui-shell.contract.test.ts`
- `tests/e2e/p10-shell.spec.ts`

**Do not touch**
- `prisma/schema.prisma`
- `src/app.ts`
- `src/auth/**`
- `src/modules/**` service/repository/API code
- `.github/workflows/ci.yml` under the default plan.

---

### Task 1: Canonical design tokens and primitive compatibility

**Files:**
- Create: `tests/unit/p10-ui-shell.contract.test.ts`
- Modify: `src/public/css/app.css`
- Modify: `src/public/css/p10.css`
- Modify: `tests/unit/dashboard-ui.contract.test.ts`

**Interfaces:**
- Consumes existing classes such as `.panel`, `.metric-card`, `.button`, `.btn`, `.badge`, `.tabs`, `.table-wrap`, `.empty-state`.
- Produces canonical `--ui-*` tokens plus legacy aliases (`--bg`, `--surface`, `--text`, `--muted`, `--border`, `--accent`, `--success`, `--warning`, `--danger`) so current pages remain stable.

- [ ] **Step 1: Write the RED token contract**

Create `tests/unit/p10-ui-shell.contract.test.ts`:

```ts
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
      '--ui-bg:#f7f9fc', '--ui-surface:#ffffff', '--ui-surface-subtle:#fbfcfe',
      '--ui-border:#e8edf5', '--ui-border-strong:#d9e1ec', '--ui-text:#111827',
      '--ui-text-secondary:#667085', '--ui-text-tertiary:#98a2b3',
      '--ui-primary:#2563eb', '--ui-primary-soft:#eef4ff', '--ui-cyan:#06b6d4',
      '--ui-violet:#7c3aed', '--ui-success:#10b981', '--ui-warning:#f59e0b',
      '--ui-danger:#ef4444', '--ui-radius-card:16px', '--ui-radius-panel:20px'
    ]) expect(css).toContain(token);
  });

  it('provides focus and reduced-motion contracts', () => {
    const css = source('src/public/css/p10.css');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('backs legacy variables with semantic UI tokens', () => {
    const css = compactCss('src/public/css/app.css');
    expect(css).toContain('--bg:var(--ui-bg');
    expect(css).toContain('--surface:var(--ui-surface');
    expect(css).toContain('--accent:var(--ui-primary');
  });
});
```

- [ ] **Step 2: Verify RED**

```bash
npm test -- tests/unit/p10-ui-shell.contract.test.ts
```

Expected: FAIL because current `p10.css` still uses warm-neutral/gold authority and no `--ui-*` family.

- [ ] **Step 3: Implement the canonical token block**

At the top of `src/public/css/p10.css`:

```css
:root {
  --ui-bg: #f7f9fc;
  --ui-surface: #ffffff;
  --ui-surface-subtle: #fbfcfe;
  --ui-surface-elevated: rgba(255, 255, 255, 0.92);
  --ui-border: #e8edf5;
  --ui-border-strong: #d9e1ec;
  --ui-text: #111827;
  --ui-text-secondary: #667085;
  --ui-text-tertiary: #98a2b3;
  --ui-primary: #2563eb;
  --ui-primary-soft: #eef4ff;
  --ui-cyan: #06b6d4;
  --ui-violet: #7c3aed;
  --ui-success: #10b981;
  --ui-warning: #f59e0b;
  --ui-danger: #ef4444;
  --ui-radius-xs: 8px;
  --ui-radius-control: 10px;
  --ui-radius-card: 16px;
  --ui-radius-panel: 20px;
  --ui-shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.04);
  --ui-shadow-card: 0 10px 30px rgba(16, 24, 40, 0.05);
  --ui-sidebar-width: 248px;
  --ui-topbar-height: 72px;
  --ui-transition-fast: 160ms ease;
}
```

At the top of `src/public/css/app.css`, replace visual authority with aliases:

```css
:root {
  --sidebar: var(--ui-sidebar-width, 248px);
  --bg: var(--ui-bg, #f7f9fc);
  --surface: var(--ui-surface, #ffffff);
  --text: var(--ui-text, #111827);
  --muted: var(--ui-text-secondary, #667085);
  --border: var(--ui-border, #e8edf5);
  --accent: var(--ui-primary, #2563eb);
  --success: var(--ui-success, #10b981);
  --warning: var(--ui-warning, #f59e0b);
  --danger: var(--ui-danger, #ef4444);
  --shadow: var(--ui-shadow-card, 0 10px 30px rgba(16, 24, 40, 0.05));
}
```

Normalize the body font stack to the approved system stack. In `p10.css` add:

```css
:where(a, button, input, select, textarea, [tabindex]):focus-visible {
  outline: 3px solid rgba(37, 99, 235, 0.24);
  outline-offset: 2px;
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    scroll-behavior: auto !important;
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

Restyle existing primitive selectors from semantic tokens; keep class names unchanged.

- [ ] **Step 4: Update the old dashboard token assertion**

Replace the warm-gold assertion in `tests/unit/dashboard-ui.contract.test.ts` with:

```ts
it('uses the approved P10 product design tokens', () => {
  const css = source('src/public/css/p10.css').replace(/\s+/g, '').toLowerCase();
  expect(css).toContain('--ui-bg:#f7f9fc');
  expect(css).toContain('--ui-text:#111827');
  expect(css).toContain('--ui-primary:#2563eb');
  expect(css).toContain('.dashboard-command-grid');
});
```

- [ ] **Step 5: Verify GREEN**

```bash
npm test -- tests/unit/p10-ui-shell.contract.test.ts tests/unit/dashboard-ui.contract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/public/css/app.css src/public/css/p10.css tests/unit/p10-ui-shell.contract.test.ts tests/unit/dashboard-ui.contract.test.ts
git commit -m "feat(ui): establish P10 shell design tokens"
```

---

### Task 2: Semantic shared layout and local icon sprite

**Files:**
- Create: `src/views/partials/icon-sprite.ejs`
- Modify: `src/views/layout.ejs`
- Modify: `src/public/css/p10.css`
- Modify: `tests/unit/p10-ui-shell.contract.test.ts`

**Interfaces:**
- Consumes existing `title`, `activeNav`, `currentProjectId`, `bodyTemplate`, optional `pageScripts`, inherited `auth` local.
- Produces `#main-content`, `[data-ui="nav-backdrop"]`, skip link, local SVG symbols. The mobile trigger is deliberately produced later by Task 4 in `topbar.ejs`.

- [ ] **Step 1: Add RED layout assertions**

Append:

```ts
it('renders semantic shell landmarks and local icon infrastructure', () => {
  const layout = source('src/views/layout.ejs');
  expect(layout).toContain('class="skip-link"');
  expect(layout).toContain('href="#main-content"');
  expect(layout).toContain("include('partials/icon-sprite')");
  expect(layout).toContain('data-ui="nav-backdrop"');
  expect(layout).toContain('id="main-content"');
});
```

- [ ] **Step 2: Verify RED**

```bash
npm test -- tests/unit/p10-ui-shell.contract.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Create the local SVG sprite**

Create `src/views/partials/icon-sprite.ejs` with a hidden `<svg>` containing these exact symbol IDs:

```text
icon-dashboard
icon-projects
icon-seo
icon-geo
icon-ai
icon-content
icon-competitors
icon-reports
icon-optimization
icon-members
icon-settings
icon-menu
icon-close
icon-user
icon-switch
```

Each symbol must use a `viewBox="0 0 24 24"` and local `<path>`/`<circle>` geometry only; no external `<image>`, `<use>` URL, font icon, script, or network dependency. The consuming contract is always:

```ejs
<svg class="ui-icon" aria-hidden="true"><use href="#icon-dashboard"></use></svg>
```

Add:

```css
.ui-icon-sprite { position: absolute; width: 0; height: 0; overflow: hidden; }
.ui-icon { width: 18px; height: 18px; fill: currentColor; flex: 0 0 auto; }
```

- [ ] **Step 4: Upgrade `layout.ejs` without changing the render flow**

Use this body structure:

```ejs
<body>
  <a class="skip-link" href="#main-content">跳到主要内容</a>
  <%- include('partials/icon-sprite') %>
  <div class="app-shell" data-ui="app-shell">
    <%- include('partials/sidebar', { activeNav, currentProjectId }) %>
    <button class="nav-backdrop" type="button" data-ui="nav-backdrop" aria-label="关闭导航" tabindex="-1"></button>
    <div class="workspace">
      <%- include('partials/topbar', { title, currentProjectId }) %>
      <main class="workspace-main" id="main-content" tabindex="-1">
        <%- include(bodyTemplate) %>
      </main>
    </div>
  </div>
  <script src="/assets/js/app.js" defer></script>
  <% if (typeof pageScripts !== 'undefined') { %>
    <% for (const src of pageScripts) { %><script src="<%= src %>" defer></script><% } %>
  <% } %>
</body>
```

Add skip/backdrop base styles:

```css
.skip-link { position: fixed; left: 16px; top: 12px; z-index: 1000; transform: translateY(-160%); background: var(--ui-text); color: #fff; border-radius: var(--ui-radius-control); padding: 10px 14px; transition: transform var(--ui-transition-fast); }
.skip-link:focus { transform: translateY(0); }
.nav-backdrop { display: none; }
```

- [ ] **Step 5: Verify GREEN**

```bash
npm test -- tests/unit/p10-ui-shell.contract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/views/layout.ejs src/views/partials/icon-sprite.ejs src/public/css/p10.css tests/unit/p10-ui-shell.contract.test.ts
git commit -m "feat(ui): add semantic application shell"
```

---

### Task 3: Consolidated first-level navigation

**Files:**
- Modify: `src/views/partials/sidebar.ejs`
- Modify: `src/public/css/p10.css`
- Modify: `tests/unit/p10-ui-shell.contract.test.ts`

**Interfaces:**
- Consumes `activeNav` and optional `currentProjectId`.
- Produces `#primary-navigation`, 11 center labels, `aria-current="page"`, project-preserving URLs, disabled Members/Settings rows.

- [ ] **Step 1: Add RED navigation assertions**

```ts
it('uses the approved first-level information architecture without dead links', () => {
  const sidebar = source('src/views/partials/sidebar.ejs');
  for (const label of ['仪表盘','项目中心','SEO 中心','GEO / 可见度','AI 分析中心','内容与发布','竞品情报','报告中心','优化运营','成员与权限','设置']) {
    expect(sidebar).toContain(label);
  }
  expect(sidebar).toContain('id="primary-navigation"');
  expect(sidebar).toContain('aria-current="page"');
  expect(sidebar).toContain('aria-disabled="true"');
  expect(sidebar).not.toContain('href="#"');
});
```

- [ ] **Step 2: Verify RED**

```bash
npm test -- tests/unit/p10-ui-shell.contract.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Replace implementation-level groups with center navigation**

At the top of `sidebar.ejs`:

```ejs
<%
  const projectId = typeof currentProjectId === 'string' && currentProjectId ? currentProjectId : null;
  const projectHref = (suffix) => projectId ? `/projects/${projectId}${suffix}` : '/projects';
  const centerByActiveNav = {
    overview: 'dashboard',
    projects: 'projects', pages: 'projects', crawls: 'projects',
    seo: 'seo',
    geo: 'geo', visibility: 'geo', 'visibility-history': 'geo', 'visibility-alerts': 'geo',
    'visibility-prompts': 'geo', 'visibility-citations': 'geo', 'visibility-subjects': 'geo', 'visibility-metrics': 'geo',
    ai: 'ai',
    content: 'content', publication: 'content', distribution: 'content',
    competitors: 'competitors', reports: 'reports',
    'search-console': 'optimization', growth: 'optimization', 'growth-topics': 'optimization',
    'growth-cannibalization': 'optimization', 'growth-new-content': 'optimization',
    'optimization-operations': 'optimization', 'optimization-experiments': 'optimization'
  };
  const activeCenter = centerByActiveNav[activeNav] || '';
  const items = [
    { key: 'dashboard', label: '仪表盘', icon: 'dashboard', href: '/' },
    { key: 'projects', label: '项目中心', icon: 'projects', href: '/projects' },
    { key: 'seo', label: 'SEO 中心', icon: 'seo', href: projectHref('/seo') },
    { key: 'geo', label: 'GEO / 可见度', icon: 'geo', href: projectHref('/geo') },
    { key: 'ai', label: 'AI 分析中心', icon: 'ai', href: projectHref('/ai') },
    { key: 'content', label: '内容与发布', icon: 'content', href: projectHref('/content') },
    { key: 'competitors', label: '竞品情报', icon: 'competitors', href: projectHref('/competitors') },
    { key: 'reports', label: '报告中心', icon: 'reports', href: projectHref('/reports') },
    { key: 'optimization', label: '优化运营', icon: 'optimization', href: projectHref('/optimization') },
    { key: 'members', label: '成员与权限', icon: 'members', disabled: true },
    { key: 'settings', label: '设置', icon: 'settings', disabled: true }
  ];
%>
```

Render active links as anchors and disabled future destinations as spans:

```ejs
<aside class="sidebar" id="primary-navigation" data-ui="sidebar" aria-label="主导航">
  <div class="sidebar-header">
    <a class="brand" href="/" aria-label="SEO GEO 首页"><span class="brand-mark">SG</span><span class="brand-copy">SEO GEO</span></a>
    <button class="sidebar-close" type="button" data-ui="nav-close" aria-label="关闭导航"><svg class="ui-icon" aria-hidden="true"><use href="#icon-close"></use></svg></button>
  </div>
  <nav class="primary-nav">
    <% for (const item of items) { %>
      <% if (item.disabled) { %>
        <span class="nav-item is-disabled" aria-disabled="true" title="将在对应 UI 单元启用"><svg class="ui-icon" aria-hidden="true"><use href="#icon-<%= item.icon %>"></use></svg><span><%= item.label %></span></span>
      <% } else { %>
        <a class="nav-item <%= activeCenter === item.key ? 'active' : '' %>" href="<%= item.href %>" <%- activeCenter === item.key ? 'aria-current="page"' : '' %>><svg class="ui-icon" aria-hidden="true"><use href="#icon-<%= item.icon %>"></use></svg><span><%= item.label %></span></a>
      <% } %>
    <% } %>
  </nav>
</aside>
```

- [ ] **Step 4: Apply the approved light sidebar treatment**

```css
.sidebar { width: var(--ui-sidebar-width); background: var(--ui-surface); border-right: 1px solid var(--ui-border); color: var(--ui-text); padding: 18px 14px; }
.sidebar-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.brand { display: flex; align-items: center; gap: 10px; color: var(--ui-text); margin: 0; }
.brand-mark { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 10px; background: var(--ui-primary); color: #fff; font-weight: 750; }
.brand-copy { font-size: 16px; font-weight: 750; }
.primary-nav { display: grid; gap: 4px; margin-top: 24px; }
.nav-item { min-height: 42px; display: flex; align-items: center; gap: 11px; border-radius: 11px; padding: 0 12px; color: var(--ui-text-secondary); font-size: 14px; font-weight: 600; transition: background var(--ui-transition-fast), color var(--ui-transition-fast); }
.nav-item:hover { background: var(--ui-surface-subtle); color: var(--ui-text); }
.nav-item.active { background: var(--ui-primary-soft); color: var(--ui-primary); }
.nav-item.is-disabled { color: var(--ui-text-tertiary); cursor: not-allowed; }
.sidebar-close { display: none; }
```

Override/remove the previous dark gradient, gold inset active state, and first-level premium badges. Do not delete any route.

- [ ] **Step 5: Verify GREEN**

```bash
npm test -- tests/unit/p10-ui-shell.contract.test.ts tests/unit/dashboard-ui.contract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/views/partials/sidebar.ejs src/public/css/p10.css tests/unit/p10-ui-shell.contract.test.ts
git commit -m "feat(ui): consolidate primary navigation centers"
```

---

### Task 4: Truthful top bar and mobile trigger

**Files:**
- Modify: `src/views/partials/topbar.ejs`
- Modify: `src/public/css/p10.css`
- Modify: `tests/unit/p10-ui-shell.contract.test.ts`

**Interfaces:**
- Consumes `title`, optional `currentProjectId`, inherited `auth`.
- Produces `[data-ui="nav-toggle"]`, page title, project-context/switch controls, authenticated-session chip; no fake search or notification control.

- [ ] **Step 1: Add RED topbar assertions**

```ts
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
```

- [ ] **Step 2: Verify RED**

```bash
npm test -- tests/unit/p10-ui-shell.contract.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Replace `topbar.ejs`**

```ejs
<header class="topbar" data-ui="topbar">
  <div class="topbar-leading">
    <button class="nav-toggle" type="button" data-ui="nav-toggle" aria-label="打开导航" aria-controls="primary-navigation" aria-expanded="false"><svg class="ui-icon" aria-hidden="true"><use href="#icon-menu"></use></svg></button>
    <div class="topbar-title"><p class="eyebrow">SEO GEO Intelligence Platform</p><h1><%= title %></h1></div>
  </div>
  <div class="topbar-actions">
    <% if (typeof currentProjectId === 'string' && currentProjectId) { %>
      <a class="project-context-link" href="/projects/<%= currentProjectId %>">当前项目</a>
      <a class="project-switch-link" href="/projects"><svg class="ui-icon" aria-hidden="true"><use href="#icon-switch"></use></svg><span>切换项目</span></a>
    <% } %>
    <% if (typeof auth !== 'undefined' && auth) { %>
      <span class="auth-chip" data-ui="auth-session" aria-label="已认证用户会话"><svg class="ui-icon" aria-hidden="true"><use href="#icon-user"></use></svg><span>已认证</span></span>
    <% } %>
  </div>
</header>
```

Do not display `auth.userId` as a human name and do not infer initials from it.

- [ ] **Step 4: Apply light stable topbar styles**

```css
.topbar { min-height: var(--ui-topbar-height); height: auto; background: var(--ui-surface-elevated); backdrop-filter: blur(16px); border-bottom: 1px solid var(--ui-border); padding: 12px 28px; }
.topbar-leading, .topbar-actions { display: flex; align-items: center; gap: 12px; }
.topbar-title h1 { margin: 1px 0 0; font-size: 18px; line-height: 1.3; color: var(--ui-text); }
.eyebrow { margin: 0; color: var(--ui-text-tertiary); font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
.project-context-link, .project-switch-link, .auth-chip { min-height: 36px; display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-control); padding: 0 10px; background: var(--ui-surface); color: var(--ui-text-secondary); font-size: 12px; font-weight: 650; }
.project-switch-link:hover { border-color: var(--ui-border-strong); color: var(--ui-primary); }
.auth-chip { background: var(--ui-surface-subtle); }
.nav-toggle { display: none; }
```

- [ ] **Step 5: Verify GREEN**

```bash
npm test -- tests/unit/p10-ui-shell.contract.test.ts tests/unit/dashboard-ui.contract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/views/partials/topbar.ejs src/public/css/p10.css tests/unit/p10-ui-shell.contract.test.ts
git commit -m "feat(ui): make shell context truthful"
```

---

### Task 5: Responsive navigation drawer below 1024 px

**Files:**
- Modify: `src/public/js/app.js`
- Modify: `src/public/css/p10.css`
- Modify: `tests/unit/p10-ui-shell.contract.test.ts`

**Interfaces:**
- Consumes `[data-ui="app-shell"]`, `[data-ui="nav-toggle"]`, `[data-ui="nav-close"]`, `[data-ui="nav-backdrop"]`, `#primary-navigation`.
- Produces `.nav-open`, synchronized `aria-expanded`, Escape/backdrop/close dismissal, focus restoration, desktop reset.

- [ ] **Step 1: Add RED drawer assertions**

```ts
it('provides progressive-enhancement drawer behavior', () => {
  const js = source('src/public/js/app.js');
  expect(js).toContain("querySelector('[data-ui=\"nav-toggle\"]')");
  expect(js).toContain("classList.toggle('nav-open'");
  expect(js).toContain("setAttribute('aria-expanded'");
  expect(js).toContain("event.key === 'Escape'");
  expect(js).toContain("matchMedia('(min-width: 1024px)')");
});
```

- [ ] **Step 2: Verify RED**

```bash
npm test -- tests/unit/p10-ui-shell.contract.test.ts
```

Expected: FAIL because current `app.js` only adds the `js` class.

- [ ] **Step 3: Implement drawer controller**

Replace `src/public/js/app.js` with:

```js
document.documentElement.classList.add('js');

const shell = document.querySelector('[data-ui="app-shell"]');
const sidebar = document.querySelector('#primary-navigation');
const toggle = document.querySelector('[data-ui="nav-toggle"]');
const closeButton = document.querySelector('[data-ui="nav-close"]');
const backdrop = document.querySelector('[data-ui="nav-backdrop"]');
const desktop = window.matchMedia('(min-width: 1024px)');
let restoreFocus = null;

function setNavigationOpen(open) {
  if (!shell || !toggle || !sidebar) return;
  shell.classList.toggle('nav-open', open);
  toggle.setAttribute('aria-expanded', String(open));
  document.body.classList.toggle('nav-locked', open);
  if (open) {
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : toggle;
    closeButton?.focus();
  } else if (restoreFocus instanceof HTMLElement) {
    restoreFocus.focus();
    restoreFocus = null;
  }
}

toggle?.addEventListener('click', () => setNavigationOpen(true));
closeButton?.addEventListener('click', () => setNavigationOpen(false));
backdrop?.addEventListener('click', () => setNavigationOpen(false));

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && shell?.classList.contains('nav-open')) setNavigationOpen(false);
});

desktop.addEventListener('change', (event) => {
  if (event.matches) setNavigationOpen(false);
});
```

- [ ] **Step 4: Add the drawer CSS and explicitly override the old hidden-sidebar rule**

```css
body.nav-locked { overflow: hidden; }

@media (max-width: 1023px) {
  .workspace { margin-left: 0; width: 100%; }
  .sidebar {
    display: block;
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 40;
    transform: translateX(-104%);
    transition: transform var(--ui-transition-fast);
    box-shadow: 18px 0 44px rgba(16, 24, 40, 0.12);
  }
  .app-shell.nav-open .sidebar { transform: translateX(0); }
  .sidebar-close { display: inline-grid; place-items: center; width: 36px; height: 36px; border: 0; border-radius: var(--ui-radius-control); background: var(--ui-surface-subtle); color: var(--ui-text-secondary); }
  .nav-toggle { display: inline-grid; place-items: center; width: 38px; height: 38px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-control); background: var(--ui-surface); color: var(--ui-text); }
  .nav-backdrop { position: fixed; inset: 0; z-index: 30; border: 0; background: rgba(15, 23, 42, 0.28); opacity: 0; pointer-events: none; display: block; transition: opacity var(--ui-transition-fast); }
  .app-shell.nav-open .nav-backdrop { opacity: 1; pointer-events: auto; }
}
```

The explicit `display:block` is required because legacy `app.css` currently hides `.sidebar` below 720 px. Keep table horizontal scroll and stacked content rules.

- [ ] **Step 5: Verify GREEN**

```bash
npm test -- tests/unit/p10-ui-shell.contract.test.ts tests/unit/dashboard-ui.contract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/public/js/app.js src/public/css/p10.css tests/unit/p10-ui-shell.contract.test.ts
git commit -m "feat(ui): add responsive navigation drawer"
```

---

### Task 6: Browser acceptance for desktop context and mobile navigation

**Files:**
- Create: `tests/e2e/p10-shell.spec.ts`
- Modify: `tests/e2e/p10-dashboard-screenshot.spec.ts`

**Interfaces:**
- Consumes `authenticateE2e`, existing routes, shell `data-ui` markers.
- Produces deterministic desktop/mobile acceptance and retained `p10-dashboard.png`.

- [ ] **Step 1: Add desktop/project-context E2E**

Create `tests/e2e/p10-shell.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { authenticateE2e } from './e2e-auth.js';

test('renders the UI-01 shell with truthful project context', async ({ page, context }) => {
  const auth = await authenticateE2e(context, { role: 'OWNER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
  try {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`/projects/${auth.project.id}`);
    await expect(page.locator('[data-ui="sidebar"]')).toBeVisible();
    await expect(page.locator('[data-ui="topbar"]')).toBeVisible();
    await expect(page.locator('[data-ui="auth-session"]')).toContainText('已认证');
    await expect(page.getByRole('link', { name: '项目中心', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: 'SEO 中心', exact: true })).toHaveAttribute('href', `/projects/${auth.project.id}/seo`);
    await expect(page.getByRole('link', { name: 'GEO / 可见度', exact: true })).toHaveAttribute('href', `/projects/${auth.project.id}/geo`);
    await expect(page.getByRole('link', { name: '切换项目', exact: true })).toHaveAttribute('href', '/projects');
    await expect(page.getByLabel('通知')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('P10 · Identity & RBAC');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally { await auth.cleanup(); }
});
```

- [ ] **Step 2: Add mobile drawer E2E**

Append:

```ts
test('opens and closes primary navigation below 1024px', async ({ page, context }) => {
  const auth = await authenticateE2e(context, { role: 'OWNER', planLevel: 'ENTERPRISE', userStatus: 'ACTIVE', membershipStatus: 'ACTIVE' });
  try {
    await page.setViewportSize({ width: 820, height: 1000 });
    await page.goto(`/projects/${auth.project.id}`);
    const toggle = page.locator('[data-ui="nav-toggle"]');
    const sidebar = page.locator('[data-ui="sidebar"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebar).not.toBeInViewport();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebar).toBeInViewport();
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebar).not.toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  } finally { await auth.cleanup(); }
});
```

- [ ] **Step 3: Run the new E2E**

```bash
npm run test:e2e -- tests/e2e/p10-shell.spec.ts
```

Expected after Tasks 1-5: PASS. Fix shell code only if this fails.

- [ ] **Step 4: Strengthen the existing screenshot test**

Keep all existing fact markers and the `p10-dashboard.png` output. Add:

```ts
await expect(page.locator('[data-ui="sidebar"]')).toBeVisible();
await expect(page.locator('[data-ui="topbar"]')).toBeVisible();
await expect(page.getByRole('link', { name: '仪表盘', exact: true })).toHaveAttribute('aria-current', 'page');
```

Do not seed visual-only metrics.

- [ ] **Step 5: Run shell + screenshot E2E**

```bash
npm run test:e2e -- tests/e2e/p10-shell.spec.ts tests/e2e/p10-dashboard-screenshot.spec.ts
```

Expected: PASS and `p10-dashboard.png` generated.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/p10-shell.spec.ts tests/e2e/p10-dashboard-screenshot.spec.ts
git commit -m "test(ui): cover P10 application shell"
```

---

### Task 7: Visual acceptance, regression, and exact-head CI

**Files:**
- Modify only the shell/test files named above if acceptance exposes a shell defect.
- Do not add UI-02 page work.

**Interfaces:**
- Consumes final UI-01 head, `docs/ui/reference/02-dashboard.jpg` when locally available, existing CI.
- Produces reviewed `p10-dashboard.png`, green local verification, exact-head `verify`, `production-audit`, `e2e` evidence.

- [ ] **Step 1: Verify the reference image before comparison**

Ensure `docs/ui/reference/02-dashboard.jpg` is present in the worktree. If it came from the separately supplied Codex package rather than Git, verify its SHA-256 against `docs/ui/reference/SHA256SUMS.txt`. Do not substitute another image.

- [ ] **Step 2: Run focused contracts**

```bash
npm test -- tests/unit/p10-ui-shell.contract.test.ts tests/unit/dashboard-ui.contract.test.ts
```

Expected: PASS.

- [ ] **Step 3: Typecheck and build**

```bash
npm run typecheck
npm run build
```

Expected: both exit 0.

- [ ] **Step 4: Full Vitest regression**

```bash
npm test
```

Expected: all unit/integration tests pass.

- [ ] **Step 5: Full Playwright regression**

```bash
npm run test:e2e
```

Expected: all browser tests pass and `p10-dashboard.png` is created.

- [ ] **Step 6: Compare screenshot against `02-dashboard.jpg`**

Review exactly these points:

```text
light sidebar proportion
blue active-center treatment
topbar height/density
content gutters
system-font hierarchy
surface border/radius/shadow restraint
no dark/gold legacy shell residue
no fake search/notification/human identity
no clipped nav at 1440px
no horizontal viewport overflow
truthful dashboard empty/unknown states retained
```

If truth/accessibility conflicts with the reference, keep truthful behavior and document the difference.

- [ ] **Step 7: Push and require exact-head GitHub Actions**

Require these jobs on the exact pushed commit SHA:

```text
verify
production-audit
e2e
```

`verify` must include Prisma validate/generate/migrate, Typecheck, full Vitest, Build. `e2e` must run the browser suite and upload the existing `p10-dashboard-screenshot` artifact. Do not reuse earlier CI evidence.

- [ ] **Step 8: Inspect the exact-head screenshot artifact**

Download `p10-dashboard-screenshot` from the exact-head `e2e` run and confirm it matches local acceptance and contains no fabricated domain data.

- [ ] **Step 9: Commit a shell-only acceptance fix only if necessary**

If visual acceptance requires a fix, rerun focused tests and commit:

```bash
git add src/views/layout.ejs src/views/partials/sidebar.ejs src/views/partials/topbar.ejs src/views/partials/icon-sprite.ejs src/public/css/app.css src/public/css/p10.css src/public/js/app.js tests/unit/p10-ui-shell.contract.test.ts tests/unit/dashboard-ui.contract.test.ts tests/e2e/p10-shell.spec.ts tests/e2e/p10-dashboard-screenshot.spec.ts
git commit -m "fix(ui): finish P10 shell acceptance"
```

No empty commit if no fix is needed.

- [ ] **Step 10: Stop at UI-01**

UI-01 is complete only after exact-head `verify`, `production-audit`, and `e2e` are green and the exact-head screenshot is accepted. Do not start Login/Dashboard/Project Center redesign or any later UI unit automatically.

---

## Self-Review Record

**Spec coverage:** Task 1 covers tokens/primitives; Task 2 semantic layout/local icons; Task 3 consolidated IA/project scoping; Task 4 truthful topbar; Task 5 responsive drawer; Task 6 browser acceptance; Task 7 screenshot/full regression/exact-head CI.

**Deliberate deferrals:** real multi-project selector -> UI-02; global search -> omitted until a truthful capability exists; notifications -> omitted until a persisted feed exists; human-readable account identity -> deferred until a persisted user source is mapped; dedicated Members/Permissions and Settings routes -> UI-05.

**Placeholder scan:** no implementation `TBD`, no implementation `TODO`, no fake metrics, no unavailable source treated as real.

**Consistency fixes applied during plan review:** Task 2 no longer requires the topbar menu trigger before Task 4 creates it; Task 5 explicitly sets mobile `.sidebar { display:block; }` so the legacy sub-720px `display:none` rule cannot break the drawer.

---

## Execution Handoff

Plan saved at `docs/superpowers/plans/2026-08-26-p10-ui-01-design-system-app-shell.md`.

Recommended mode: **Subagent-Driven** with `superpowers:subagent-driven-development`, fresh agent per task, review between tasks. Inline execution may instead use `superpowers:executing-plans` with the same gates.

Before production-code edits, load `superpowers:using-git-worktrees`, create an isolated worktree for `feat/p10-ui-01-shell`, verify it starts from the exact approved documentation head, and begin Task 1 only.
