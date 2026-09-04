# 兴善堂 SEO GEO

Independent SEO / GEO platform for `seo.xingshantang.org`.

## Current milestone

**P12 implementation complete; hardening frozen.** The four reviewed automation safety boundaries already have explicit automated contracts, so P12 is no longer generating speculative RED tests. The current closure branch is documentation-only and exists to record acceptance and Production release gates.

**Production status: NOT DEPLOYED.** A green repository state or Draft PR does not authorize merge or deployment. Both actions require separate explicit human authorization.

P12 closure documents:

- `docs/development/p12-operations-layer-verification.md`
- `docs/development/p12-production-release-checklist.md`

## Architecture

- Node.js 22
- TypeScript
- Express 5
- EJS
- PostgreSQL / Prisma
- Redis / BullMQ
- Zod
- Vitest / Supertest / Playwright
- DeepSeek through a provider-neutral advisory AI Gateway
- Official-provider adapters through bounded visibility/search pipelines
- Google Search Console through read-only OAuth and immutable source snapshots

## Core authority boundary

Deterministic crawler, SEO, GEO, content, competitor, reporting, visibility-derived and Growth facts remain authoritative. AI may explain, summarize, prioritize, draft and recommend, but it does not determine deterministic source facts or silently mutate authoritative state.

Additional safety boundaries remain explicit:

- provider reasoning is never persisted, logged or rendered;
- P6 external visibility is authoritative only for supported persisted provider/API samples and is never mislabeled as consumer-product ranking;
- Search Console ingestion is read-only;
- publication execution uses reviewable Draft PR flows rather than direct default-branch writes or automatic merge;
- manual/preparation-only distribution capabilities cannot be upgraded into automatic provider posting by plan level;
- P12 automation is project-scoped, mutation routes retain RBAC + CSRF protection, scheduler reconciliation fails closed, and durable run/request identity is preserved;
- no P12 path grants autonomous merge or Production deployment authority.

## Platform milestones

### P0-P3 — Foundation, Crawl, SEO and GEO

- P0 platform foundation and local/runtime baseline.
- P1 crawler and Technical SEO ingestion.
- P2 deterministic SEO rule engine and audit surfaces.
- P3 GEO/citability/entity analysis.

### P4-P5 — AI and Content Intelligence

- P4 provider-neutral DeepSeek advisory AI Gateway.
- P5 content intelligence, competitor intelligence and reporting.

Operational references:

- `docs/development/p4-ai-gateway.md`
- `docs/development/p5a-content-intelligence.md`
- `docs/development/p5b-competitor-intelligence.md`
- `docs/development/p5c-reporting.md`

### P6 — AI Visibility

P6-A through P6-D provide bounded provider sampling, deterministic citation/mention extraction, visibility metrics/share of voice, immutable history/comparisons, in-app alerts and report integration.

Operational references:

- `docs/development/p6a-visibility-sampling.md`
- `docs/development/p6a-release-verification.md`
- `docs/development/p6b-citation-mention-intelligence.md`
- `docs/development/p6c-visibility-metrics-sov.md`
- `docs/development/p6d-history-dashboard-alerts-report.md`

### P7 — Growth Opportunity Intelligence

P7 connects persisted search/source evidence to deterministic, auditable Growth opportunities while keeping AI advisory and Search Console read-only.

Operational reference: `docs/development/p7a-growth-opportunity-intelligence.md`.

### P8 — Safe Publication and Distribution

- P8-A: reviewable primary publication and Draft PR execution; no automatic merge/default-branch write.
- P8-B: bounded multi-channel distribution with explicit capability boundaries.
- P8-C: Community GEO remains human-operated `MANUAL_HANDOFF`; entity/knowledge-graph work remains Enterprise `PREPARE_ONLY` with no automatic knowledge-platform submission.

Operational reference: `docs/development/p8c-release-verification.md`.

### P9 — Multi-market Intelligence and Operations

