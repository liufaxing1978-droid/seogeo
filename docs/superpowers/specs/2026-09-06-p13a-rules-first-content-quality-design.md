# P13-A Rules-First Content Quality Design

## Status

Proposed design. Implementation, schema migration, API/UI work, pull requests and
deployments must not begin until this specification is explicitly approved.

## Context

P5-A already owns a deterministic content inventory and rule layer:

- `ContentDocument` is the current content-fact projection of the latest owned
  page snapshot.
- `ContentSignal` and `ContentOpportunity` record versioned quality rules for
  document framing, depth, structure, internal-link count, entity support and
  citability support.
- Page snapshots are immutable and preserve historical technical/content facts.
- Publication proposals, drafts, approval and execution already have protected,
  auditable workflows.

P13-A must add a rules-first, human-reviewed quality-analysis layer without
claiming rankings, traffic impact, link equity or external CMS write capability.

## Goals

1. Provide a project-scoped, manually triggered analysis for Internal Link,
   Content Decay and Content QA recommendations.
2. Ensure every recommendation is reproducible from persisted facts and exact
   page-snapshot references.
3. Preserve `UNKNOWN` for missing or non-comparable evidence; it must never be
   converted to zero or a failure.
4. Let an authorized human explicitly turn a finding into an existing
   `PublicationProposal`, with evidence carried forward.
5. Reuse existing RBAC, CSRF protection, audit patterns, queue controls and
   content/publication UI conventions.

## Non-goals

P13-A does not:

- re-crawl a site while analysing;
- call an AI provider;
- edit live pages, drafts or external CMS content;
- automatically create a publication plan, approval, execution or publish;
- schedule daily analysis or change automation policies;
- infer exact source-to-target internal-link edges, PageRank, ranking impact,
  traffic impact or conversion impact;
- replace P2 SEO issues, P3 GEO facts, or P5-A content facts.

## Chosen approach

Use an additive, deterministic P13-A projection over persisted P1/P5 facts.
It is run only by an explicit authorized user action. The analysis task is
idempotent per project and rule version. It reads historical `PageSnapshot`
facts and current `ContentDocument` facts, persists its own audit trail and
never writes to the crawled site or a publishing integration.

The existing P5-A rules remain authoritative for basic content QA. P13-A may
surface them in a dedicated review workflow, but does not introduce a competing
fact model or silently change their status.

## Data model

### ContentQualityRun

An immutable execution/audit record.

- `id`, `projectId`, `rulesetVersion`
- `status`: `QUEUED`, `RUNNING`, `COMPLETED`, `FAILED`
- `inputSnapshotCutoffAt`, `inputDocumentCount`, `findingCount`
- `startedAt`, `completedAt`, `errorCode` nullable
- `requestedByActorId`, timestamps

The result is a record of one user-requested analysis. Retrying creates a new
run only after a prior terminal state; an active/waiting run is deduplicated.

### ContentQualityFinding

A stable current recommendation identity, tied to a content document and a
versioned deterministic rule.

- `id`, `projectId`, `contentDocumentId`, `latestRunId`
- `findingKey`, `ruleVersion`, `category`, `priority`
- `status`: `OPEN`, `IN_REVIEW`, `ACCEPTED`, `DISMISSED`
- `summary`, bounded `evidence` JSON
- `firstDetectedAt`, `lastDetectedAt`, timestamps
- `acceptedPublicationProposalId` nullable

Unique identity: `(contentDocumentId, findingKey, ruleVersion)`. A rerun updates
evidence and `lastDetectedAt`, but never silently changes an explicit human
status. A resolved rule may close only an `OPEN`/`IN_REVIEW` finding using an
explicit deterministic resolution state; accepted or dismissed findings remain
historically visible.

### ContentQualityFindingHistory

Append-only history for every human state transition and proposal handoff.

- `id`, `findingId`, `fromStatus`, `toStatus`
- `actorId`, `reason` nullable, bounded `metadata` JSON, `createdAt`

## Rules V1

### Internal Link support

Input: known `PageSnapshot.internalLinksCount` / current
`ContentDocument.internalLinkCount`.

- `UNKNOWN` when the latest page is not eligible or the link count is unknown.
- `FAIL` when the known count is below the existing P5-A threshold.
- Finding wording: add relevant owned-site internal-link support after human
  review.

