# P10 UI-03 SEO + GEO/Visibility + AI Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Productize the existing SEO, GEO/AI Visibility, and DeepSeek AI Analysis centers on top of the verified UI-02 shell while preserving all P0-P10 fact, access, and automation semantics.

**Architecture:** Keep the existing Express + EJS routes, repositories, services, persisted facts, CSRF, RBAC, feature gates, and P8/P9 authority unchanged. Modernize only server-rendered view hierarchy and shared CSS, add a GEO/Visibility secondary-navigation partial, and extend contract/browser tests so the new presentation cannot collapse GEO Readiness into AI Visibility or turn advisory AI output into factual authority.

**Tech Stack:** Express 5, EJS, TypeScript, Prisma, Vitest, Playwright, existing `src/public/css/p10.css`; no new frontend framework or runtime dependency.

**Spec:** `docs/superpowers/specs/2026-08-26-p10-ui-productization-design.md`

## Global Constraints

- Scope is P10 UI-03 only: SEO Center + GEO / Visibility + AI Analysis Center.
- Reference images `04-seo-center.jpg`, `05-geo-visibility.jpg`, and `06-ai-analysis.jpg` define visual hierarchy only; they are not data, route, permission, workflow, or status authorities.
- Runtime values must come from existing server-provided persisted facts. Unknown/unavailable values remain `--`, `—`, `暂无数据`, `UNKNOWN`, `NO_DATA`, or another existing explicit state; never manufacture zero, rankings, traffic, trends, tasks, citations, users, or provider results.
- GEO Readiness and AI Visibility are separate measurements. Mention Rate, Citation Rate, Share of Voice, evidence coverage, metric statuses, and comparison deltas retain their existing P6 semantics.
- Official Provider API sampling is not equivalent to consumer-product web ranking or display.
- DeepSeek/AI output remains advisory. Do not expose provider reasoning, API keys, raw private fact packs, or make AI output authoritative for deterministic SEO/GEO facts.
- Preserve project membership filtering, OWNER/ADMIN/OPERATOR/VIEWER authorization, CSRF, plan/feature gates, session behavior, immutable P8/P9 boundaries, and human merge/deploy requirements.
- Do not modify `prisma/schema.prisma`, `src/auth/**`, or P0-P10 service/repository/API semantics for visual convenience.
- Do not add React/Next/Vue, external icon/font dependencies, global fake search/notifications, production deployment, or any P11 work.
- Every task follows RED -> exact-head CI evidence -> minimal GREEN -> exact-head full CI evidence. Stop and debug root cause before any speculative fix.

---

### Task 1: Lock UI-03 presentation and truth contracts

**Files:**
- Create: `tests/unit/p10-ui-03-analysis-centers.contract.test.ts`
- Read only: `src/views/seo/audit.ejs`
- Read only: `src/views/geo/overview.ejs`
- Read only: `src/views/visibility/index.ejs`
- Read only: `src/views/ai/index.ejs`
- Read only: `src/public/css/p10.css`

**Interfaces:**
- Consumes: existing EJS locals already rendered by SEO/GEO/Visibility/AI routes; no new backend interface.
- Produces: source-level contracts for the CSS and `data-ui` markers that Tasks 2-4 must satisfy.

- [ ] **Step 1: Write the failing source contract**

Create `tests/unit/p10-ui-03-analysis-centers.contract.test.ts` with these assertions:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(path: string) {
  return readFileSync(resolve(process.cwd(), path), 'utf8');
}

