# Codex UI Implementation Guide

## Mission

Productize the existing `seogeo` P0-P10 interface according to the approved design spec and reference images while preserving all backend/domain/security authority.

## Required reading before UI code

1. `docs/superpowers/specs/2026-08-26-p10-ui-productization-design.md`
2. `docs/ui/SEO_GEO_UI_DESIGN_SYSTEM.md`
3. `docs/ui/SEO_GEO_PAGE_MAP.md`
4. `docs/ui/reference/README.md`
5. Existing implementation files for the selected task

## Non-negotiable rules

- This is P10 UI productization, not a new product phase.
- Do not replace Express + EJS with a SPA/framework rewrite.
- Do not change Prisma schema, API semantics, business services or persisted facts solely to make the UI match a reference.
- Do not bypass authentication, session security, CSRF, project membership, RBAC, feature gates, last-owner protection or actor resolution.
- Do not hard-code reference screenshot metrics, users, projects, statuses, activity or trends.
- `UNKNOWN`/missing evidence is not zero.
- A visual reference is not business authority.
- P8 `PR_CREATED` is not `DEPLOYED` or `VERIFIED`.
- Controlled automation authority remains exactly as implemented; the UI does not add Merge/Deploy/Rollback authority.
- Do not claim or perform production deployment as part of UI work unless separately authorized.

## First action for every UI task

Before editing code, produce an implementation audit for the selected UI unit:

1. routes
2. views/partials
3. controllers/web route handlers
4. repositories/services/APIs
5. authorization/feature gates
6. persisted data sources
7. current tests
8. files proposed for modification
9. missing data that must render as empty/unknown rather than fabricated

Stop if the proposed UI would require changing business authority only to imitate the screenshot. Redesign that component around truthful available facts.

## UI migration units

### UI-01 — Design System + Application Shell

Likely files after audit:

- `src/views/layout.ejs`
- `src/views/partials/sidebar.ejs`
- `src/views/partials/topbar.ejs`
- `src/public/css/app.css`
- `src/public/css/p10.css`
- `src/public/js/app.js` only if required
- reusable partials under `src/views/partials/`

Outcome: shared tokens, Apple-inspired shell, consolidated navigation, reusable metric/panel/table/badge/form/tab/empty-state patterns; no domain changes.

### UI-02 — Login + Dashboard + Project Center

References: `01-login.jpg`, `02-dashboard.jpg`, `03-project-center.jpg`.

Verify auth views/routes, dashboard persisted portfolio facts, project list/detail services, create-project authorization and CSRF. No fake cross-project aggregates.

### UI-03 — SEO + GEO/Visibility + AI Analysis

References: `04-seo-center.jpg`, `05-geo-visibility.jpg`, `06-ai-analysis.jpg`.

Verify SEO audit/issues/Search Facts availability, GEO Readiness sources, P6/P9 Visibility metric/evidence sources, AI task feature gates/status/result fields. Never use a reference chart value when a truthful source is absent.

### UI-04 — Content/Publishing + Competitor + Reports

References: `07-content-publishing.jpg`, `08-competitor-intelligence.jpg`, `09-report-center.jpg`.

Verify content materialization, publication approval/PR/deployment/verification states, distribution artifacts, competitor fact boundaries and report snapshot/version/status fields.

### UI-05 — Optimization + Members/Permissions + Settings

References: `10-optimization-center.jpg`, `11-members-permissions.jpg`; Settings derives from the shared design system.

Verify P7 opportunities, P9-A plan, P9-B orchestration, P9-C policy/decision/quotas, P8 handoff, P9-D experiments, P9-E feedback, P9-F actor/capability behavior, membership/last-owner behavior and existing safe settings surfaces.

## Per-page data mapping template

```text
UI element:
Reference location:
Existing route/view:
Persisted source:
Scope (project/market/window):
Evidence semantics:
RBAC/feature gate:
Empty state:
Error state:
Action (if any):
```

## Visual rules

- Start from shared design tokens; do not copy random pixel values page by page.
- Prefer CSS Grid/Flexbox and semantic HTML.
- Avoid absolute positioning for application layout.
- Keep charts visually simple and accessible.
- Use one primary action per page header where practical.
- Move secondary implementation detail into tabs/sub-navigation rather than deleting it.
- Reserve strong gradients for bounded AI accent cards.
- Keep the interface light; use borders/shadows sparingly.

## Verification protocol

Inspect `package.json` and CI workflow, then prove at minimum:

- typecheck green
- relevant unit/contract tests green
- build green
- relevant E2E/browser tests green
- deterministic reference screenshot captured
- no unrelated regression in exact-head required CI gates

Do not report a unit complete from visual review alone.

## Screenshot acceptance

Compare implementation against the reference for shell proportions, alignment, whitespace, hierarchy, card geometry, typography, table density, semantic accents and responsive overflow. Differences are acceptable when required by truthful data, authorization, accessibility or existing product semantics.

## Suggested Codex task prompt

```text
Implement the approved UI unit <UI-0X> in liufaxing1978-droid/seogeo.

Read first:
- docs/superpowers/specs/2026-08-26-p10-ui-productization-design.md
- docs/ui/SEO_GEO_UI_DESIGN_SYSTEM.md
- docs/ui/SEO_GEO_PAGE_MAP.md
- docs/ui/CODEX_UI_IMPLEMENTATION_GUIDE.md
- the relevant docs/ui/reference/*.jpg files

Before editing production code, inspect and summarize the current route -> view -> repository/service/API -> authorization -> tests mapping for this unit.

Treat reference images as visual targets only. Persisted application facts and existing P0-P10 authority are the source of truth. Never fabricate data to match references. Preserve authentication, session, CSRF, RBAC, project scope, plan feature gates and existing P8/P9 automation authority.

Use TDD/contract tests for the change. Implement only <UI-0X>. Run exact-head verification and capture deterministic browser screenshots before declaring completion. Do not start a later UI unit automatically.
```

## Completion definition

A UI unit is complete only when visual target is substantially achieved, every datum is traceable to a truthful source or explicit empty/unknown state, authorization/workflow semantics remain intact, tests/build/E2E are green at exact head, screenshot evidence exists and review finds no invented domain capability.