The crawler currently uses links to discover URLs but does not persist durable
page-A-to-page-B link edges. Therefore V1 must not recommend a specific source
page, target page, anchor text or claim measured link equity.

### Content Decay

Input: at least two comparable, eligible historical `PageSnapshot` records for
the same page, ordered deterministically by captured time and ID.

V1 only evaluates observed, explainable regressions such as:

- a formerly indexable page becoming non-indexable;
- an explicit transition from 2xx HTML to non-2xx/non-HTML;
- a material decrease in word count under a versioned threshold;
- removal of previously present title or H1.

Fewer than two eligible comparable snapshots, missing source fields, or
unchanged content evidence yield `UNKNOWN`/no finding. A finding says that an
observed content/technical regression requires review; it never claims ranking,
traffic or conversion loss.

### Content QA

Input: current P5-A signals/opportunities and the latest page snapshot.

V1 surfaces only stable deterministic rules already present in P5-A, including
title/H1/meta presence, content depth, heading structure and internal-link
support. Evidence references both the originating P5-A rule and page snapshot.
It must not create a second SEO issue identity or contradict P2/P3 outcomes.

## Workflow and status transitions

```text
Manual analysis request
  -> QUEUED -> RUNNING -> COMPLETED | FAILED

Finding: OPEN -> IN_REVIEW -> ACCEPTED -> PublicationProposal
                    \-> DISMISSED
```

- Only an explicit operator action may move a finding into review, accept or
  dismiss it.
- `ACCEPTED` creates one idempotent existing `PublicationProposal` with source
  metadata identifying the finding, rule version and snapshots.
- Acceptance does not create a draft or make a publish mutation. Existing
  draft, plan, approval and execution guards remain unchanged.
- The proposal should use the existing compatible proposal source category with
  P13-A metadata rather than altering an enum solely for display semantics.

## API and UI

### API

Project-scoped endpoints follow existing auth/error/CSRF conventions:

- request a manual P13-A run and return its deduplicated job/run identity;
- list runs and findings with category, priority, status and page filters;
- retrieve one finding and its immutable evidence/history;
- set `IN_REVIEW` / `DISMISSED` with an auditable operator reason;
- accept an eligible finding and create (or return) its linked proposal.

No endpoint accepts arbitrary page content, invokes a provider, or calls a
publication mutation adapter.

### UI

Add a “内容质量建议” view inside the existing Content Center:

- manual “分析内容质量” control and latest-run state;
- category/status/priority filters;
- evidence-first rows with source snapshot time and rule version;
- finding detail with comparison values where available;
- explicit review, dismiss and “创建发布提案” actions;
- links to the current content document and the created proposal.

The interface labels insufficient evidence as “证据不足”, not as a failure.

## Authorization, audit and observability

- Reuse project membership/RBAC checks for Content Center and publication
  proposal actions. Read-only members cannot trigger or mutate finding state.
- Reuse CSRF, project scoping and actor attribution for every mutation.
- Emit bounded events for queue, run lifecycle, finding updates and proposal
  handoff; no secrets, page HTML or user credentials in telemetry.
- Include counters for runs completed/failed, findings by category/priority and
  deduplicated requests. Alerting/scheduling changes are out of scope.

## Testing and Definition of Done

Implementation is test-driven:

1. Add unit tests first for rule evaluation, `UNKNOWN` handling, historical
   comparator ordering, stable identity and status transitions (RED).
2. Implement the smallest production code to make those tests pass (GREEN).
3. Add integration tests for persistence, project isolation, RBAC/CSRF,
   idempotent run/proposal handoff and no mutation-adapter invocation.
4. Add web/API contract tests for the manual controls and evidence rendering.
5. Run the full exact-HEAD CI suite; do not rely on earlier commits or CI runs.

Done means:

- all tests and exact-HEAD CI pass;
- only authorized manual actions can run/analyze/transition findings;
- all rule outputs are sourced and unknown-safe;
- no automatic scheduler, AI call, CMS write, draft generation or publishing
  path has been introduced;
- migration is additive, reversible operationally and documented;
- PR review/merge and staging/production deployment remain separate explicit
  approvals.

## Deferred follow-ups

- persist link-edge data before recommending exact internal-link pairs;
- add a separately approved schedule after measured review quality;
- integrate Search Console trends only when data coverage and attribution limits
  are explicitly designed;
- AI-assisted wording, CMS adapters, content generation, action-impact and
  conversion tracking each require separate approved scope.
