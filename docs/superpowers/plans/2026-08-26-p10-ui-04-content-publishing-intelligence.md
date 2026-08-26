# P10 UI-04 Content, Publishing & Intelligence Implementation Plan

> Execute task-by-task with Superpowers TDD / executing-plans. Every production change must be preceded by a failing contract and followed by fresh exact-head verification.

**Goal:** Productize the existing Content, Publication, Distribution, Competitor Intelligence, and Report Center surfaces without changing P0-P10 business semantics, authority boundaries, state machines, or production deployment behavior.

**Base:** `main@f46cb45070a39cc24e424a68af87dda56af03070` (P10 UI-03 merged).

**Spec:** `docs/superpowers/specs/2026-08-26-p10-ui-productization-design.md`

**Final verification PR:** `#169` from `codex/p10-ui-04-final`.

## Non-negotiable boundaries

- P10 UI-04 only. No UI-05, no P11, and no production deployment in this plan.
- Views/CSS/tests only by default. Do not change schema, repositories/services, auth, RBAC, sessions, CSRF, provider APIs, publish orchestration, or deploy semantics for visual convenience.
- Content lifecycle remains explicit: `draft -> generated -> reviewed -> operator_reviewed -> approved -> publishing -> published -> verified`.
- AI generation/advice remains assistive and may only operate on already-supported facts; it is not a new source of truth.
- Publication keeps `DEPLOYED != VERIFIED`, and E2B/Hugging Face orchestration never implies external production deployment.
- Distribution only treats verified main-site content as a normal distribution source. Manual handoff remains manual; platform submissions are not fabricated.
- Competitor Intelligence must remain project-owned/database-backed. Do not invent third-party ranking, traffic, or P6 AI Visibility data.
- Reports must visibly separate `Fact Snapshot` from `Advisory Snapshot` and must not invent unsupported metrics.

---

## Task 1 — Lock UI-04 presentation and truth contracts (RED)

**Create:** `tests/unit/p10-ui-04-content-publishing-intelligence.contract.test.ts`

Require future UI markers and explicit authority/state language for:

- shared Content / Publishing / Distribution secondary navigation;
- full content lifecycle including `operator_reviewed`, `publishing`, and `verified`;
- publication `DEPLOYED != VERIFIED` boundary;
- distribution verified-source/manual-handoff boundary;
- competitor project-owned fact boundary and no fabricated third-party rankings/traffic/P6 visibility;
- report `Fact Snapshot` / `Advisory Snapshot` separation;
- dedicated `src/public/css/p10-ui-04.css` linked by `src/views/layout.ejs`.

Run the targeted Vitest contract and confirm it fails only because the new UI-04 surfaces do not exist yet.

## Task 2 — Productize Content / Publication / Distribution (GREEN)

**Create:** `src/views/partials/content-publishing-nav.ejs`

**Modify:**
- `src/views/content/index.ejs`
- `src/views/publication/index.ejs`
- `src/views/distribution/index.ejs`

Add a shared second-level navigation, productized hero/summary panels, a visible full lifecycle strip, table shells, and explicit safety/authority panels. Keep all existing route variables, actions, forms, permissions, and data fields unchanged.

Run the targeted UI-04 contract.

## Task 3 — Productize Competitor Intelligence (GREEN)

**Modify:** `src/views/competitors/index.ejs`

Create a clear Competitor Intelligence center with project-owned metrics, tracked pages/observations, add-competitor workflow, and a prominent fact-boundary notice. Do not add ranking, traffic, or P6 visibility claims.

Run the targeted UI-04 contract.

## Task 4 — Productize Report Center (GREEN)

**Modify:** `src/views/reports/index.ejs`

Create a report center that visibly separates:

- **Fact Snapshot** — persisted database facts and existing report metrics;
- **Advisory Snapshot** — explanatory/recommendation layer only, never a replacement for facts.

Preserve existing report generation/filter actions and stored-data-only boundary.

Run the targeted UI-04 contract.

## Task 5 — Dedicated UI-04 stylesheet and regression verification (GREEN)

**Create:** `src/public/css/p10-ui-04.css`

**Modify:** `src/views/layout.ejs`

Add responsive styles using the existing P10 design tokens and link the dedicated stylesheet after UI-03. Do not add external runtime dependencies.

Verification sequence:

1. targeted UI-04 contract test;
2. existing UI-01/UI-02/UI-03 contracts;
3. full Vitest/typecheck/build or the repository's exact-head CI equivalents;
4. inspect PR diff for accidental backend/schema/auth/deploy changes;
5. merge only after exact-head checks are green.

## Completion rule

UI-04 is complete only when the exact PR head is green and the diff is limited to the planned documentation, EJS partial/views, CSS, layout stylesheet registration, and tests. Stop after UI-04; UI-05 remains a separate P10 work package.

Verification must always be attached to the final PR head; superseded CI runs are not completion evidence.
