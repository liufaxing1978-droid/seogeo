# P11 V1 Integration Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce and verify one P11 V1 integration candidate that contains the complete approved P11 stack plus the current `main` fixes, without merging to `main` or deploying.

**Architecture:** Work only on `integration/p11-v1-closure`, starting from the verified P11-02C closure head. Reconcile the three main-only fixes, preserve the P11 keyword-expansion prompt changes, then create a merge-parent commit tying the candidate to current `main`. Verify ancestry and run the repository's full exact-head CI before and after closure documentation.

**Tech Stack:** TypeScript, Node.js, Prisma/PostgreSQL, Vitest, Playwright, GitHub Actions, GitHub Git data API.

**Spec:** `docs/superpowers/specs/2026-08-31-p11-v1-integration-closure-design.md`

## Global Constraints

- P11 input head is `9f785b6b36a8dd50131412a9b57ec0db15942429`.
- Main input head is `2ff7a8551b46140714e7af918b36ac3fb87c08c8`.
- Work only on `integration/p11-v1-closure`.
- Preserve all P11 truth/authority boundaries from the approved P11 specs and verification documents.
- Preserve all three main-only fixes.
- No new P11-03 behavior.
- No new realtime lane persistence table.
- No secrets in repository content.
- No merge to `main`.
- No deployment.
- Completion requires fresh exact-head CI plus `behind_by = 0` against current `main`.

---

### Task 1: Reconcile the three main-only fixes

**Files:**
- Modify: `src/modules/ai/prompts/prompt-registry.ts`
- Modify: `src/modules/ai/structured-output.ts`
- Modify: `src/web/routes.ts`
- Modify: `tests/integration/projects.web.test.ts`
- Create or update: `tests/unit/ai.report-prompt.test.ts`
- Modify: `tests/unit/ai.structured-output.test.ts`

**Interfaces:**
- Consumes: P11-02C closure branch content and current main versions of the six files.
- Produces: one content state containing both P11 keyword-expansion behavior and all three main fixes.

- [ ] **Step 1: Read both sides for every overlapping file**

Compare each of the six paths at `9f785b6b36a8dd50131412a9b57ec0db15942429` and `2ff7a8551b46140714e7af918b36ac3fb87c08c8`.

Expected: `src/modules/ai/prompts/prompt-registry.ts` has meaningful edits on both sides; the remaining main-only changes are either absent or non-overlapping in P11.

- [ ] **Step 2: Preserve P11 keyword-expansion prompt registration**

The reconciled `prompt-registry.ts` must still contain the existing P11 `KEYWORD_EXPANSION` prompt path and its structured-output/source-reference authority behavior.

- [ ] **Step 3: Preserve main's real report source-reference fix**

The reconciled report-summary prompt must use the actual persisted report source reference supplied by the input contract and must not restore a placeholder source id.

- [ ] **Step 4: Preserve main's fenced structured-output parser behavior**

`src/modules/ai/structured-output.ts` must accept a complete Markdown `json` fence around otherwise valid structured JSON while retaining schema and source-reference validation.

- [ ] **Step 5: Preserve main's sole-project navigation fix**

`src/web/routes.ts` and `tests/integration/projects.web.test.ts` must preserve the one-accessible-project context used by sidebar navigation.

- [ ] **Step 6: Commit the reconciliation**

Commit message:

```text
chore: reconcile P11 with current main fixes
```

Do not include unrelated cleanup.

### Task 2: Record current main as an integration parent

**Files:**
- No content changes expected.

**Interfaces:**
- Consumes: Task 1 reconciled tree, parent `2ff7a8551b46140714e7af918b36ac3fb87c08c8`.
- Produces: an integration commit whose first parent is the P11 integration branch and whose second parent is current `main`.

- [ ] **Step 1: Fetch the reconciled branch head commit and tree SHA**

Use the exact Task 1 head; do not reuse a stale SHA.

- [ ] **Step 2: Create a two-parent integration commit using the same tree**

Commit message:

```text
chore: integrate current main into P11 V1 candidate
```

First parent: reconciled P11 integration head.

