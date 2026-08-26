# P10 UI-05 Optimization, Members & Settings Implementation Plan

> Execute with TDD and exact-head verification. This is the final numbered P10 UI package; do not enter P11.

**Goal:** Productize Optimization Operations, introduce a dedicated Members & Permissions view over the existing membership/RBAC domain, and introduce a safe Settings view over existing P0-P10 configuration without changing authority, domain semantics, or production deployment behavior.

**Base:** `main@19cddcfd6d652a8974bae1b9da7f2ddb02a7915c` (P10 UI-04 merged).

**Spec:** `docs/superpowers/specs/2026-08-26-p10-ui-productization-design.md`

## Non-negotiable boundaries

- P10 UI-05 only. No P11 and no production deployment.
- Existing P7/P8/P9 optimization ownership and automation boundaries remain unchanged.
- Optimization UI is a projection/control surface, not a new executor. No automatic merge/deploy/rollback authority.
- Project membership and RBAC remain server-authoritative. Role labels in the UI never grant authorization.
- Preserve OWNER / ADMIN / OPERATOR / VIEWER capability resolution and last-owner protection exactly as implemented.
- Members UI may call the existing `ProjectMembershipService`; do not create a parallel membership model or bypass capability middleware.
- Settings may expose only existing safe P0-P10 facts: project metadata/locale, plan/features, non-secret provider configuration state, current authenticated profile/session facts, and runtime configuration that already exists.
- Never expose credentials, tokens, secrets, connection strings, password hashes, provider keys, or synthetic health/last-success data.
- Do not add new providers, signup, organization model, schema, or P11 settings concepts.
- Preserve established H1 labels and E2E selectors unless a new UI-05 contract explicitly adds a new surface.

## Task 1 — Lock UI-05 truth and navigation contracts (RED)

**Create:** `tests/unit/p10-ui-05-operations-admin-settings.contract.test.ts`

Require:

- Optimization Operations truth/authority boundary markers while preserving `自动优化中心` and existing operation hooks.
- Sidebar activates real project-scoped Members & Permissions and Settings links instead of disabled placeholders.
- Dedicated Members view states that server RBAC is authoritative, exposes current resolved role/capabilities, and preserves last-owner protection language.
- Dedicated Settings view separates project/profile/provider/runtime facts and explicitly redacts secrets.
- Dedicated `src/public/css/p10-ui-05.css` registered after UI-04.
- Any new web adapter must use existing membership/project services and capability middleware rather than duplicating authorization.

The RED commit should fail only because UI-05 surfaces/routes/styles do not yet exist.

## Task 2 — Productize Optimization Operations (GREEN)

**Modify:** `src/views/optimization-operations/index.ejs`

Keep all existing data attributes, buttons, policy form hooks, `自动优化中心` H1, state values, policy mutation availability, and page script unchanged. Add productized hierarchy and an explicit authority boundary distinguishing persisted facts, runtime policy, actor identity, and execution authority.

Do not change the P9 service/repository/command layer.

## Task 3 — Introduce Members & Permissions web surface (GREEN)

**Create:**
- `src/modules/projects/project-admin.web.routes.ts`
- `src/views/project-admin/members.ejs`

**Modify:**
- `src/app.ts`
- `src/views/partials/sidebar.ejs`

The GET member page must reuse:

- `requireAuthentication()`
- `requireProjectMembership()`
- `requireProjectCapability('PROJECT_MEMBER_READ')`
- `ProjectMembershipService.list()`
- the server-resolved membership in `res.locals.projectMembership`
- `hasProjectCapability()` for presentation only

If member mutation forms are exposed, their web POST adapters must call the existing `ProjectMembershipService` and remain guarded by existing CSRF + capability middleware. No new membership semantics.

## Task 4 — Introduce safe Settings web surface (GREEN)

**Create:** `src/views/project-admin/settings.ejs`

**Modify:** `src/modules/projects/project-admin.web.routes.ts`

The Settings page may show only existing safe facts:

- project name/domain/industry/language/country/timezone/plan;
- feature eligibility already derivable from existing plan gates;
- DeepSeek provider name/model/base URL/timeout and **configured yes/no only** — never the API key;
- Google Search Console OAuth configured yes/no from the presence of existing required config, never client secret or encrypted credential material;
- crawler runtime configuration already present in `env`;
- authenticated user/profile/session identifiers only as safely resolved from existing auth data.

Project metadata edits, if exposed, must call the existing `ProjectService.update()` and remain guarded by `PROJECT_SETTINGS_WRITE` + CSRF.

## Task 5 — UI-05 stylesheet and browser coverage (GREEN)

**Create:** `src/public/css/p10-ui-05.css`

**Modify:** `src/views/layout.ejs`

Add responsive admin/control-surface styles using existing P10 tokens. No external runtime dependencies.

Add deterministic E2E coverage for:

- Optimization Operations H1/hooks and authority language;
- Members page server-resolved role/capability presentation and access gate;
- Settings page safe provider/runtime projection with no secret values;
- sidebar active states for Members and Settings.

## Task 6 — Exact-head verification and merge

Run/require on the final PR head:

1. targeted UI-05 contract;
2. existing UI-01 through UI-04 contracts;
3. relevant membership/RBAC/optimization tests;
4. full Typecheck, Vitest, Build;
5. full browser E2E;
6. production-audit;
7. PR diff audit for accidental schema/auth/service/provider/deploy changes.

Merge only when exact-head `verify`, `production-audit`, and `e2e` are green.

## Completion rule

UI-05 is complete only after its exact-head PR is merged to `main`. Then stop numbered UI development and perform P10 closure/archive verification only. Do not start P11.