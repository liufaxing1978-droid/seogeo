# P11 V1 Integration Verification

## Status

**VERIFIED INTEGRATION CANDIDATE — ready only for a separate main-merge authorization gate.**

This document verifies the complete approved P11 V1 stack together with the current `main` fixes on one integration candidate. It does **not** authorize merge to `main` and does **not** authorize deployment.

## Integrated P11 stack

The verified stack is:

```text
P11-01 Keyword Demand Capture
  -> P11-02A Official Search Evidence
  -> P11-02B Official Search Sync & Query Discovery
  -> P11-02C Current SERP Observation & Rank Tracking
```

Draft PR chain:

- #182 — P11-01 Keyword Demand Capture
- #186 — P11-02A Official Search Evidence
- #187 — P11-02B Official Search Sync & Query Discovery
- #188 — P11-02C Current SERP Observation & Rank Tracking

All four feature PRs remained Draft/open/unmerged during integration verification.

## Pinned integration inputs

- P11-02C closure input: `9f785b6b36a8dd50131412a9b57ec0db15942429`
- Current main input: `2ff7a8551b46140714e7af918b36ac3fb87c08c8`
- Original common merge base before reconciliation: `2136087a5ae74b474b1b191b4ef957b4c7b61e96`
- Integration branch: `integration/p11-v1-closure`
- Draft integration PR: #189 — `P11 V1 Integration Closure`

At integration start, the P11 closure branch had diverged from current main:

```text
status = diverged
ahead_by = 166
behind_by = 3
```

Therefore the feature-level green CI evidence could not by itself be used as the final P11 V1 integration evidence.

## Main-only fixes reconciled

The three current-main commits absent from the P11 closure input were:

1. `801dbd9427844793f98eaa5f61d1bf502dfbf31f` — `fix: accept fenced structured AI JSON`
2. `89bea6d0fcaaeb5c938ecf467640e0cbf5e7b294` — `fix: use real report references in AI summary prompt`
3. `2ff7a8551b46140714e7af918b36ac3fb87c08c8` — `fix: keep single project navigation active from project list`

Main-only changed paths were reviewed against P11 before reconciliation.

The only meaningful semantic overlap was `src/modules/ai/prompts/prompt-registry.ts`:

- P11 added the `KEYWORD_EXPANSION` prompt path and its advisory/human-authority constraints;
- main changed project-report prompt behavior to use the real persisted report source reference.

The reconciled file preserves both behaviors.

The other main fixes were carried forward without broadening P11 scope:

- fenced-but-valid structured AI JSON remains accepted while schema/source-reference checks remain enforced;
- one-accessible-project navigation context remains preserved;
- report-summary prompt examples/reference validation use real persisted report references.

Reconciliation commit:

`62b7e621b147dec0a78f1fc69a10fed76e0992d9`

Integration merge-parent commit:

`8fb5ca2282878d1b2b1a1042ea42a433492b7d69`

Parents:

1. `62b7e621b147dec0a78f1fc69a10fed76e0992d9`
2. `2ff7a8551b46140714e7af918b36ac3fb87c08c8`

This recorded current `main` as an ancestor without changing `main` or the Draft P11 feature branches.

## Ancestry verification before closure docs

Fresh comparison of current `main` to `integration/p11-v1-closure` after reconciliation:

```text
status = ahead
ahead_by = 170
behind_by = 0
merge_base = 2ff7a8551b46140714e7af918b36ac3fb87c08c8
```

Current `main` was rechecked and remained exactly:

`2ff7a8551b46140714e7af918b36ac3fb87c08c8`

## Exact-head integration CI

Candidate head:

`8fb5ca2282878d1b2b1a1042ea42a433492b7d69`

CI:

- workflow: CI
- run number: **#2436**
- run ID: **33411347882**
- result: **completed / success**

### verify

All required verify steps passed:

- Prisma validate: success
- Prisma generate: success
- Prisma migrate deploy: success
- Typecheck: success
- Full Vitest: **400/400 files passed**
- Full Vitest: **1881/1881 tests passed**
- Build: success

The integrated main regressions were explicitly covered by the green suite, including:

- `tests/unit/ai.report-prompt.test.ts`
- `tests/unit/ai.structured-output.test.ts`

P11 keyword/search/ranking contracts also remained green.

### e2e

Playwright result:

- **41/41 passed**

The browser suite includes P11 user-facing contracts such as:

- operator captures `符纸` demand and sees truthful coverage;
- persisted Google official search evidence renders without fabricating current rank;
- advisory keyword suggestions require explicit accept/reject;
- discovered real search queries require explicit human review/type choice;
- Keyword Center remains usable at tablet width.

### remaining required jobs

- deployment-artifact: success
- production-audit: success

The general dependency installation step still reports 3 high-severity vulnerabilities. This integration does **not** claim a zero-vulnerability dependency tree. The repository's dedicated deployable-runtime `production-audit` gate is green.

## Cross-stack truth and authority review

The exact integration candidate preserves the following P11 guarantees:

### Keyword authority

- manual/project-owned and explicitly human-accepted Keywords are authoritative;
- AI keyword expansion remains advisory;
- AI suggestions cannot silently create authoritative keywords;
- discovered provider queries require human acceptance before becoming authoritative Keywords.

### Coverage/search evidence

- coverage is derived from persisted site facts;
- `UNKNOWN != NONE`;
- coverage is not ranking;
- official Google/Bing provider facts retain provider provenance and evidence state.

### Official vs current rank

- Google Search Console/Bing Webmaster average position remains an official provider metric;
- realtime/current SERP position remains a separate observation semantic;
- not-found-inside-depth remains `position = null`, never a fabricated 101 or similar value;
- provider/config/secret failures remain fail closed;
- realtime SearchFact materialization remains idempotent.

### Side-effect boundaries

Keyword/search/rank reads and observations do not gain unauthorized crawler, AI, content, publication, distribution, merge, deployment or rollback side effects.

### Main regression preservation

The integration also preserves current-main behavior for:

- fenced structured AI JSON;
- persisted report source references;
- sole-project navigation context.

## Scope review

No new product feature was added during integration closure. Specifically excluded:

- P11-03;
- competitor rank expansion;
- scheduled/current-rank polling expansion;
- rank alerts;
- new realtime lane persistence schema;
- Production credentials;
- automatic main merge;
- Production deployment.

## Draft/merge/deploy state

At this verification gate:

- #182: Draft/open/unmerged
- #186: Draft/open/unmerged
- #187: Draft/open/unmerged
- #188: Draft/open/unmerged
- #189: Draft integration-only PR, not authorized for merge
- `main`: unchanged by this integration work
- Production: unchanged/not deployed by this work

## Final documentation-head rule

This document and the P11-02C closure document change the integration branch HEAD. Therefore this pre-document candidate evidence is not the final closure evidence by itself.

A fresh full CI run must pass on the exact documentation head, and the current-main comparison must again show `behind_by = 0` before final P11 V1 integration closure can be declared.

## Decision at pre-document candidate

The code integration candidate `8fb5ca2282878d1b2b1a1042ea42a433492b7d69` is fully green and contains current main by ancestry.

Final P11 V1 integration closure remains contingent only on fresh exact-head CI and ancestry/PR-state rechecks after these verification documents are committed.
