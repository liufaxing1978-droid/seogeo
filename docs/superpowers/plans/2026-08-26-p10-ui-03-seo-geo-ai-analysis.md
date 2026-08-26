# P10 UI-03 SEO + GEO/Visibility + AI Analysis Implementation Plan

> Execute task-by-task with Superpowers TDD / executing-plans. Every production change must be preceded by a failing contract and followed by fresh exact-head CI evidence.

**Goal:** Productize the existing SEO, GEO/AI Visibility, and DeepSeek AI Analysis centers on top of the verified UI-02 shell without changing P0-P10 business, access, measurement, or automation semantics.

**Base:** `main@e6e523b4dc9d8c8750f41b0c74bb9f14f0c4d51e` (UI-02 post-merge CI #2145 green).

**Spec:** `docs/superpowers/specs/2026-08-26-p10-ui-productization-design.md`

## Non-negotiable boundaries

- P10 UI-03 only: SEO Center + GEO / AI Visibility + AI Analysis Center. No P11 and no production deployment.
- Views/CSS/tests only by default. Do not change schema, auth, repository/service/API semantics, RBAC, CSRF, sessions, feature gates, or P8/P9 authority for visual convenience.
- Runtime UI values come from existing persisted facts. Missing/unknown remains `--`, `—`, `暂无数据`, `UNKNOWN`, `NO_DATA`, or the existing explicit status. Never manufacture rankings, traffic, trends, citations, tasks, provider results, users, or activity.
- SEO is deterministic rule/audit truth. The reference screenshot is visual guidance only; do not invent keyword-ranking charts.
- GEO Readiness and AI Visibility are separate measurements. P6 Mention Rate, Citation Rate, SOV, evidence coverage/status/provenance/comparison semantics remain unchanged.
- Official Provider API sampling is not consumer-product web ranking/display.
- DeepSeek/AI remains advisory and analyses saved facts only. Preserve the truthful safety notice that raw fact packs, API keys, and provider reasoning are not exposed. **Do not use absence of the words “API Key” or “provider reasoning” as a security contract**, because the safety notice legitimately contains those terms.
- No React/Next/Vue rewrite, external fonts/icons, fake global search/notifications, auto merge/deploy/rollback.

## Verified route facts used by this plan

- SEO pages in `src/web/routes.ts` use `activeNav: 'seo'`.
- GEO overview, Citability, Entity, and AI Crawler pages all use the same `activeNav: 'geo'` even though their URLs differ.
- Therefore GEO second-level active state **must not** infer the subpage from `activeNav`. Each GEO template will pass a view-only `geoCenterActive` value to the shared partial; no route/backend change is required.
- Visibility routes already expose distinct values: `visibility`, `visibility-history`, `visibility-alerts`, `visibility-prompts`, `visibility-citations`, `visibility-subjects`, `visibility-metrics`.
- AI Center uses `activeNav: 'ai'`.

---

## Task 1 — Lock UI-03 presentation and truth contracts (RED)

**Create:** `tests/unit/p10-ui-03-analysis-centers.contract.test.ts`

The first test-only commit must require these future surfaces while preserving existing authority wording:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('P10 UI-03 analysis-center productization contract', () => {
  it('defines explicit SEO, GEO, Visibility, and AI product surfaces', () => {
    const seo = source('src/views/seo/audit.ejs');
    const geo = source('src/views/geo/overview.ejs');
    const visibility = source('src/views/visibility/index.ejs');
    const ai = source('src/views/ai/index.ejs');

    expect(seo).toContain('data-ui="seo-center"');
    expect(seo).toContain('data-ui="seo-score-summary"');
    expect(geo).toContain('data-ui="geo-readiness-center"');
    expect(geo).toContain('data-ui="geo-readiness-summary"');
    expect(visibility).toContain('data-ui="visibility-center"');
    expect(visibility).toContain('data-ui="visibility-metrics-summary"');
    expect(ai).toContain('data-ui="ai-analysis-center"');
    expect(ai).toContain('data-ui="ai-advisory-boundary"');
  });

  it('keeps measurement and AI authority boundaries explicit', () => {
    const geo = source('src/views/geo/overview.ejs');
    const visibility = source('src/views/visibility/index.ejs');
    const ai = source('src/views/ai/index.ejs');

    expect(geo).toContain('AI Visibility 与 GEO Readiness');
    expect(visibility).toContain('官方 Provider API');
    expect(visibility).toContain('UNKNOWN / NO_DATA');
    expect(ai).toContain('AI 只分析已保存事实');
    expect(ai).toContain('不会展示原始 fact pack、API Key 或 provider reasoning');
  });

  it('ships reusable analysis-center primitives', () => {
    const css = source('src/public/css/p10.css');
    for (const selector of [
      '.analysis-center', '.analysis-hero', '.analysis-metric-grid',
      '.analysis-subnav', '.analysis-evidence-note', '.analysis-table-panel'
    ]) expect(css).toContain(selector);
  });
});
```

Steps:
- [ ] Commit only this new contract.
- [ ] Capture exact-head CI. Expected: `verify` fails only at this new test; `production-audit` and existing E2E remain green.
- [ ] Record RED SHA/run in the Draft PR before touching production views.

---

## Task 2 — Productize deterministic SEO Center

**Modify:** `src/views/seo/audit.ejs`, `issues.ejs`, `compare.ejs`, `issue-show.ejs`, `src/public/css/p10.css`, unit contract, `tests/e2e/seo-audit.spec.ts`.

RED additions must require:
- `data-ui="seo-center"`
- `data-ui="seo-score-summary"`
- `data-ui="seo-severity-summary"`
- `data-ui="seo-evidence-table"`
- `data-ui="seo-issues-table"`
- no invented `关键词排名` / `Keyword Ranking` surface.

GREEN implementation:
- [ ] Wrap SEO pages in `.analysis-center`; use `.analysis-hero` with real project/domain and existing actions only.
- [ ] Make persisted SEO Score the primary summary; Critical/High/Medium/Low are secondary deterministic counts.
- [ ] Keep `score.change === null` as first explainable score; no synthetic trend chart.
- [ ] Keep crawl provenance, engine version, eligible pages/rules, deterministic component table, FAIL-rule issues, empty state, issue status workflow and comparison semantics unchanged.
- [ ] Replace stale future-AI copy only with present authority wording: AI Center can explain saved facts but does not decide SEO facts.
- [ ] Extend Playwright while preserving the existing persisted `92.5` and `Missing title` drill-down.
- [ ] Exact-head `verify` / `production-audit` / `e2e` all green before Task 3.

Reusable CSS may add only presentation primitives, e.g. `.analysis-center`, `.analysis-hero`, `.analysis-metric-grid`, `.analysis-evidence-note`, `.analysis-table-panel`.

---

## Task 3 — Productize GEO + AI Visibility with one secondary navigation, separate measurements

**Create:** `src/views/partials/geo-center-nav.ejs`.

**Modify:** GEO views (`overview`, `citability`, `entities`, `ai-crawlers`), Visibility views (`index`, `history`, `alerts`, `prompts`, `citations`, `subjects`, `metrics`), `p10.css`, unit contract, visibility E2Es.

RED contract must require real links and persisted metric labels only:
- GEO Readiness / Citability / Entity / AI Crawler
- AI Visibility / 历史 / 告警 / Prompt / 引用 / 主体 / 指标
- `Owned Mention Rate`, `Owned Citation Rate`, `Owned Mention SOV`, `Evidence Coverage`
- no consumer-product ranking claim such as `ChatGPT 网页端排名`.

### Active-state rule

The partial accepts `geoCenterActive` for GEO pages and falls back to existing Visibility `activeNav` values for Visibility pages. Each GEO template passes its own view-only value:

```ejs
<%- include('../partials/geo-center-nav', { project, geoCenterActive: 'readiness' }) %>
<%- include('../partials/geo-center-nav', { project, geoCenterActive: 'citability' }) %>
<%- include('../partials/geo-center-nav', { project, geoCenterActive: 'entities' }) %>
<%- include('../partials/geo-center-nav', { project, geoCenterActive: 'ai-crawlers' }) %>
```

The partial uses only real URLs:
`/geo`, `/geo/citability`, `/geo/entities`, `/geo/ai-crawlers`, `/visibility`, `/visibility/history`, `/visibility/alerts`, `/visibility/prompts`, `/visibility/citations`, `/visibility/subjects`, `/visibility/metrics`.

GREEN implementation:
- [ ] GEO overview gets `data-ui="geo-readiness-center"` and `data-ui="geo-readiness-summary"`; keep GEO score, Citability, Entity Authority, Technical AI Readiness, Brand, Content GEO and null/UNKNOWN crawler semantics.
- [ ] Preserve the explicit statement that AI Visibility and GEO Readiness are different metrics.
- [ ] Visibility index gets `data-ui="visibility-center"` and `data-ui="visibility-metrics-summary"`; retain official Provider API disclaimer, latest completed snapshot, measurement window/cutoff/provider coverage/extractor version, comparison deltas, open alerts, budget/config/providers/recent runs.
- [ ] Apply the same secondary navigation/surface hierarchy to all listed GEO/Visibility subpages without changing status/provenance/no-data behavior.
- [ ] Extend `visibility-center`, `visibility-history`, and `visibility-metrics` browser tests; Prompt configuration must still create no sampling side effect.
- [ ] Exact-head all three CI jobs green before Task 4.

---

## Task 4 — Productize DeepSeek AI Analysis as an advisory workspace

**Modify:** `src/views/ai/index.ejs`, `src/views/ai/task-show.ejs`, `p10.css`, unit contract, `tests/e2e/ai-analysis.spec.ts`.

RED additions require:
- `data-ui="ai-analysis-center"`
- `data-ui="ai-advisory-boundary"`
- `data-ui="ai-analysis-actions"`
- `data-ui="ai-task-history"`
- safety callout text `AI 只分析已保存事实`
- safety callout also states `不会展示原始 fact pack、API Key 或 provider reasoning`.

**Do not write tests asserting that the literal words `API Key` or `provider reasoning` are absent.** They are intentionally present in the prohibition notice. Security is preserved by not rendering any secret/raw payload values, not by banning those words from copy.

GREEN implementation:
- [ ] Use `.analysis-hero` with real project/domain context and existing SEO/GEO links.
- [ ] Promote the existing advisory/safety notice to `data-ui="ai-advisory-boundary"`.
- [ ] Group existing SEO Analysis, GEO Analysis, Entity Enrichment POST actions under `data-ui="ai-analysis-actions"`; preserve current eligibility and feature gates.
- [ ] Keep AI Visibility explicitly outside P4 authority.
- [ ] Wrap persisted task history in `data-ui="ai-task-history"`; show only existing provider/model route, prompt version, persisted summary/error/time and current empty state.
- [ ] `task-show.ejs` uses the same hierarchy; no raw fact pack, secret key value or provider reasoning value is introduced.
- [ ] Existing Standard-plan E2E must still open the center with `--` eligibility, `尚无 AI 分析任务`, and no provider invocation. New assertion checks the advisory callout text, not absence of the words “API Key”.
- [ ] Exact-head all three CI jobs green before Task 5.

---

## Task 5 — Deterministic visual and responsive acceptance

**Create:** `tests/e2e/p10-ui-03-screenshots.spec.ts`.

- [ ] Capture deterministic 1440×1000 screenshots: `p10-ui-03-seo.png`, `p10-ui-03-visibility.png`, `p10-ui-03-ai.png`.
- [ ] At 1440 and 820 widths assert no page-level horizontal overflow.
- [ ] Never invoke public AI/search providers merely to make screenshots look populated. Where no local persisted fact exists, show the truthful empty/unknown state.
- [ ] Compare hierarchy/spacing/density against references `04-seo-center.jpg`, `05-geo-visibility.jpg`, `06-ai-analysis.jpg`; unsupported reference charts/metrics are intentional differences.
- [ ] Make CSS corrections only when screenshot evidence demonstrates a concrete layout defect, then rerun affected E2Es.

---

## Task 6 — Review, exact-head closure, merge, post-merge proof

- [ ] Review the complete branch diff against this plan and the approved productization spec.
- [ ] Confirm no schema/API/auth/service/repository authority expansion, no fabricated facts, no GEO/Visibility conflation, no raw AI secret/reasoning data, no dead links, and no unresolved PR review threads.
- [ ] On one immutable final SHA require fresh `verify` ✅ (Prisma + Typecheck + Full Vitest + Build), `production-audit` ✅, and `e2e` ✅ including UI-03 screenshot artifacts.
- [ ] Download and visually inspect final SEO / Visibility / AI screenshots from that same head.
- [ ] Merge the PR to `main` with an expected-head guard only after those checks.
- [ ] Require fresh post-merge `main` CI (`verify` / `production-audit` / `e2e`) all green.
- [ ] Then UI-03 is closed and work may proceed to UI-04. No production deployment and no P11.
