# Keywords V1.1 P1-P3 Design

## Baseline and scope

- Source baseline: `main` at `461193813cb5dc61e1d2ef6fea40df0289f1a38d`.
- Production currently runs the same SHA. This work is isolated on `feat/keyword-v11-p1-p3`; it does not merge or deploy.
- The existing `Keyword`, `KeywordRelation`, `KeywordGroup`, `KeywordGroupMembership`, suggestion, audit, RBAC/CSRF, coverage, and persisted search-evidence paths remain authoritative.
- P1-P3 extend those paths. No parallel keyword or cluster subsystem is introduced.

## Repository versus V1.1

### Reuse as implemented

- Single-keyword create/update/archive/restore and project-scoped normalized uniqueness.
- Keyword type, optional intent, priority, language, target country, parent relation, groups, strategic lock, audit events.
- Project membership/capability enforcement and CSRF on mutations.
- AI suggestions require explicit acceptance and retain a seed relation.
- Existing page coverage and official search-evidence projections avoid fabricated rank data.

### Upgrade or complete

- P1: strict request validation, multiline bulk creation with explicit per-line results, server-side filters, and keyword lifecycle.
- P2: evolve `KeywordGroup` into the user-facing Cluster concept by adding a primary keyword, rename support, and atomic bulk assignment.
- P3: retain the existing intent enum, add explainable keyword opportunity scoring, persisted score snapshots, confidence/provenance, and workbench display.

### Deferred by phase boundary

- Target URL persistence and cannibalization are P4.
- Content Gap workflow is P5; P3 may consume the existing coverage fact as a score signal but does not create P5 state.
- AI expansion changes, entities, IndexNow/crawler health, provider sync, citations, and optimization remain P6-P12.

## Data model

### Backward-compatible keyword lifecycle

Add `KeywordLifecycleStatus` and `Keyword.lifecycleStatus` without renaming or removing legacy `Keyword.status`. Migration backfill maps `ACTIVE` to `DISCOVERED` and `DISABLED`/`ARCHIVED` to `RETIRED`; the existing enable/archive behavior remains intact. New rows default to `DISCOVERED`.

### Cluster evolution

Keep the physical `KeywordGroup` and membership tables. Add nullable `primaryKeywordId` with a project-safe service invariant: the primary keyword must belong to the same project and is automatically included in the cluster membership. Rename and bulk membership mutations use the current serializable keyword transaction pattern and audit each affected keyword.

### Opportunity score snapshots

Add `KeywordOpportunitySnapshot` with `keywordId`, `projectId`, nullable `score`, `dataConfidence`, `breakdown`, `sourceProvenance`, `formulaVersion`, and `createdAt`. History is append-only. The latest snapshot drives the workbench.

The pure scoring engine uses weighted components: relevance, demand, ranking opportunity, difficulty, content gap, authority fit, strategic value, and GEO value. Each component is `KNOWN`, `UNKNOWN`, or `NOT_APPLICABLE`. Unknown values receive no invented score. The final score is normalized only across known weight, and remains `null` below the minimum evidence threshold. `dataConfidence` is known weight divided by total configured weight.

P3 input sources are conservative:

- Persisted official search evidence may supply demand and ranking opportunity.
- Existing persisted page coverage may supply content-gap and authority-fit evidence.
- Explicit keyword priority may supply strategic value.
- Keyword type and explicit intent may supply GEO suitability using a versioned deterministic rule.
- Difficulty and project relevance stay unknown until a real provider or explicit operator input exists.

## API and UI

- Existing endpoints stay compatible.
- Add bulk keyword create, filtered keyword list, cluster rename, cluster primary-keyword mutation, bulk cluster assignment, and opportunity-score calculation endpoints.
- All new and existing keyword writes use Zod schemas at the route boundary and service invariants inside transactions.
- The EJS workbench gains multiline input, GET filters, lifecycle editing, Cluster terminology/management, bulk selection, score/confidence badges, and a breakdown details view.
- No fake summary numbers, seeded demo records, or client-side score calculation.

## Safety and rollback

- Migration is additive before backfill and constraint tightening; no existing column or enum value is removed.
- Application rollback remains compatible because old code ignores the new tables/columns.
- Database rollback is a separately documented down migration that drops only P1-P3 additions after confirming no newer application writes depend on them; Production migration execution is outside this task.
- No high-risk redirect, merge, canonical, deletion, or Production mutation is added.

## Verification gates

Each phase follows RED -> GREEN -> targeted tests -> full `typecheck`, `vitest`, and `build`. The final branch is pushed for exact-head GitHub CI. P1-P3 close only when `verify`, `e2e`, `production-audit`, and `deployment-artifact` report success for the branch head.
