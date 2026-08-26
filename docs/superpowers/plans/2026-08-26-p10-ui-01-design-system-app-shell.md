# P10 UI-01 Design System + Application Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Productize the existing Express + EJS application shell with one canonical design-token system, truthful first-level navigation, a non-deceptive authenticated top bar, accessible responsive navigation, and reusable visual primitives without changing P0-P10 business authority.

**Architecture:** Keep the current server-rendered `layout.ejs -> sidebar/topbar -> bodyTemplate` architecture. Normalize `app.css` as the structural/base layer and `p10.css` as the canonical P10 product design layer, using shared `--ui-*` semantic tokens and backward-compatible aliases so existing pages continue to render. Add only small progressive-enhancement JavaScript for the sub-1024 px navigation drawer; do not introduce a client framework, new data-fetching layer, new domain model, or new application dependency.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Express 5, EJS 3, CSS custom properties/Grid/Flexbox, browser JavaScript, Vitest 3, Playwright 1.62, PostgreSQL 17, Redis 7.

**Spec:** `docs/superpowers/specs/2026-08-26-p10-ui-productization-design.md`

## Global Constraints

- Scope is UI-01 only: shared design system + application shell. Do not start UI-02 or later units.
- Preserve Express + EJS. Do not add React, Next.js, Vue, a SPA router, Tailwind, Bootstrap, an icon package, chart package, or remote font dependency.
- Do not change Prisma schema, API semantics, repositories/services, authentication, session handling, CSRF, project membership, RBAC, plan/feature gates, last-owner protection, provider authority, P8 publication authority, or P9 automation authority.
- Never hard-code screenshot metrics, projects, users, statuses, activity, trends, search results, notifications, quota, or ranking values.
- `UNKNOWN`, missing evidence, unsupported evidence, `NO_DATA`, and `NOT_ELIGIBLE` are never converted to numeric zero.
- Current `res.locals.auth` exposes only authenticated `userId` and `sessionId`; UI-01 must not invent a user name, email, profile image, or initials. Show only a truthful authenticated-session state. A richer identity surface may be added later only from an existing persisted source.
- Current shared render locals expose `currentProjectId` but do not guarantee a list of projects on every route. UI-01 therefore implements a truthful project-context link plus `切换项目` link to `/projects`, not a synthetic project dropdown. UI-02 may replace it with a real selector after mapping the persisted project list.
- There is no truthful global-search or notification feed wired into the current shell. UI-01 omits those controls rather than rendering deceptive placeholders.
- `成员与权限` and `设置` are first-level information-architecture destinations but do not yet have dedicated P10 productized web routes. Render them as visibly disabled, non-link navigation rows with `aria-disabled="true"`; UI-05 owns dedicated pages.
- Project-scoped destinations preserve `currentProjectId`; when no project is selected, their links go to `/projects` rather than inventing project context.
- Use the approved semantic token family beginning with `--ui-bg:#f7f9fc`, `--ui-surface:#ffffff`, `--ui-border:#e8edf5`, `--ui-text:#111827`, and `--ui-primary:#2563eb`.
- Use only the system font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif`.
- Breakpoints: `>=1440` full desktop, `1024-1439` compact desktop/tablet, `<1024` drawer navigation. The page must have no horizontal viewport overflow at 1440, 1024, or 820 px.
- Navigation must be keyboard reachable, have visible `:focus-visible` treatment, use `aria-current="page"` for the active center, and never use `href="#"` placeholders.
- Respect `prefers-reduced-motion`.
- Reference image `docs/ui/reference/02-dashboard.jpg` controls shell visual character only. Business truth always wins over pixel mimicry.
- Execution must happen in an isolated worktree created with the `superpowers:using-git-worktrees` skill.
- Recommended implementation branch: `feat/p10-ui-01-shell`, created from the exact approved documentation head. Until documentation PR #163 is merged, use `docs/p10-ui-productization` as the stacked PR base; after #163 merges, retarget the UI-01 PR to `main` without rewriting application semantics.
- No production deployment is part of UI-01.

---

## File Structure

### Files to modify

- `src/views/layout.ejs` — semantic shell, skip link, icon sprite include, mobile navigation trigger/backdrop, main landmark.
- `src/views/partials/sidebar.ejs` — consolidated 11-center information architecture, active-center mapping, truthful project-scoped links, disabled future destinations.
- `src/views/partials/topbar.ejs` — page title, project context/switch control, authenticated-session state; remove fake notification/static phase chrome.
- `src/public/css/app.css` — keep structural/base rules and compatibility aliases; eliminate dependence on the old blue/dark token definitions as design authority.
- `src/public/css/p10.css` — canonical `--ui-*` tokens, shell styling, reusable visual primitives, responsive drawer rules, focus/reduced-motion rules.
- `src/public/js/app.js` — progressive-enhancement drawer behavior only.
- `tests/unit/dashboard-ui.contract.test.ts` — preserve P10.5 dashboard contract while updating shell expectations from the previous warm-gold shell to the approved P10 product shell.
- `tests/e2e/p10-dashboard-screenshot.spec.ts` — retain deterministic dashboard screenshot and add shell acceptance markers.

### Files to create

- `src/views/partials/icon-sprite.ejs` — local inline SVG symbol sprite; no external network or icon dependency.
- `tests/unit/p10-ui-shell.contract.test.ts` — source-level shell/design-system contract.
- `tests/e2e/p10-shell.spec.ts` — desktop/project-context/mobile-drawer acceptance tests.

### Files explicitly not touched

- `prisma/schema.prisma`
- `src/app.ts`
- `src/auth/**`
- `src/modules/**` service/repository/API code
- `.github/workflows/ci.yml` unless exact-head CI later demonstrates an existing screenshot upload path cannot collect the already-produced `p10-dashboard.png` artifact; the default plan requires no CI workflow change.

---

### Task 1: Establish canonical design tokens and primitive contracts

**Files:**
- Create: `tests/unit/p10-ui-shell.contract.test.ts`
- Modify: `src/public/css/app.css`
- Modify: `src/public/css/p10.css`

**Interfaces:**
- Consumes: existing class names used across current EJS pages (`.panel`, `.metric-card`, `.button`, `.btn`, `.badge`, `.tabs`, `.table-wrap`, `.empty-state`).
- Produces: canonical `--ui-*` variables plus legacy aliases (`--bg`, `--surface`, `--text`, `--muted`, `--border`, `--accent`, `--success`, `--warning`, `--danger`) resolved from those tokens so existing views keep working while later UI units migrate incrementally.

- [ ] **Step 1: Write the failing shell/design-system token contract**

Create `tests/unit/p10-ui-shell.contract.test.ts` with this initial content:

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
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm test -- tests/unit/p10-ui-shell.contract.test.ts
```

Expected: FAIL because the current P10 stylesheet still defines the warm-neutral/gold token set and has no canonical `--ui-*` token family.

- [ ] **Step 3: Replace design authority with the approved token block**

At the start of `src/public/css/p10.css`, use this exact token block:

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

In `src/public/css/app.css`, make the existing variables compatibility aliases rather than a second visual theme:

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

Also normalize the `body` font stack to:

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
  "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif;
```

Add reusable focus/motion rules in `p10.css`:

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

Keep existing primitive selectors working, but restyle their colors/radii/shadows from semantic tokens rather than gold literals.

- [ ] **Step 4: Run focused contract tests and verify GREEN**

Run:

```bash
npm test -- tests/unit/p10-ui-shell.contract.test.ts tests/unit/dashboard-ui.contract.test.ts
```

Expected: the new shell contract passes; the existing dashboard contract may still fail on its old warm-gold assertions. Do not weaken the new contract. Update the old contract in the next step.

- [ ] **Step 5: Update the P10.5 dashboard token assertion to the approved UI-01 system**

Replace the old warm-gold test in `tests/unit/dashboard-ui.contract.test.ts` with:

```ts
it('uses the approved P10 product design tokens', () => {
  const css = source('src/public/css/p10.css').replace(/\s+/g, '').toLowerCase();

  expect(css).toContain('--ui-bg:#f7f9fc');
  expect(css).toContain('--ui-text:#111827');
  expect(css).toContain('--ui-primary:#2563eb');
  expect(css).toContain('.dashboard-command-grid');
});
```

- [ ] **Step 6: Re-run both contracts and verify GREEN**

Run:

```bash
npm test -- tests/unit/p10-ui-shell.contract.test.ts tests/unit/dashboard-ui.contract.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/public/css/app.css src/public/css/p10.css tests/unit/p10-ui-shell.contract.test.ts tests/unit/dashboard-ui.contract.test.ts
git commit -m "feat(ui): establish P10 shell design tokens"
```

---

### Task 2: Make the shared layout semantic and icon-ready

**Files:**
- Create: `src/views/partials/icon-sprite.ejs`
- Modify: `src/views/layout.ejs`
- Modify: `tests/unit/p10-ui-shell.contract.test.ts`

**Interfaces:**
- Consumes: existing `title`, `activeNav`, `currentProjectId`, `bodyTemplate`, optional `pageScripts`, and `res.locals.auth` EJS locals.
- Produces: `#primary-navigation`, `#main-content`, `[data-ui="nav-toggle"]`, `[data-ui="nav-backdrop"]`, and local SVG symbols used by sidebar/topbar without network requests.

- [ ] **Step 1: Add failing layout contract assertions**

Append this test to `tests/unit/p10-ui-shell.contract.test.ts`:

```ts
it('renders semantic shell landmarks and local icon infrastructure', () => {
  const layout = source('src/views/layout.ejs');

  expect(layout).toContain('class="skip-link"');
  expect(layout).toContain('href="#main-content"');
  expect(layout).toContain("include('partials/icon-sprite')");
  expect(layout).toContain('data-ui="nav-toggle"');
  expect(layout).toContain('aria-controls="primary-navigation"');
  expect(layout).toContain('data-ui="nav-backdrop"');
  expect(layout).toContain('id="main-content"');
});
```

- [ ] **Step 2: Verify RED**

```bash
npm test -- tests/unit/p10-ui-shell.contract.test.ts
```

Expected: FAIL because the current layout has none of the skip-link/mobile-drawer/icon-sprite markers.

- [ ] **Step 3: Create the local SVG sprite**

Create `src/views/partials/icon-sprite.ejs` as a hidden SVG sprite with these exact symbol IDs:

```html
<svg class="ui-icon-sprite" aria-hidden="true" focusable="false">
  <symbol id="icon-dashboard" viewBox="0 0 24 24"><path d="M4 13h7V4H4v9Zm0 7h7v-5H4v5Zm9 0h7V11h-7v9Zm0-16v5h7V4h-7Z"/></symbol>
  <symbol id="icon-projects" viewBox="0 0 24 24"><path d="M4 5h6l2 2h8v12H4V5Zm2 4v8h12V9H6Z"/></symbol>
  <symbol id="icon-seo" viewBox="0 0 24 24"><path d="M5 17h3V9H5v8Zm5 0h3V5h-3v12Zm5 0h3v-6h-3v6ZM4 19h16v2H4v-2Z"/></symbol>
  <symbol id="icon-geo" viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm6.9 9h-3a15.7 15.7 0 0 0-1.2-5A8.1 8.1 0 0 1 18.9 11ZM12 4c.9 1.1 1.7 3.5 1.9 7h-3.8C10.3 7.5 11.1 5.1 12 4ZM9.3 6a15.7 15.7 0 0 0-1.2 5h-3A8.1 8.1 0 0 1 9.3 6ZM5.1 13h3a15.7 15.7 0 0 0 1.2 5A8.1 8.1 0 0 1 5.1 13Zm6.9 7c-.9-1.1-1.7-3.5-1.9-7h3.8c-.2 3.5-1 5.9-1.9 7Zm2.7-2a15.7 15.7 0 0 0 1.2-5h3a8.1 8.1 0 0 1-4.2 5Z"/></symbol>
  <symbol id="icon-ai" viewBox="0 0 24 24"><path d="m12 2 1.4 4.6L18 8l-4.6 1.4L12 14l-1.4-4.6L6 8l4.6-1.4L12 2Zm7 11 .8 2.2L22 16l-2.2.8L19 19l-.8-2.2L16 16l2.2-.8L19 13ZM7 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z"/></symbol>
  <symbol id="icon-content" viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6V3Zm2 2v14h9V8h-3V5H8Zm2 6h5v2h-5v-2Zm0 4h5v2h-5v-2Z"/></symbol>
  <symbol id="icon-competitors" viewBox="0 0 24 24"><path d="M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8 1a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 21v-3c0-3.3 2.7-6 6-6s6 2.7 6 6v3H2Zm13 0v-3c0-1.7-.5-3.3-1.4-4.6.8-.3 1.6-.4 2.4-.4 3.3 0 6 2.2 6 5v3h-7Z"/></symbol>
  <symbol id="icon-reports" viewBox="0 0 24 24"><path d="M5 3h14v18H5V3Zm2 2v14h10V5H7Zm2 10h2v2H9v-2Zm0-4h6v2H9v-2Zm0-4h6v2H9V7Z"/></symbol>
  <symbol id="icon-optimization" viewBox="0 0 24 24"><path d="M4 7h10v2H4V7Zm0 8h16v2H4v-2Zm12-9h4v4h-4V6ZM8 14h4v4H8v-4Z"/></symbol>
  <symbol id="icon-members" viewBox="0 0 24 24"><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm6 10H3v-3a6 6 0 0 1 12 0v3Zm3-9v3h3v2h-3v3h-2v-3h-3v-2h3v-3h2Z"/></symbol>
  <symbol id="icon-settings" viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9 5-2.1.8-.4 1 1 2-2.7 2.7-2-1-1 .4L13 21H9l-.8-2.1-1-.4-2 1-2.7-2.7 1-2-.4-1L1 13V9l2.1-.8.4-1-1-2 2.7-2.7 2 1 1-.4L9 1h4l.8 2.1 1 .4 2-1 2.7 2.7-1 2 .4 1L21 9v4Z"/></symbol>
  <symbol id="icon-menu" viewBox="0 0 24 24"><path d="M4 6h16v2H4V6Zm0 5h16v2H4v-2Zm0 5h16v2H4v-2Z"/></symbol>
  <symbol id="icon-close" viewBox="0 0 24 24"><path d="m6.7 5.3 5.3 5.3 5.3-5.3 1.4 1.4-5.3 5.3 5.3 5.3-1.4 1.4-5.3-5.3-5.3 5.3-1.4-1.4 5.3-5.3-5.3-5.3 1.4-1.4Z"/></symbol>
  <symbol id="icon-user" viewBox="0 0 24 24"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm9 10H3v-2c0-4.4 4-7 9-7s9 2.6 9 7v2Z"/></symbol>
  <symbol id="icon-switch" viewBox="0 0 24 24"><path d="m7 7 3-3 1.4 1.4L10.8 6H18v2h-7.2l.6.6L10 10 7 7Zm10 10-3 3-1.4-1.4.6-.6H6v-2h7.2l-.6-.6L14 14l3 3Z"/></symbol>
</svg>
```

CSS must keep `.ui-icon-sprite` out of the visual layout:

```css
.ui-icon-sprite { position: absolute; width: 0; height: 0; overflow: hidden; }
.ui-icon { width: 18px; height: 18px; fill: currentColor; flex: 0 0 auto; }
```

- [ ] **Step 4: Upgrade `layout.ejs` without changing rendering flow**

Keep both stylesheet includes and existing body-template rendering. Add the skip link, icon sprite, mobile trigger, and backdrop using this structure:

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
    <% for (const src of pageScripts) { %>
      <script src="<%= src %>" defer></script>
    <% } %>
  <% } %>
</body>
```

The mobile menu button itself belongs in `topbar.ejs` and is implemented in Task 4, but `layout.ejs` must already provide the backdrop and semantic target IDs expected by that control.

- [ ] **Step 5: Add skip-link/backdrop base styles**

In `p10.css` add:

```css
.skip-link {
  position: fixed;
  left: 16px;
  top: 12px;
  z-index: 1000;
  transform: translateY(-160%);
  background: var(--ui-text);
  color: #fff;
  border-radius: var(--ui-radius-control);
  padding: 10px 14px;
  transition: transform var(--ui-transition-fast);
}
.skip-link:focus { transform: translateY(0); }
.nav-backdrop { display: none; }
```

- [ ] **Step 6: Re-run the unit contract**

```bash
npm test -- tests/unit/p10-ui-shell.contract.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add src/views/layout.ejs src/views/partials/icon-sprite.ejs src/public/css/p10.css tests/unit/p10-ui-shell.contract.test.ts
git commit -m "feat(ui): add semantic application shell"
```

---

### Task 3: Consolidate sidebar navigation into truthful product centers

**Files:**
- Modify: `src/views/partials/sidebar.ejs`
- Modify: `src/public/css/p10.css`
- Modify: `tests/unit/p10-ui-shell.contract.test.ts`

**Interfaces:**
- Consumes: `activeNav: string`, `currentProjectId: string | null | undefined`.
- Produces: `#primary-navigation`, first-level center links, `aria-current="page"` on the active center, disabled `成员与权限` / `设置` rows, and project-preserving URLs.

- [ ] **Step 1: Add failing navigation contract assertions**

Append:

```ts
it('uses the approved first-level information architecture without dead links', () => {
  const sidebar = source('src/views/partials/sidebar.ejs');

  for (const label of [
    '仪表盘',
    '项目中心',
    'SEO 中心',
    'GEO / 可见度',
    'AI 分析中心',
    '内容与发布',
    '竞品情报',
    '报告中心',
    '优化运营',
    '成员与权限',
    '设置',
  ]) {
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

Expected: FAIL because the current sidebar exposes many implementation-level links as first-level groups and has no `aria-current`/disabled destination contract.

- [ ] **Step 3: Replace the current sidebar with center-level navigation**

At the top of `sidebar.ejs`, compute truthful project context and active center:

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
    competitors: 'competitors',
    reports: 'reports',
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

Render one brand block, one `nav` landmark, and the item list. Active links must have `aria-current="page"`; disabled entries must be `<span>` rather than anchors:

```ejs
<aside class="sidebar" id="primary-navigation" data-ui="sidebar" aria-label="主导航">
  <div class="sidebar-header">
    <a class="brand" href="/" aria-label="SEO GEO 首页"><span class="brand-mark">SG</span><span class="brand-copy">SEO GEO</span></a>
    <button class="sidebar-close" type="button" data-ui="nav-close" aria-label="关闭导航">
      <svg class="ui-icon" aria-hidden="true"><use href="#icon-close"></use></svg>
    </button>
  </div>
  <nav class="primary-nav">
    <% for (const item of items) { %>
      <% if (item.disabled) { %>
        <span class="nav-item is-disabled" aria-disabled="true" title="将在对应 UI 单元启用">
          <svg class="ui-icon" aria-hidden="true"><use href="#icon-<%= item.icon %>"></use></svg>
          <span><%= item.label %></span>
        </span>
      <% } else { %>
        <a class="nav-item <%= activeCenter === item.key ? 'active' : '' %>" href="<%= item.href %>" <%- activeCenter === item.key ? 'aria-current="page"' : '' %>>
          <svg class="ui-icon" aria-hidden="true"><use href="#icon-<%= item.icon %>"></use></svg>
          <span><%= item.label %></span>
        </a>
      <% } %>
    <% } %>
  </nav>
</aside>
```

- [ ] **Step 4: Style the center navigation using the approved light-blue active state**

Use these key rules in `p10.css`:

```css
.sidebar {
  width: var(--ui-sidebar-width);
  background: var(--ui-surface);
  border-right: 1px solid var(--ui-border);
  color: var(--ui-text);
  padding: 18px 14px;
}
.brand { display: flex; align-items: center; gap: 10px; color: var(--ui-text); margin: 0; }
.brand-mark { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 10px; background: var(--ui-primary); color: #fff; font-weight: 750; }
.brand-copy { font-size: 16px; font-weight: 750; letter-spacing: -0.01em; }
.primary-nav { display: grid; gap: 4px; margin-top: 24px; }
.nav-item { min-height: 42px; display: flex; align-items: center; gap: 11px; border-radius: 11px; padding: 0 12px; color: var(--ui-text-secondary); font-size: 14px; font-weight: 600; transition: background var(--ui-transition-fast), color var(--ui-transition-fast); }
.nav-item:hover { background: var(--ui-surface-subtle); color: var(--ui-text); }
.nav-item.active { background: var(--ui-primary-soft); color: var(--ui-primary); }
.nav-item.is-disabled { color: var(--ui-text-tertiary); cursor: not-allowed; }
.sidebar-close { display: none; }
```

Delete/override the old dark gradient sidebar, gold inset active bar, `nav-label` grouping theme, and premium badges from first-level navigation. Secondary detail routes remain accessible from their owning pages; do not delete any server route.

- [ ] **Step 5: Run focused tests**

```bash
npm test -- tests/unit/p10-ui-shell.contract.test.ts tests/unit/dashboard-ui.contract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/views/partials/sidebar.ejs src/public/css/p10.css tests/unit/p10-ui-shell.contract.test.ts
git commit -m "feat(ui): consolidate primary navigation centers"
```

---

### Task 4: Replace deceptive top-bar chrome with truthful shell context

**Files:**
- Modify: `src/views/partials/topbar.ejs`
- Modify: `src/public/css/p10.css`
- Modify: `tests/unit/p10-ui-shell.contract.test.ts`

**Interfaces:**
- Consumes: `title`, optional `currentProjectId`, `res.locals.auth` (`userId`, `sessionId`) inherited by EJS.
- Produces: `[data-ui="nav-toggle"]`, truthful page title, project-context link, project switch link, authenticated-session chip. Produces no global search and no notification control in UI-01.

- [ ] **Step 1: Add failing truthful-topbar assertions**

Append:

```ts
it('keeps topbar controls truthful and non-deceptive', () => {
  const topbar = source('src/views/partials/topbar.ejs');

  expect(topbar).toContain('data-ui="nav-toggle"');
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

Expected: FAIL because the current top bar contains the static P10 phase label, fake notification dot/button, and fabricated `SG` avatar.

- [ ] **Step 3: Replace `topbar.ejs` with truthful controls only**

Use this structure:

```ejs
<header class="topbar" data-ui="topbar">
  <div class="topbar-leading">
    <button class="nav-toggle" type="button" data-ui="nav-toggle" aria-label="打开导航" aria-controls="primary-navigation" aria-expanded="false">
      <svg class="ui-icon" aria-hidden="true"><use href="#icon-menu"></use></svg>
    </button>
    <div class="topbar-title">
      <p class="eyebrow">SEO GEO Intelligence Platform</p>
      <h1><%= title %></h1>
    </div>
  </div>
  <div class="topbar-actions">
    <% if (typeof currentProjectId === 'string' && currentProjectId) { %>
      <a class="project-context-link" href="/projects/<%= currentProjectId %>">当前项目</a>
      <a class="project-switch-link" href="/projects">
        <svg class="ui-icon" aria-hidden="true"><use href="#icon-switch"></use></svg>
        <span>切换项目</span>
      </a>
    <% } %>
    <% if (typeof auth !== 'undefined' && auth) { %>
      <span class="auth-chip" data-ui="auth-session" aria-label="已认证用户会话">
        <svg class="ui-icon" aria-hidden="true"><use href="#icon-user"></use></svg>
        <span>已认证</span>
      </span>
    <% } %>
  </div>
</header>
```

Do not display `auth.userId` as a human name; do not infer initials from it. Do not add search input or notification icon.

- [ ] **Step 4: Restyle top bar as a light stable product bar**

Use these shell rules:

```css
.topbar {
  min-height: var(--ui-topbar-height);
  height: auto;
  background: var(--ui-surface-elevated);
  backdrop-filter: blur(16px);
  border-bottom: 1px solid var(--ui-border);
  padding: 12px 28px;
}
.topbar-leading, .topbar-actions { display: flex; align-items: center; gap: 12px; }
.topbar-title h1 { margin: 1px 0 0; font-size: 18px; line-height: 1.3; color: var(--ui-text); }
.eyebrow { margin: 0; color: var(--ui-text-tertiary); font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.project-context-link, .project-switch-link, .auth-chip { min-height: 36px; display: inline-flex; align-items: center; gap: 7px; border: 1px solid var(--ui-border); border-radius: var(--ui-radius-control); padding: 0 10px; background: var(--ui-surface); color: var(--ui-text-secondary); font-size: 12px; font-weight: 650; }
.project-switch-link:hover { border-color: var(--ui-border-strong); color: var(--ui-primary); }
.auth-chip { background: var(--ui-surface-subtle); }
.nav-toggle { display: none; }
```

- [ ] **Step 5: Run focused tests**

```bash
npm test -- tests/unit/p10-ui-shell.contract.test.ts tests/unit/dashboard-ui.contract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/views/partials/topbar.ejs src/public/css/p10.css tests/unit/p10-ui-shell.contract.test.ts
git commit -m "feat(ui): make shell context truthful"
```

---

### Task 5: Implement accessible responsive drawer behavior below 1024 px

**Files:**
- Modify: `src/public/js/app.js`
- Modify: `src/public/css/p10.css`
- Modify: `tests/unit/p10-ui-shell.contract.test.ts`

**Interfaces:**
- Consumes: `[data-ui="app-shell"]`, `[data-ui="nav-toggle"]`, `[data-ui="nav-close"]`, `[data-ui="nav-backdrop"]`, `#primary-navigation`.
- Produces: `.nav-open` state on `.app-shell`, synchronized `aria-expanded`, Escape/backdrop/close-button dismissal, focus handoff and desktop breakpoint reset.

- [ ] **Step 1: Add failing source contract for drawer behavior**

Append:

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

- [ ] **Step 3: Implement the minimal drawer controller**

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
  if (event.key === 'Escape' && shell?.classList.contains('nav-open')) {
    setNavigationOpen(false);
  }
});

desktop.addEventListener('change', (event) => {
  if (event.matches) setNavigationOpen(false);
});
```

- [ ] **Step 4: Replace the old `sidebar{display:none}` mobile behavior with a drawer**

In `p10.css`, use:

```css
body.nav-locked { overflow: hidden; }

@media (max-width: 1023px) {
  .workspace { margin-left: 0; width: 100%; }
  .sidebar {
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

Retain table horizontal scrolling and stacked content rules. Remove the old rule that permanently hides `.sidebar` below 720 px.

- [ ] **Step 5: Run focused unit tests**

```bash
npm test -- tests/unit/p10-ui-shell.contract.test.ts tests/unit/dashboard-ui.contract.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/public/js/app.js src/public/css/p10.css tests/unit/p10-ui-shell.contract.test.ts
git commit -m "feat(ui): add responsive navigation drawer"
```

---

### Task 6: Add browser acceptance for desktop context and mobile navigation

**Files:**
- Create: `tests/e2e/p10-shell.spec.ts`
- Modify: `tests/e2e/p10-dashboard-screenshot.spec.ts`

**Interfaces:**
- Consumes: `authenticateE2e`, existing server-rendered routes, shell `data-ui` markers.
- Produces: deterministic Playwright proof for desktop shell, project-scoped links, mobile drawer, active navigation semantics, and viewport overflow.

- [ ] **Step 1: Write the desktop/project-context E2E test**

Create `tests/e2e/p10-shell.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { authenticateE2e } from './e2e-auth.js';

test('renders the UI-01 shell with truthful project context', async ({ page, context }) => {
  const auth = await authenticateE2e(context, {
    role: 'OWNER',
    planLevel: 'ENTERPRISE',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });

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
  } finally {
    await auth.cleanup();
  }
});
```

- [ ] **Step 2: Write the mobile drawer E2E test**

Append:

```ts
test('opens and closes primary navigation below 1024px', async ({ page, context }) => {
  const auth = await authenticateE2e(context, {
    role: 'OWNER',
    planLevel: 'ENTERPRISE',
    userStatus: 'ACTIVE',
    membershipStatus: 'ACTIVE',
  });

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
  } finally {
    await auth.cleanup();
  }
});
```

- [ ] **Step 3: Run the new E2E spec and verify any failure is shell-specific**

```bash
npm run test:e2e -- tests/e2e/p10-shell.spec.ts
```

Expected after Tasks 1-5: PASS. If it fails, fix only shell markup/CSS/JS; do not change auth/domain code to satisfy a presentation test.

- [ ] **Step 4: Strengthen the existing deterministic screenshot test**

In `tests/e2e/p10-dashboard-screenshot.spec.ts`, retain every existing dashboard fact marker and the `p10-dashboard.png` output. Add:

```ts
await expect(page.locator('[data-ui="sidebar"]')).toBeVisible();
await expect(page.locator('[data-ui="topbar"]')).toBeVisible();
await expect(page.getByRole('link', { name: '仪表盘', exact: true })).toHaveAttribute('aria-current', 'page');
```

Do not seed visual-only fake metrics. The screenshot must continue to show truthful persisted/empty dashboard states.

- [ ] **Step 5: Run shell + screenshot E2E together**

```bash
npm run test:e2e -- tests/e2e/p10-shell.spec.ts tests/e2e/p10-dashboard-screenshot.spec.ts
```

Expected: PASS and a deterministic `p10-dashboard.png` created at repository root.

- [ ] **Step 6: Commit Task 6**

```bash
git add tests/e2e/p10-shell.spec.ts tests/e2e/p10-dashboard-screenshot.spec.ts
git commit -m "test(ui): cover P10 application shell"
```

---

### Task 7: Visual acceptance, full regression, and exact-head gate

**Files:**
- Modify only shell files already named in this plan if acceptance exposes a shell defect.
- Do not add page-specific UI-02 work during this task.

**Interfaces:**
- Consumes: final UI-01 branch head, `docs/ui/reference/02-dashboard.jpg` when present locally, existing CI workflow.
- Produces: reviewed `p10-dashboard.png`, full green local verification, and exact-head CI evidence.

- [ ] **Step 1: Ensure the dashboard reference image is locally available for comparison**

The implementation worktree must contain the approved reference at:

```text
docs/ui/reference/02-dashboard.jpg
```

If the JPEG is not present in Git because it came from the separately supplied Codex design package, copy the exact file from that package into the worktree for local visual comparison and verify it against `docs/ui/reference/SHA256SUMS.txt`. Do not substitute a newly generated image.

- [ ] **Step 2: Run focused unit contracts**

```bash
npm test -- tests/unit/p10-ui-shell.contract.test.ts tests/unit/dashboard-ui.contract.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run TypeScript verification**

```bash
npm run typecheck
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 4: Run full Vitest regression**

```bash
npm test
```

Expected: all unit/integration tests pass; no unrelated failures are accepted as UI-01 completion.

- [ ] **Step 5: Run full browser regression**

```bash
npm run test:e2e
```

Expected: all Playwright tests pass and `p10-dashboard.png` is generated.

- [ ] **Step 6: Compare the live screenshot to the approved dashboard reference**

Review `p10-dashboard.png` against `docs/ui/reference/02-dashboard.jpg` at minimum for:

```text
sidebar proportion and light treatment
blue active-center treatment
topbar height and density
content gutter width
system-font hierarchy
surface border/radius/shadow restraint
no gold/dark legacy theme residue
no fake search/notification/user identity
no clipped navigation at 1440px
no horizontal viewport overflow
truthful dashboard empty/unknown states retained
```

If a visual difference is caused by truthful data, authorization, or current product semantics, keep the truthful result and document the difference in the PR rather than faking the reference.

- [ ] **Step 7: Run the exact same three repository CI gates on the exact pushed head**

After pushing the implementation branch, require GitHub Actions to complete these jobs on that exact commit SHA:

```text
verify
production-audit
e2e
```

The `verify` job must include Prisma validate/generate/migrate, Typecheck, full Vitest, and Build. The `e2e` job must include the browser suite and upload the existing `p10-dashboard-screenshot` artifact. `production-audit` must remain green. Do not infer success from a previous commit.

- [ ] **Step 8: Review the exact-head screenshot artifact**

Download the `p10-dashboard-screenshot` artifact produced by the exact-head `e2e` job and inspect it. Confirm it matches the local accepted screenshot and contains no fabricated business data.

- [ ] **Step 9: Commit any final shell-only acceptance adjustment**

If visual acceptance required a shell-only change, run all focused tests again and commit:

```bash
git add src/views/layout.ejs src/views/partials/sidebar.ejs src/views/partials/topbar.ejs src/views/partials/icon-sprite.ejs src/public/css/app.css src/public/css/p10.css src/public/js/app.js tests/unit/p10-ui-shell.contract.test.ts tests/unit/dashboard-ui.contract.test.ts tests/e2e/p10-shell.spec.ts tests/e2e/p10-dashboard-screenshot.spec.ts
git commit -m "fix(ui): finish P10 shell acceptance"
```

If no adjustment was needed, do not create an empty commit.

- [ ] **Step 10: Stop at UI-01**

Declare UI-01 complete only when the exact implementation head is green in all three CI jobs and the exact-head screenshot is accepted. Do not start Login, Dashboard redesign, Project Center redesign, SEO/GEO/AI pages, Content/Publishing, Competitors, Reports, Optimization, Members/Permissions, Settings, or P11 automatically.

---

## Self-Review Record

### Spec coverage

- Canonical design tokens: Task 1.
- Shared layout and semantic landmarks: Task 2.
- Compact icon + label navigation with active state: Tasks 2-3.
- Current-project preservation with no invented context: Tasks 3-4.
- Truthful top bar with no fake search/notifications/avatar: Task 4.
- Reusable existing metric/panel/table/badge/form/tab/empty-state classes normalized to shared tokens: Task 1 plus shell styling in Tasks 3-5.
- Responsive navigation below 1024 px: Task 5.
- Keyboard focus, `aria-current`, accessible icon buttons, reduced motion: Tasks 1-5.
- Browser and deterministic screenshot acceptance: Tasks 6-7.
- Exact-head CI: Task 7.
- No backend/domain/authority expansion: Global Constraints + every task boundary.

### Deliberate UI-01 deferrals

- Real multi-project selector: deferred to UI-02 because the shared shell does not currently receive a truthful project list on every route.
- Global search: omitted because no truthful shared search capability is wired into the shell.
- Notification center: omitted because no unified persisted notification/activity feed is wired into the shell.
- Human-readable account identity/avatar: deferred until an existing persisted user source is explicitly mapped; UI-01 shows only authenticated-session state.
- Dedicated Members & Permissions and Settings destinations: disabled center rows until UI-05 introduces truthful pages/routes.

### Placeholder scan

This plan contains no `TBD`, no implementation `TODO`, no fake metrics, and no instruction to invent an unavailable source. Every planned behavior has an exact file, test, implementation contract, command, and completion condition.

---

## Execution Handoff

Plan is complete at `docs/superpowers/plans/2026-08-26-p10-ui-01-design-system-app-shell.md`.

Recommended execution mode: **Subagent-Driven** using `superpowers:subagent-driven-development`, with a fresh agent per task and review between tasks. If execution must remain inline in one session, use `superpowers:executing-plans` and preserve the same task/commit gates.

Before any production-code edit, the execution session must load `superpowers:using-git-worktrees`, create an isolated worktree for `feat/p10-ui-01-shell`, verify the worktree starts from the exact approved documentation head, and then begin Task 1 only.
