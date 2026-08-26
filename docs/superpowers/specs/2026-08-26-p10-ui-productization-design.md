# P10 UI Productization Design

**Status:** Proposed for implementation after human review  
**Scope:** P10 UI productization only  
**Baseline:** `main@33f3e3f669211f915960739c2a43c187257fc215`  
**Date:** 2026-08-26

## 1. Purpose

Upgrade the existing SEO GEO application into a coherent, Apple-inspired enterprise SaaS console without changing the P0-P10 domain model, API semantics, persisted-fact authority, authentication, authorization, or automation boundaries.

This is a visual and interaction-system modernization of the current Express + EJS application. It is not a frontend framework rewrite and is not a new product phase.

## 2. Existing architecture to preserve

The current application already provides a server-rendered shell and modular web/API routes:

- Express application entry: `src/app.ts`
- Shared EJS shell: `src/views/layout.ejs`
- Shared navigation: `src/views/partials/sidebar.ejs`
- Shared top bar: `src/views/partials/topbar.ejs`
- Dashboard: `src/views/dashboard.ejs`
- Existing styles: `src/public/css/app.css`, `src/public/css/p10.css`
- Existing browser JavaScript: `src/public/js/app.js`
- Project, SEO, GEO, AI, content, publication, distribution, competitor, reporting, visibility, growth, optimization and membership routes remain the business integration points.

The UI migration must follow existing route/service/repository patterns rather than introducing a parallel client-side application.

## 3. Design direction

The target visual language is restrained Apple-inspired enterprise software:

- light neutral canvas and white surfaces
- generous whitespace and strong hierarchy
- subtle translucent surfaces only where they improve hierarchy
- thin neutral borders and soft shadows
- 12-16 px card radius; controls slightly tighter
- blue as the primary action color
- cyan, violet, green, amber and red as semantic accents
- high information density without visual heaviness
- Chinese-first interface with established English technical terms retained
- minimal decorative gradients; stronger gradients are reserved for bounded AI-assistant accent surfaces
- no ornamental effects that obscure data or status

The visual references in `docs/ui/reference/` are appearance targets only. They are not data, domain, permission, route, workflow, or status authorities.

## 4. Truth and authority contract

### 4.1 Reference image is not data authority

Actual values must come from persisted application facts and existing repositories/services. Never hard-code screenshot values, synthetic trends, users, projects, rankings, citations, activity, quotas, or statuses.

If the current application cannot truthfully provide a value, render an explicit empty/unknown state such as:

- `--`
- `暂无数据`
- `尚未采集`
- `UNKNOWN`
- `NO_DATA`
- `NOT_ELIGIBLE`

Never convert unknown or unavailable evidence to numeric zero.

### 4.2 Existing domain authority remains unchanged

The UI must not expand authority. In particular:

- Authentication, database-backed session handling and CSRF remain authoritative.
- Project membership and RBAC remain authoritative.
- OWNER / ADMIN / OPERATOR / VIEWER capabilities must be resolved server-side.
- Last-owner protection remains unchanged.
- Feature/plan gates remain after project capability checks.
- P8 publication states remain distinct; `PR_CREATED` is not equivalent to deployed or verified.
- P9 controlled automation remains bounded to its existing exact policy; the UI cannot create merge, deploy or rollback authority.
- Human merge/deploy requirements remain human requirements.
- Provider capability metadata remains server-authored.

## 5. Information architecture

The new sidebar groups existing capabilities into user-facing centers while preserving route families:

1. Dashboard
2. Project Center
3. SEO Center
4. GEO / Visibility
5. AI Analysis Center
6. Content & Publishing
7. Competitor Intelligence
8. Report Center
9. Optimization Operations
10. Members & Permissions
11. Settings

Secondary/detail pages remain reachable from their owning center instead of being forced into the first-level sidebar.

Examples:

- SEO issues and comparisons live under SEO Center.
- Citability, entities, AI crawlers, Visibility history/alerts/prompts/citations/subjects/metrics live under GEO / Visibility.
- Growth, optimization experiments and policy controls live under Optimization Operations.
- Publication and distribution detail states live under Content & Publishing.

## 6. Application shell

The first implementation unit is a shared UI system, not a page-by-page CSS copy.

### 6.1 Sidebar

