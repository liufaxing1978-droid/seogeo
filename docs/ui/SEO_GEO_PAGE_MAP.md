# SEO GEO UI Page Map

**Baseline inspected:** `main@33f3e3f669211f915960739c2a43c187257fc215`  
**Goal:** map approved UI references onto the existing Express + EJS application without changing domain authority.

## Shared shell

| Concern | Current implementation | Target |
|---|---|---|
| Main layout | `src/views/layout.ejs` | Shared Apple-inspired EJS shell |
| Sidebar | `src/views/partials/sidebar.ejs` | Consolidated 11-center IA + project-aware links |
| Top bar | `src/views/partials/topbar.ejs` | Project context, truthful auth identity, bounded actions |
| Base CSS | `src/public/css/app.css` | Shared primitives/tokens |
| P10 CSS | `src/public/css/p10.css` | Productized shell/page styles |
| Browser JS | `src/public/js/app.js` | Lightweight interaction only where needed |

Do not introduce a second SPA/router.

## Page/reference mapping

| # | UI center | Reference | Verified current route/view family | Notes |
|---:|---|---|---|---|
| 01 | Login | `reference/01-login.jpg` | `/auth/*`, `src/views/auth/*` | Preserve P10 login/session/rate-limit/origin behavior |
| 02 | Dashboard | `reference/02-dashboard.jpg` | `/` → `src/views/dashboard.ejs` | Portfolio facts only; no fabricated unified feed |
| 03 | Project Center | `reference/03-project-center.jpg` | `/projects`, `/projects/new`, `/projects/:id`, `src/views/projects/*` | Preserve membership-filtered listing and creation |
| 04 | SEO Center | `reference/04-seo-center.jpg` | `/projects/:id/seo`, `/projects/:id/seo/issues`, `/projects/:id/seo/compare`, `/seo/issues/:issueId`, `src/views/seo/*` | Ranking widgets require truthful Search Facts or unavailable state |
| 05 | GEO / Visibility | `reference/05-geo-visibility.jpg` | `/projects/:id/geo*`, `/projects/:id/visibility*`, GEO + Visibility views | GEO Readiness and measured AI Visibility remain separate |
| 06 | AI Analysis | `reference/06-ai-analysis.jpg` | `/projects/:id/ai*`, `src/views/ai/*` | AI remains advisory; no reasoning-content rendering |
| 07 | Content & Publishing | `reference/07-content-publishing.jpg` | content/publication/distribution web routes and views | Preserve P8 authority and state machines |
| 08 | Competitor Intelligence | `reference/08-competitor-intelligence.jpg` | competitor web routes, `src/views/competitors/*` | Owned and competitor facts stay separate |
| 09 | Report Center | `reference/09-report-center.jpg` | `/projects/:id/reports*`, report web routes, `src/views/reports/*` | Preserve immutable report snapshots |
| 10 | Optimization Operations | `reference/10-optimization-center.jpg` | `/projects/:id/optimization`, optimization experiments, Growth/P9 views | Projection/control surface, not a new executor |
| 11 | Members & Permissions | `reference/11-members-permissions.jpg` | `/api/projects` membership routes plus project/auth integration | Server-resolved capabilities remain authority |
| 12 | Settings | derived from design system | existing project/market/integration/auth/security capabilities | No invented settings |

## Verified core web routes

The current core router contains `/`, `/projects`, `/projects/new`, `/projects/:id`, crawl/page routes, `/projects/:id/seo*`, `/seo/issues/:issueId`, `/projects/:id/geo*`, `/projects/:id/ai*`.

`src/app.ts` additionally mounts existing content, publication, distribution, competitor, reporting, Search Console, Growth, Visibility, Optimization Operations and Optimization Experiment web routers. Codex must inspect the exact owning route file before changing a page.

## Navigation consolidation

### 仪表盘
Portfolio dashboard.

### 项目中心
Project list/detail, creation, pages, crawls and project configuration shortcuts.

### SEO 中心
SEO audit, issue center, audit compare, issue detail and truthful search-performance views.

### GEO / 可见度
GEO overview, Citability, entities, AI crawler accessibility, AI Visibility, history, alerts, prompts, citations, subjects and metrics.

### AI 分析中心
DeepSeek analysis center and task detail/retry subject to existing feature gates.

### 内容与发布
Content intelligence, publication and distribution.

### 竞品情报
Competitor intelligence.

### 报告中心
Persisted reports and report details.

### 优化运营
Search/Growth opportunities, topic clusters, cannibalization, new-content opportunities, Optimization Operations, experiments and current authorized policy controls.

### 成员与权限
Active/revoked membership, roles and only truthful persisted security/audit summaries.

### 设置
Project, market/locale, supported integration state and current profile/password/session/security capabilities.

## Data-source rule

A screenshot label does not prove the application has a source for that element. Before implementing each data-bearing component, Codex records:

| UI element | Existing source | Scope | Evidence/status semantics | Empty state |
|---|---|---|---|---|
| example | repository/service/API | project + window | KNOWN/UNKNOWN/... | `--` / explanation |

Only then should markup be implemented.

## State preservation

### Publication
Keep domain states conceptually distinct when exposed by the existing model:

`DRAFT` → `PREVIEWED` → `APPROVED` → `PR_CREATED` → `DEPLOYED` → `VERIFIED`

Never label `PR_CREATED` as 已发布 or 已部署.

### Visibility
Keep Mention Rate, Citation Rate, Share of Voice, coverage/eligibility and `UNKNOWN` / `NO_DATA` / `NOT_ELIGIBLE` / `NO_SIGNAL` semantics explicit.

### Optimization
Preserve ownership rather than collapsing the pipeline into one “AI optimized” status:

Growth opportunity → Optimization planning/orchestration → Controlled policy decision → P8 publication handoff → Verification → Experiment → Feedback.

## Reference usage

References define hierarchy, spacing, density, component shape and visual language. Exact text/numeric values from images must not be copied unless the application already produces them truthfully.