Second parent: `2ff7a8551b46140714e7af918b36ac3fb87c08c8`.

- [ ] **Step 3: Fast-forward `integration/p11-v1-closure` to the new merge-parent commit**

Do not force-update and do not update `main` or any P11 Draft PR branch.

- [ ] **Step 4: Verify ancestry against main**

Run repository compare with base `main` and head `integration/p11-v1-closure`.

Expected:

```text
status = ahead
behind_by = 0
```

If current `main` changes during execution, stop using the stale comparison and integrate the new main head before claiming closure.

### Task 3: Verify the integration candidate

**Files:**
- No changes.

**Interfaces:**
- Consumes: Task 2 exact integration head.
- Produces: fresh CI evidence for the complete P11 + current-main candidate.

- [ ] **Step 1: Identify the GitHub Actions run for the exact integration head**

The run's `head_sha` must equal the Task 2 integration commit.

- [ ] **Step 2: Verify `verify` job completely**

Require all of:

```text
Prisma validate: success
Prisma generate: success
Prisma migrate deploy: success
Typecheck: success
Full Vitest: zero failures
Build: success
```

- [ ] **Step 3: Verify the remaining required jobs**

Require:

```text
e2e: success
deployment-artifact: success
production-audit: success
```

- [ ] **Step 4: If any gate fails, fix only the demonstrated root cause**

Do not widen scope. Rerun exact-head CI after each fix.

### Task 4: Add missing P11-02C closure evidence

**Files:**
- Create: `docs/development/p11-02c-current-serp-rank-tracking-verification.md`

**Interfaces:**
- Consumes: #188 RED/GREEN history and exact closure evidence at `9f785b6b36a8dd50131412a9b57ec0db15942429` / CI #2435.
- Produces: repository-local closure record for P11-02C.

- [ ] **Step 1: Record P11-02C scope and pinned identities**

Include PR #188, base/head SHAs, DataForSEO adapter scope, realtime SearchFact semantics, authority/fail-closed boundaries, and explicit exclusions.

- [ ] **Step 2: Record TDD and exact-head CI evidence**

Include RED/GREEN milestones and final CI #2435 with 399/399 Vitest files, 1879/1879 tests, Build, e2e, deployment-artifact, and production-audit.

- [ ] **Step 3: State explicitly that the document does not authorize merge or deployment**

### Task 5: Add P11 V1 integration verification

**Files:**
- Create: `docs/development/p11-v1-integration-verification.md`

**Interfaces:**
- Consumes: Task 2 ancestry evidence and Task 3 fresh CI evidence.
- Produces: final integration-gate document for the separate main-merge authorization decision.

- [ ] **Step 1: Record the full P11 stack**

Document:

```text
P11-01 -> P11-02A -> P11-02B -> P11-02C
```

and their Draft PRs #182/#186/#187/#188.

- [ ] **Step 2: Record current-main reconciliation**

Include the three main-only commits and the final compare result proving `behind_by = 0`.

- [ ] **Step 3: Record exact integration-head CI**

Pin the exact SHA and every required job result.

- [ ] **Step 4: Record scope review and authorization boundary**

State that the integration candidate is eligible only for a separate main-merge authorization gate; it is not merged and not deployed.

### Task 6: Verify the documentation head

**Files:**
- No further changes unless verification exposes a documentation contract failure.

**Interfaces:**
- Consumes: exact head containing Tasks 4 and 5 documents.
- Produces: final P11 V1 closure evidence.

- [ ] **Step 1: Run/observe a fresh exact-head CI after the documentation commits**

Require all four jobs green and zero failing tests.

- [ ] **Step 2: Re-run main comparison**

Require `behind_by = 0`. If main advanced, integrate the new main head and repeat CI/document evidence before closure.

- [ ] **Step 3: Recheck PR states**

Require #182/#186/#187/#188 to remain open Draft PRs and unmerged unless a separate explicit merge authorization has been given.

- [ ] **Step 4: Declare only the integration candidate closed**

Permitted claim after all evidence is fresh:

```text
P11 V1 integration candidate verified and ready for separate main-merge authorization.
```

Do not claim production deployment or full system 100% completion at this gate.