- stable desktop width
- compact icon + label navigation
- clear active state using a light blue surface, not a heavy filled block
- grouped secondary destinations may collapse behind their center
- current project context must be preserved in links
- keyboard-focus treatment is mandatory

### 6.2 Top bar

- project selector when project context exists
- global search surface may be visual-only until backed by a truthful existing search capability; if unavailable it must be disabled/non-deceptive rather than fake
- notification icon only exposes real persisted notifications/events if such data exists
- authenticated user identity should come from the current auth context
- no fabricated avatar/name

### 6.3 Page header

Each page should expose:

- title
- one-sentence purpose
- bounded primary actions that already exist in the system
- optional date/window selector only when the underlying query supports that window

### 6.4 Shared primitives

Create or normalize reusable EJS/CSS primitives for:

- metric cards
- status badges
- tabs
- filters
- search fields
- buttons and icon buttons
- table shells
- pagination
- empty states
- loading/skeleton states where asynchronous behavior exists
- error banners
- callouts
- progress bars
- chart containers
- drawers/modals only where current behavior needs them

Do not add client-side state machinery merely to emulate a screenshot.

## 7. Design tokens

Tokens should be CSS custom properties in the existing stylesheet architecture. The exact values may be tuned during screenshot comparison, but the semantic system should begin approximately as follows:

```css
:root {
  --ui-bg: #f7f9fc;
  --ui-surface: #ffffff;
  --ui-surface-subtle: #fbfcfe;
  --ui-border: #e8edf5;
  --ui-border-strong: #d9e1ec;
  --ui-text: #111827;
  --ui-text-secondary: #667085;
  --ui-text-tertiary: #98a2b3;
  --ui-primary: #2563eb;
  --ui-cyan: #06b6d4;
  --ui-violet: #7c3aed;
  --ui-success: #10b981;
  --ui-warning: #f59e0b;
  --ui-danger: #ef4444;
  --ui-radius-card: 16px;
  --ui-radius-control: 10px;
  --ui-shadow-card: 0 10px 30px rgba(16, 24, 40, 0.05);
}
```

Use a system font stack to avoid adding an external font/network dependency unless the repository already ships an approved font.

## 8. Responsive behavior

Primary targets:

- 1440 px desktop
- 1920 px desktop
- tablet widths

Expected behavior:

- metrics reflow from 4 → 2 → 1 columns where needed
- data tables gain horizontal scrolling rather than crushing columns
- sidebar may collapse on smaller widths without hiding critical navigation
- chart labels remain legible
- primary actions stay discoverable
- no horizontal page overflow at supported widths

Mobile is not the primary P10 console target, but layouts should fail gracefully.

## 9. Page design mapping

### 9.1 Login
Reference: `01-login.jpg`  
Current family: `/auth/*`, `src/views/auth/*`.

Keep the login flow, origin validation, rate limit, session semantics and password behavior unchanged. The left marketing panel is presentational and must not imply unsupported functionality.

### 9.2 Dashboard
Reference: `02-dashboard.jpg`  
Current route/view: `/` → `src/views/dashboard.ejs`.

Display only portfolio/project facts that already exist. Activity and insight modules need explicit empty states when no unified persisted feed exists.

### 9.3 Project Center
Reference: `03-project-center.jpg`  
Current family: `/projects`, `/projects/:id`, `src/views/projects/*`.

Project list and detail may be modernized without changing create/project-access semantics.

### 9.4 SEO Center
Reference: `04-seo-center.jpg`  
Current family includes `/projects/:id/seo`, `/projects/:id/seo/issues`, audit comparison and issue detail.

Preserve SEO rule result and issue lifecycle semantics. Do not invent keyword rank data merely because the reference includes a ranking chart; show the truthful metric(s) supported by current Search Facts or an explicit unavailable state.

### 9.5 GEO / Visibility
Reference: `05-geo-visibility.jpg`  
Current families include `/projects/:id/geo*` and `/projects/:id/visibility*`.

The center may unify navigation and presentation, but GEO Readiness and actual AI Visibility remain separate measurements. Mention Rate, Citation Rate, Share of Voice, coverage and evidence state must retain their existing semantics.

### 9.6 AI Analysis Center
Reference: `06-ai-analysis.jpg`  
Current route/view family: `/projects/:id/ai*`, `src/views/ai/*`.

