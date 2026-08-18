# P5-C Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build reproducible project report snapshots, browser/JSON exports and optional DeepSeek executive summaries.

**Architecture:** Aggregate persisted P2/P3/P5 facts synchronously into immutable `PROJECT_REPORT_V1` snapshots. Keep deterministic facts and persisted AI advice in separate JSON sections. Optional executive summary goes through the existing P4 AI task queue/gateway.

**Tech Stack:** Node.js 22, TypeScript, Express 5, EJS, Prisma/PostgreSQL, BullMQ, Zod, Vitest/Supertest/Playwright.

**Spec:** `docs/superpowers/specs/2026-08-19-p5c-reporting-design.md`

## Global Constraints

- P2/P3/P5 deterministic facts remain authoritative.
- AI advice never becomes deterministic report facts.
- Missing facts stay null/UNKNOWN.
- No live web or DeepSeek call during deterministic report generation.
- `REPORTING` is distinct from `ADVANCED_REPORTS`.
- P6 AI Visibility/SOV remains excluded.

---

## Task 1: Persistence foundation

- [ ] Write `tests/integration/report.persistence.test.ts`.
- [ ] Add `prisma/models/reporting.prisma` with `ReportSnapshot` and `ReportType`.
- [ ] Add migration and FK constraints to Project/AiTask.
- [ ] Verify immutable snapshot behavior and project cascade cleanup.

## Task 2: Deterministic report builder

- [ ] Write `tests/integration/report.builder.test.ts` with P2/P3/P5 fixtures.
- [ ] Add `src/modules/reporting/report-builder.ts`.
- [ ] Bound issue/opportunity/competitor aggregations.
- [ ] Preserve null/UNKNOWN semantics and source refs.
- [ ] Keep completed AI results only in advisory packet.

## Task 3: AI executive summary

- [ ] Write `tests/integration/ai.report-intelligence.test.ts`.
- [ ] Add `REPORT_EXECUTIVE_SUMMARY` migration/type.
- [ ] Add `project-report-summary-v1` prompt/Zod parser.
- [ ] Extend AI worker task routing.
- [ ] Attach queued task ID to the report snapshot without persisting provider reasoning.

## Task 4: Feature gate and REST

- [ ] Add `REPORTING` feature for Standard/Advanced/Enterprise.
- [ ] Write `tests/integration/report.api.test.ts`.
- [ ] Add `src/modules/reporting/report.routes.ts`.
- [ ] Add create/list/detail/JSON export/AI-summary endpoints.
- [ ] Mount under `/api/v1`.

## Task 5: Web UI and browser smoke

- [ ] Write `tests/integration/report.web.test.ts`.
- [ ] Write `tests/e2e/report-center.spec.ts`.
- [ ] Add report web repository/routes.
- [ ] Add `src/views/reports/index.ejs` and `show.ejs`.
- [ ] Add project-scoped sidebar link.
- [ ] Ensure deterministic and advisory sections are visibly separated.

## Task 6: Observability and release gate

- [ ] Write `tests/integration/report.observability.test.ts`.
- [ ] Add safe report observability.
- [ ] Add `docs/development/p5c-reporting.md`.
- [ ] Update README roadmap to P5 complete only after fresh full CI green.
- [ ] Run Prisma validate/generate/migrations, TypeScript, Vitest, build, production audit and Chromium E2E.
- [ ] Range-review main..P5 head for P5-only scope and P6 boundary.