describe('P10 UI-03 analysis-center productization contract', () => {
  it('gives the three analysis centers explicit product surfaces', () => {
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

  it('keeps GEO readiness, visibility, and AI authority boundaries visible', () => {
    const geo = source('src/views/geo/overview.ejs');
    const visibility = source('src/views/visibility/index.ejs');
    const ai = source('src/views/ai/index.ejs');

    expect(geo).toContain('GEO Readiness');
    expect(geo).toContain('AI Visibility 与 GEO Readiness');
    expect(visibility).toContain('官方 Provider API');
    expect(visibility).toContain('UNKNOWN / NO_DATA');
    expect(ai).toContain('AI 只分析已保存事实');
    expect(ai).not.toContain('provider reasoning');
  });

  it('ships reusable analysis-center visual primitives', () => {
    const css = source('src/public/css/p10.css');

    for (const selector of [
      '.analysis-center',
      '.analysis-hero',
      '.analysis-metric-grid',
      '.analysis-subnav',
      '.analysis-evidence-note',
      '.analysis-table-panel',
    ]) {
      expect(css).toContain(selector);
    }
  });
});
```

- [ ] **Step 2: Run the focused Vitest contract and verify RED**

Run:

```bash
npm test -- --run tests/unit/p10-ui-03-analysis-centers.contract.test.ts
```

Expected: FAIL only because the new `data-ui` markers / UI-03 CSS primitives do not yet exist.

- [ ] **Step 3: Commit RED only**

```bash
git add tests/unit/p10-ui-03-analysis-centers.contract.test.ts
git commit -m "test(ui): define UI-03 analysis center contract"
```

- [ ] **Step 4: Capture exact-head CI evidence**

Expected exact-head behavior: `production-audit` and existing E2E remain green; `verify` fails only at the new source contract. Record the run, exact SHA, and failure scope in the UI-03 PR conversation before Task 2.

---

### Task 2: Productize SEO Center without inventing ranking facts

**Files:**
- Modify: `src/views/seo/audit.ejs`
- Modify: `src/views/seo/issues.ejs`
- Modify: `src/views/seo/compare.ejs`
- Modify: `src/views/seo/issue-show.ejs`
- Modify: `src/public/css/p10.css`
- Modify: `tests/unit/p10-ui-03-analysis-centers.contract.test.ts`
- Modify: `tests/e2e/seo-audit.spec.ts`

**Interfaces:**
- Consumes: existing locals `project`, `latestCompletedCrawl`, `audit`, `score`, `severityCounts`, `components`, `topIssues`, plus the existing issue/compare locals already rendered by their routes.
- Produces: a productized deterministic SEO workspace; no new route or backend type.

- [ ] **Step 1: Extend the RED contract for SEO hierarchy**

Add assertions requiring the audit view to expose:

```ts
expect(seo).toContain('data-ui="seo-center"');
expect(seo).toContain('data-ui="seo-score-summary"');
expect(seo).toContain('data-ui="seo-severity-summary"');
expect(seo).toContain('data-ui="seo-evidence-table"');
expect(seo).toContain('data-ui="seo-issues-table"');
expect(seo).not.toContain('关键词排名');
expect(seo).not.toContain('Keyword Ranking');
```

Keep the current deterministic wording that issues come from FAIL rule results rather than AI inference.

- [ ] **Step 2: Run the focused contract and verify RED**

```bash
npm test -- --run tests/unit/p10-ui-03-analysis-centers.contract.test.ts
```

Expected: FAIL on the new SEO markers; existing semantic text remains present.

- [ ] **Step 3: Implement the minimal SEO product hierarchy**

Refactor `src/views/seo/audit.ejs` only at presentation level:

- Wrap the page in `<section class="analysis-center seo-center" data-ui="seo-center">`.
- Replace the old generic header with `.analysis-hero`: title `SEO 中心`, project/domain context, and only the existing `运行 SEO 审计` / `先运行抓取` / `问题中心` actions.
- For a completed audit, show `SEO Score` as the primary card (`data-ui="seo-score-summary"`) and Critical/High/Medium/Low as a secondary severity grid (`data-ui="seo-severity-summary"`).
- Preserve `score.change === null` as “首次可解释评分”; do not derive a trend chart from one or two values.
- Wrap deterministic scoring components with `data-ui="seo-evidence-table"` and top issues with `data-ui="seo-issues-table"`.
- Keep empty state “尚无 SEO 审计” and source-crawl provenance.
- Replace the stale “AI 将在后续…” sentence with present-tense authority wording: AI analysis is available through the separate AI center but does not decide SEO facts.
- Modernize `issues.ejs`, `compare.ejs`, and `issue-show.ejs` with the same `.analysis-center` / `.analysis-table-panel` surface without changing issue lifecycle/status values, comparison logic, routes, or actions.

Add only the reusable UI-03 CSS needed by the markup:

```css
.analysis-center{display:grid;gap:18px}
.analysis-hero{display:flex;justify-content:space-between;gap:24px;align-items:flex-end;padding:24px;border:1px solid var(--ui-border);border-radius:var(--ui-radius-panel);background:linear-gradient(145deg,#fff 0%,#f7faff 100%);box-shadow:var(--ui-shadow-card)}
.analysis-hero h1{margin:4px 0 8px;font-size:32px;letter-spacing:-.04em}
.analysis-metric-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.analysis-evidence-note{padding:12px 14px;border:1px solid #dbe7ff;border-radius:12px;background:var(--ui-primary-soft);color:#344e7a;font-size:12px;line-height:1.6}
.analysis-table-panel{overflow:hidden}
```

- [ ] **Step 4: Preserve browser behavior and add SEO product assertions**

In `tests/e2e/seo-audit.spec.ts`, keep the persisted 92.5 score and Missing title drill-down. Add:

```ts
await expect(main.locator('[data-ui="seo-center"]')).toBeVisible();
await expect(main.locator('[data-ui="seo-score-summary"]')).toContainText('92.5');
await expect(main.locator('[data-ui="seo-evidence-table"]')).toBeVisible();
await expect(main.getByText('关键词排名')).toHaveCount(0);
```

Do not change fixture facts to match the reference image.

- [ ] **Step 5: Run focused tests and then full exact-head CI**

Run locally where available:

```bash
npm test -- --run tests/unit/p10-ui-03-analysis-centers.contract.test.ts
npm run test:e2e -- tests/e2e/seo-audit.spec.ts
npm run typecheck
npm run build
```

Then use the branch exact-head CI as authority. Expected: `verify`, `production-audit`, and `e2e` all green.

- [ ] **Step 6: Commit and record GREEN evidence**

```bash
git add src/views/seo src/public/css/p10.css tests/unit/p10-ui-03-analysis-centers.contract.test.ts tests/e2e/seo-audit.spec.ts
git commit -m "feat(ui): productize SEO center"
```

Record exact SHA + CI run in the PR before Task 3.

---

### Task 3: Productize GEO + AI Visibility as one navigation center but separate measurements

**Files:**
- Create: `src/views/partials/geo-center-nav.ejs`
- Modify: `src/views/geo/overview.ejs`
- Modify: `src/views/geo/citability.ejs`
- Modify: `src/views/geo/entities.ejs`
- Modify: `src/views/geo/ai-crawlers.ejs`
- Modify: `src/views/visibility/index.ejs`
- Modify: `src/views/visibility/history.ejs`
- Modify: `src/views/visibility/alerts.ejs`
- Modify: `src/views/visibility/prompts.ejs`
- Modify: `src/views/visibility/citations.ejs`
- Modify: `src/views/visibility/subjects.ejs`
- Modify: `src/views/visibility/metrics.ejs`
- Modify: `src/public/css/p10.css`
- Modify: `tests/unit/p10-ui-03-analysis-centers.contract.test.ts`
- Modify: `tests/e2e/visibility-center.spec.ts`
- Modify: `tests/e2e/visibility-history.spec.ts`
- Modify: `tests/e2e/visibility-metrics.spec.ts`

**Interfaces:**
- Consumes: existing project-scoped GEO and Visibility routes and their current EJS locals. The nav partial receives only existing `project.id` and `activeNav` locals.
- Produces: consistent center-level navigation and hierarchy while preserving every existing P3/P6 metric/status/provenance field.

- [ ] **Step 1: Add RED contracts for the center navigation and measurement boundary**

Extend the unit contract:

```ts
const nav = source('src/views/partials/geo-center-nav.ejs');
expect(nav).toContain(`/projects/<%= project.id %>/geo`);
expect(nav).toContain(`/projects/<%= project.id %>/visibility`);
expect(nav).toContain('GEO Readiness');
expect(nav).toContain('AI Visibility');
expect(geo).toContain('data-ui="geo-readiness-summary"');
expect(visibility).toContain('data-ui="visibility-metrics-summary"');
expect(visibility).toContain('Owned Mention Rate');
expect(visibility).toContain('Owned Citation Rate');
expect(visibility).toContain('Owned Mention SOV');
expect(visibility).toContain('Evidence Coverage');
expect(visibility).not.toContain('ChatGPT 网页端排名');
```

- [ ] **Step 2: Run focused contract and verify RED**

```bash
npm test -- --run tests/unit/p10-ui-03-analysis-centers.contract.test.ts
```

Expected: FAIL because the partial and new markers do not exist.

- [ ] **Step 3: Create truthful GEO center subnavigation**

Create `src/views/partials/geo-center-nav.ejs` as a server-rendered nav with real routes only:

```ejs
<nav class="analysis-subnav" aria-label="GEO 与 AI Visibility">
  <a href="/projects/<%= project.id %>/geo" <%- activeNav === 'geo' ? 'aria-current="page"' : '' %>>GEO Readiness</a>
  <a href="/projects/<%= project.id %>/geo/citability" <%- activeNav === 'geo-citability' ? 'aria-current="page"' : '' %>>Citability</a>
  <a href="/projects/<%= project.id %>/geo/entities" <%- activeNav === 'geo-entities' ? 'aria-current="page"' : '' %>>Entity</a>
  <a href="/projects/<%= project.id %>/geo/ai-crawlers" <%- activeNav === 'geo-ai-crawlers' ? 'aria-current="page"' : '' %>>AI Crawler</a>
  <a href="/projects/<%= project.id %>/visibility" <%- activeNav === 'visibility' ? 'aria-current="page"' : '' %>>AI Visibility</a>
  <a href="/projects/<%= project.id %>/visibility/history" <%- activeNav === 'visibility-history' ? 'aria-current="page"' : '' %>>历史</a>
  <a href="/projects/<%= project.id %>/visibility/alerts" <%- activeNav === 'visibility-alerts' ? 'aria-current="page"' : '' %>>告警</a>
  <a href="/projects/<%= project.id %>/visibility/prompts" <%- activeNav === 'visibility-prompts' ? 'aria-current="page"' : '' %>>Prompt</a>
  <a href="/projects/<%= project.id %>/visibility/citations" <%- activeNav === 'visibility-citations' ? 'aria-current="page"' : '' %>>引用</a>
  <a href="/projects/<%= project.id %>/visibility/subjects" <%- activeNav === 'visibility-subjects' ? 'aria-current="page"' : '' %>>主体</a>
  <a href="/projects/<%= project.id %>/visibility/metrics" <%- activeNav === 'visibility-metrics' ? 'aria-current="page"' : '' %>>指标</a>
</nav>
```

Before committing, audit the actual `activeNav` values in the route locals. If an existing value differs, use the existing value; do not change route semantics merely to fit this snippet.

- [ ] **Step 4: Productize GEO Readiness pages**

For `geo/overview.ejs`:

- wrap with `data-ui="geo-readiness-center"`;
- include the new nav partial;
- keep GEO score, Citability, Entity Authority, Technical AI Readiness, Brand, Content GEO, and the explicit AI Visibility unavailable/feature state;
- mark the deterministic metric group `data-ui="geo-readiness-summary"`;
- retain `UNKNOWN` for null crawler facts and never coerce to zero;
- retain the explicit “AI Visibility 与 GEO Readiness 是两个指标” evidence note.

Apply the same center nav and product panel/table styling to Citability, Entity, and AI Crawler pages without changing facts or actions.

- [ ] **Step 5: Productize AI Visibility pages**

For `visibility/index.ejs`:

- wrap with `data-ui="visibility-center"`;
- include the new GEO center nav;
- replace phase-first eyebrow text with user-facing `GEO / AI Visibility` while keeping formula/provider metadata in data panels;
- retain the official Provider API sampling disclaimer;
- put the latest completed snapshot metrics into `data-ui="visibility-metrics-summary"` using existing ratios/statuses only;
- retain measurement window, input cutoff, provider coverage, extractor version, comparison id/deltas, open alert count, budget/configuration, providers, and recent runs;
- no consumer-product ranking labels or fabricated charts.

Apply the same subnav/panel hierarchy to history, alerts, prompts, citations, subjects, and metrics. Preserve every existing page-specific status and no-data behavior.

Add CSS:

```css
.analysis-subnav{display:flex;gap:6px;overflow-x:auto;padding:5px;border:1px solid var(--ui-border);border-radius:13px;background:var(--ui-surface);scrollbar-width:thin}
.analysis-subnav a{white-space:nowrap;min-height:34px;display:inline-flex;align-items:center;padding:0 11px;border-radius:9px;color:var(--ui-text-secondary);font-size:12px;font-weight:680}
.analysis-subnav a[aria-current="page"]{background:var(--ui-primary-soft);color:var(--ui-primary)}
```

- [ ] **Step 6: Extend browser acceptance without weakening existing semantics**

Keep all current `visibility-center.spec.ts` assertions and add visibility of the center/subnav markers. Keep the existing assertion that Prompt configuration does not create a sampling run.

Extend history/metrics browser tests so they confirm:

- `GEO / 可见度` remains the active first-level center;
- no page displays consumer-product ranking claims;
- unknown metric states remain textual statuses, not numeric zero;
- Mention/Citation/SOV values still come from persisted snapshots and coverage remains visible.

- [ ] **Step 7: Run focused tests, full exact-head CI, commit, and record evidence**

Run:

```bash
npm test -- --run tests/unit/p10-ui-03-analysis-centers.contract.test.ts
npm run test:e2e -- tests/e2e/visibility-center.spec.ts tests/e2e/visibility-history.spec.ts tests/e2e/visibility-metrics.spec.ts
npm run typecheck
npm run build
```

Then require all exact-head CI jobs green.

Commit:

```bash
git add src/views/geo src/views/visibility src/views/partials/geo-center-nav.ejs src/public/css/p10.css tests/unit/p10-ui-03-analysis-centers.contract.test.ts tests/e2e/visibility-center.spec.ts tests/e2e/visibility-history.spec.ts tests/e2e/visibility-metrics.spec.ts
git commit -m "feat(ui): productize GEO and visibility center"
```

---

### Task 4: Productize DeepSeek AI Analysis Center as an advisory workspace

**Files:**
- Modify: `src/views/ai/index.ejs`
- Modify: `src/views/ai/task-show.ejs`
- Modify: `src/public/css/p10.css`
- Modify: `tests/unit/p10-ui-03-analysis-centers.contract.test.ts`
- Modify: `tests/e2e/ai-analysis.spec.ts`

**Interfaces:**
- Consumes: existing `latestSeoAudit`, `latestGeoAudit`, `tasks`, task runs/results, current POST actions `/ai/seo`, `/ai/geo`, `/ai/entity`.
- Produces: a productized advisory workbench; no new provider invocation, persisted field, or authority.

- [ ] **Step 1: Extend RED contract for AI advisory hierarchy**

Add:

```ts
expect(ai).toContain('data-ui="ai-analysis-center"');
expect(ai).toContain('data-ui="ai-advisory-boundary"');
expect(ai).toContain('data-ui="ai-analysis-actions"');
expect(ai).toContain('data-ui="ai-task-history"');
expect(ai).toContain('AI 只分析已保存事实');
expect(ai).not.toContain('API Key');
expect(ai).not.toContain('思维链');
```

- [ ] **Step 2: Run focused contract and verify RED**

```bash
npm test -- --run tests/unit/p10-ui-03-analysis-centers.contract.test.ts
```

Expected: FAIL only on new AI product markers.

- [ ] **Step 3: Implement minimal advisory-workspace layout**

In `ai/index.ejs`:

- wrap with `<section class="analysis-center ai-analysis-center" data-ui="ai-analysis-center">`;
- use an `.analysis-hero` with project/domain context and the existing SEO/GEO navigation links;
- turn the existing “AI 只分析已保存事实” panel into a prominent `data-ui="ai-advisory-boundary"` callout;
- group SEO Analysis, GEO Analysis, and Entity Enrichment into `data-ui="ai-analysis-actions"`; preserve READY/`--` eligibility and the existing POST actions exactly;
- keep AI Visibility explicitly outside P4 authority rather than inventing an AI visibility result;
- wrap persisted task history in `data-ui="ai-task-history"`; keep provider/model route, prompt version, persisted summary/error, created time, and empty state;
- remove inline `style="margin-top:12px"` in favor of a reusable CSS class; do not add client-side behavior.

In `ai/task-show.ejs`, use the same analysis center hierarchy and preserve persisted result fields only. Do not expose raw provider reasoning or private fact payloads.

- [ ] **Step 4: Extend Standard-plan browser acceptance**

Keep all existing `tests/e2e/ai-analysis.spec.ts` behavior and add:

```ts
const main = page.getByRole('main');
await expect(main.locator('[data-ui="ai-analysis-center"]')).toBeVisible();
await expect(main.locator('[data-ui="ai-advisory-boundary"]')).toContainText('AI 只分析已保存事实');
await expect(main.locator('[data-ui="ai-task-history"]')).toContainText('尚无 AI 分析任务');
await expect(main.getByText('API Key')).toHaveCount(0);
```

The test must still make no provider call.

- [ ] **Step 5: Run focused tests, full exact-head CI, commit, and record evidence**

```bash
npm test -- --run tests/unit/p10-ui-03-analysis-centers.contract.test.ts
npm run test:e2e -- tests/e2e/ai-analysis.spec.ts
npm run typecheck
npm run build
```

Commit:

```bash
git add src/views/ai src/public/css/p10.css tests/unit/p10-ui-03-analysis-centers.contract.test.ts tests/e2e/ai-analysis.spec.ts
git commit -m "feat(ui): productize AI analysis center"
```

Require `verify`, `production-audit`, and `e2e` green at this exact head before Task 5.

---

### Task 5: Deterministic browser screenshots and responsive acceptance

**Files:**
- Create: `tests/e2e/p10-ui-03-screenshots.spec.ts`
- Modify only if a real visual defect is demonstrated: `src/public/css/p10.css`

**Interfaces:**
- Consumes: existing E2E authentication/fixture helpers and UI-03 pages.
- Produces: deterministic screenshots for SEO, GEO/Visibility, and AI Analysis at approved desktop viewport; no live public provider dependency.

- [ ] **Step 1: Write browser acceptance before CSS polish**

Create a Playwright spec that authenticates a local OWNER fixture, creates/uses local persisted fixture facts where existing helpers permit, sets `1440x1000`, and captures:

```ts
await page.screenshot({ path: 'p10-ui-03-seo.png', fullPage: true, animations: 'disabled' });
await page.screenshot({ path: 'p10-ui-03-visibility.png', fullPage: true, animations: 'disabled' });
await page.screenshot({ path: 'p10-ui-03-ai.png', fullPage: true, animations: 'disabled' });
```

For pages where generating full metric facts would require invoking an external provider, use truthful local empty/no-data state instead. Never stub a production bypass solely to make the screenshot look populated.

Add overflow checks at 1440 and 820 widths:

```ts
const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
expect(overflow).toBe(false);
```

- [ ] **Step 2: Run the screenshot spec and inspect every output**

```bash
npm run test:e2e -- tests/e2e/p10-ui-03-screenshots.spec.ts
```

Compare visually against:

- `docs/ui/reference/04-seo-center.jpg`
- `docs/ui/reference/05-geo-visibility.jpg`
- `docs/ui/reference/06-ai-analysis.jpg`

Evaluate hierarchy, spacing, density, card geometry, table legibility, and semantic color usage. Treat unsupported screenshot metrics/charts as intentional differences when no truthful system fact exists.

- [ ] **Step 3: Make only evidence-backed CSS corrections**

If inspection demonstrates a concrete defect, modify only relevant UI-03 selectors in `p10.css`; examples include card wrapping, subnav overflow, table padding, or mobile stacking. Do not alter data/rendering semantics for pixel matching.

- [ ] **Step 4: Re-run screenshot and affected browser tests**

```bash
npm run test:e2e -- tests/e2e/p10-ui-03-screenshots.spec.ts tests/e2e/seo-audit.spec.ts tests/e2e/visibility-center.spec.ts tests/e2e/visibility-history.spec.ts tests/e2e/visibility-metrics.spec.ts tests/e2e/ai-analysis.spec.ts
```

Expected: all pass, no supported-width horizontal page overflow, screenshots render truthful data/empty states.

- [ ] **Step 5: Commit visual acceptance**

```bash
git add tests/e2e/p10-ui-03-screenshots.spec.ts src/public/css/p10.css
git commit -m "test(ui): add UI-03 visual acceptance"
```

---

### Task 6: UI-03 code review, exact-head closure, merge, and post-merge main proof

**Files:**
- Review all files changed between `main@e6e523b4dc9d8c8750f41b0c74bb9f14f0c4d51e` and the final UI-03 head.
- No production files should change during this task unless review or CI proves a defect.

**Interfaces:**
- Consumes: final UI-03 branch and all Task 1-5 evidence.
- Produces: reviewed, merged UI-03 on `main` with fresh post-merge CI evidence.

- [ ] **Step 1: Review the complete branch diff against the spec**

Confirm line-by-line:

- only UI-03 views/CSS/tests/docs changed unless a separately justified fix exists;
- no schema/API/auth/service/repository authority expansion;
- no fabricated SEO ranking/traffic/trend data;
- GEO Readiness is never relabeled as AI Visibility;
- P6 metric statuses/coverage/provenance remain visible and unknown is never coerced to zero;
- AI remains advisory and no provider reasoning/API keys/private fact packs are rendered;
- no dead links or `href="#"`;
- no unresolved PR review threads.

- [ ] **Step 2: Run the final exact-head gates**

Require fresh GitHub CI on one immutable final SHA:

- `verify` ✅ including Prisma validate/generate/migrate, Typecheck, Full Vitest, Build;
- `production-audit` ✅;
- `e2e` ✅ including all browser smoke tests and UI-03 screenshots/artifact upload.

Do not declare UI-03 complete from an earlier commit or partial job result.

- [ ] **Step 3: Inspect final screenshot artifacts**

Download and visually inspect SEO / GEO-Visibility / AI screenshots from the same final exact-head run. Record artifact ids/digests when available.

- [ ] **Step 4: Mark PR ready and merge with expected-head guard**

Only after review + exact-head proof, merge the UI-03 PR to `main` using the exact verified head SHA. Do not deploy production.

- [ ] **Step 5: Require post-merge main CI**

On the merge commit, require the fresh push CI to finish:

- `verify` ✅;
- `production-audit` ✅;
- `e2e` ✅.

Only then close UI-03 and proceed to UI-04. Do not start P11.