DeepSeek/AI output remains advisory. Never render reasoning content that the current P4 contract intentionally does not persist.

### 9.7 Content & Publishing
Reference: `07-content-publishing.jpg`  
Current families include content, publication and distribution routes/views.

The center must distinguish content intelligence from publication authority and show immutable source-version and publication state where available.

### 9.8 Competitor Intelligence
Reference: `08-competitor-intelligence.jpg`  
Current family: competitor web routes and `src/views/competitors/*`.

Competitor facts must remain separate from owned facts. Never fabricate traffic, ranking, citation or share-of-voice data.

### 9.9 Report Center
Reference: `09-report-center.jpg`  
Current family: `/projects/:id/reports*`, reporting web routes and `src/views/reports/*`.

Keep fact snapshot and advisory snapshot separation. Report status/date/window must come from persisted reports.

### 9.10 Optimization Operations
Reference: `10-optimization-center.jpg`  
Current families include Growth, `/projects/:id/optimization`, optimization experiments, policy revisions and related P9 read models.

This is a projection/control surface, not a new executor. Existing P7/P8/P9 ownership and automation boundaries remain unchanged.

### 9.11 Members & Permissions
Reference: `11-members-permissions.jpg`  
Current membership API under `/api/projects/*`; project/auth views remain the integration boundary until a dedicated member view is introduced.

The page must present server-resolved capabilities and membership status. Role UI never becomes authorization authority.

### 9.12 Settings
No separate reference image is required. Settings inherits the same design system and may surface only existing, safe configuration domains: project metadata, market/locale configuration, provider/integration connection state, profile/session/security controls and plan/feature information already supported by P0-P10.

## 10. Interaction and state rules

Every data-bearing component must define these states where relevant:

- loading
- success with data
- success with known empty
- unknown/incomplete evidence
- not eligible/not supported
- permission denied
- feature not available
- recoverable error
- terminal error

Status colors supplement text; they never replace it.

Tables must use stable labels and semantic badges, not color alone.

## 11. Accessibility

Minimum requirements:

- meaningful document hierarchy
- keyboard reachable actions
- visible focus indicators
- form labels and accessible names
- sufficient text/background contrast
- `aria-current` or equivalent active-nav semantics where appropriate
- status conveyed by text and/or icons, never only by color
- charts accompanied by underlying summary values or accessible table/text equivalents where practical
- respect `prefers-reduced-motion`

## 12. Implementation sequence

The UI migration is split into reviewable units:

### UI-01 — Design System + Application Shell
Shared layout, navigation, top bar, tokens and primitives. No domain changes.

### UI-02 — Login + Dashboard + Project Center
Validate shell and common information patterns against real persisted data.

### UI-03 — SEO + GEO/Visibility + AI Analysis
Migrate the analysis-heavy pages and verify unknown/evidence semantics.

### UI-04 — Content/Publishing + Competitor + Reports
Migrate content and distribution state machines without collapsing authority/status boundaries.

### UI-05 — Optimization + Members/Permissions + Settings
Finish P9/P10 control surfaces and project administration.

Each unit is independently testable and should be landed only after exact-head verification.

## 13. Testing and visual acceptance

For every UI unit:

1. Run relevant unit/contract tests.
2. Run TypeScript typecheck.
3. Run build.
4. Run relevant E2E/browser tests.
5. Capture deterministic screenshots at approved desktop viewport(s).
6. Compare against reference image for hierarchy, spacing, density, component geometry and visual language.
7. Prefer business correctness over pixel mimicry whenever the reference conflicts with real application data or capability.
8. Run the repository's exact-head CI gates before declaring the unit complete.

Visual tests must not depend on live public providers or fabricated production bypasses.

## 14. Non-goals

This design does not authorize:

- schema redesign solely for visual convenience
- API semantic changes solely to match screenshots
- replacing EJS with React/Next/Vue
- new public signup
- new provider integrations
- new autonomous execution authority
- automatic merge/deploy/rollback
- production deployment
- a new product phase beyond P10

## 15. Approval gate

This document is the approved-direction design translated into repository form. Product code implementation begins only after the human owner reviews this written spec and explicitly approves it. The next artifact after that approval is the detailed implementation plan, beginning with UI-01.