P9 expands the platform across market/locale handling, global and China search/provider layers, AI visibility providers, unified search facts, multi-provider Growth inputs, optimization planning, experiments, feedback learning and the persisted Operations Center.

Representative references:

- `docs/development/p9-0a-market-locale-foundation.md`
- `docs/development/p9-0b-global-search-provider-layer.md`
- `docs/development/p9-0c-china-search-provider-layer.md`
- `docs/development/p9-0d-global-ai-visibility-expansion.md`
- `docs/development/p9-0e-china-ai-visibility-providers.md`
- `docs/development/p9-0f-unified-search-facts.md`
- `docs/development/p9-0g-p7-multi-provider-growth-adapter.md`
- `docs/development/p9-0h-third-party-skill-foundation.md`
- `docs/development/p9-a-optimization-planner.md`
- `docs/development/p9-d-experiment-engine.md`
- `docs/development/p9-e-feedback-learning.md`
- `docs/development/p9-f-autonomous-operations-center.md`

### P10 — Release Verification

P10 records the release-verification boundary and exact-head acceptance discipline.

Reference: `docs/development/p10-release-verification.md`.

### P11 — Keyword and Search Evidence

P11 covers keyword demand capture, official search evidence/synchronization, current SERP rank tracking and the integrated P11 V1 acceptance boundary.

References:

- `docs/development/p11-01-keyword-demand-capture-verification.md`
- `docs/development/p11-02a-official-search-evidence-verification.md`
- `docs/development/p11-02b-official-search-sync-verification.md`
- `docs/development/p11-02c-current-serp-rank-tracking-verification.md`
- `docs/development/p11-v1-integration-verification.md`

### P12 — Operations Layer and Automation Hardening

The frozen P12 scope includes the Operations Today/Action Center, durable project-scoped automation definitions/runs, scheduler reconciliation, automation visibility/retry controls, Alert Center/control-panel wiring and the hardening contracts accumulated around identity, overlap, enqueue compensation, retry and timeout repair.

The four reviewed closure contracts are already represented by automated tests:

1. Automation Definition management API boundary.
2. Project RBAC + CSRF fail-closed mutation boundary.
3. Runtime scheduler reconciliation safety/prevalidation boundary.
4. Worker startup reconciliation before automation readiness, including fail-closed error propagation.

Because those contracts already exist, P12 hardening is frozen instead of manufacturing duplicate RED coverage.

Acceptance evidence: `docs/development/p12-operations-layer-verification.md`.
Production gate: `docs/development/p12-production-release-checklist.md`.

## Development

```bash
npm ci
npx prisma generate
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## Release verification

Repository release gates include Prisma validation/generation/migration verification, Typecheck, full Vitest, Build, Chromium E2E, production dependency audit and deployment-artifact verification. Evidence must always match the exact release-candidate SHA; a historical green run from another SHA is not sufficient.

Typical local/release checks include:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=high --legacy-peer-deps
```

Production operating references include:

- `docs/development/release-01-backup-restore.md`
- `docs/development/release-01-rollback.md`
- `docs/development/release-01-staging-runbook.md`
- `docs/development/release-01-staging-acceptance.md`

## Roadmap status

- P0 Platform foundation — complete
- P1 Crawler + Technical SEO ingestion — complete
- P2 SEO Rule Engine + Audit UI — complete
- P3 GEO Engine + Citability + Entity — complete
- P4 DeepSeek AI Gateway + Intelligence — complete
- P5 Content / Competitor / Reporting — complete
- P6 AI Visibility stack — complete
- P7 Growth Opportunity Intelligence — complete
- P8 Safe Publication / Distribution / Community & Entity support — complete
- P9 Multi-market intelligence + optimization/operations — complete
- P10 Release verification — complete
- P11 Keyword + official search evidence/tracking — complete
- P12 Operations Layer implementation — complete; hardening frozen

**Release boundary:** P12 closure still requires its own exact-head Draft-PR CI evidence. Merge and Production deployment remain manual, separately authorized actions.
