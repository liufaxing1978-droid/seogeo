# Keywords V1.1 P8 Content Brief Integration Design

Status: approved design pending written-spec review

## Scope

Keywords V1.1 P8 connects an existing, persisted Keyword Content Gap or
Keyword Cluster to the repository's existing advisory Content Brief workflow.
It is deliberately separate from the older P8 safe-publication program. This
phase does not publish, mutate a site, create a page, or assume one page per
keyword.

## Existing capabilities to reuse

- `Keyword`, `KeywordGroup`, memberships, P5 `KeywordContentGap`, P4 target
  mappings, P7 entity mappings, and their project-scoped RBAC already exist.
- The Content Intelligence module already owns `ContentDocument`,
  `ContentBrief`, `CONTENT_BRIEF` tasks, prompt validation, the AI Worker, and
  content Brief views.
- Existing P8 publication Briefs are a separate task type and remain
  unchanged.

## Chosen architecture

Add one project-scoped `KeywordContentBriefRequest` bridge aggregate rather
than a second ContentBrief or AI pipeline. A request has exactly one source:
an individual `KeywordContentGap` or a `KeywordGroup`. It captures the source
IDs and an immutable request-time facts snapshot, then owns the single
existing `CONTENT_BRIEF` task and its resulting existing `ContentBrief`.

The snapshot contains only persisted project facts: the source Keyword(s),
intent, lifecycle, Gap reason codes and coverage state, resolved Target URL
state, mapped active Entities, and source references. It never invents search
performance, AI visibility, page coverage, or a target page.

Cluster requests use the Cluster and the active member Keywords as one
content-mapping unit. The service rejects a Cluster without meaningful member
context; it does not fan out to one request per Keyword. A direct target URL is
context only, not authorization to overwrite that URL.

## Data model and migration safety

`KeywordContentBriefRequest` has `id`, `projectId`, nullable `keywordId`,
nullable `groupId`, nullable `contentGapId`, nullable `aiTaskId`, nullable
`contentBriefId`, `factsSnapshot`, `status`, `createdByUserId`, timestamps,
and error-safe status metadata.

Database constraints ensure exactly one source path: either a Gap-backed
Keyword request or a Cluster request. Unique request keys make the operation
idempotent for a given source and source revision/state. Foreign keys are
project-validated in the service; deleting a Keyword/Cluster/Gap cascades only
the bridge request, not the existing AI task or ContentBrief. The migration is
additive only: no enum removal, backfill, or rewrite of existing ContentBrief
rows. Old application builds safely ignore the new table.

## Service, Worker, and errors

`KeywordContentBriefService.createFromGap` and `.createFromGroup` validate the
project-local source, build the snapshot, create or reuse the bridge request,
and invoke the existing `createContentBriefTask` capability through a narrow
adapter. The task's request key includes the bridge ID and snapshot hash, so a
retry cannot enqueue duplicate active work.

The AI Worker remains the only component that executes and validates the
existing `CONTENT_BRIEF` output. On task completion the bridge is linked to the
persisted ContentBrief. Task timeout, validation failure, and provider failure
produce a visible FAILED state while preserving the source Keyword, Gap,
Cluster, Target URL, Entity, and existing Brief data.

No automatic worker schedule is introduced. Brief creation is an explicit user
action with `CONTENT_WRITE`; reads require `PROJECT_READ`.

## API and UI

Add guarded routes to create/read a request from a Keyword Gap or Cluster and
to retrieve its state. Web POST routes mirror the actions with CSRF and 303
redirects to the Keywords workbench. The workbench shows a real Brief state and
link only when a request exists. It offers "Create Content Brief" for a Gap or
Cluster only to authorized users. Existing Content Brief detail screens remain
the rendering authority.

## Tests and completion gate

- RED/GREEN unit coverage for source validation, exact-one source semantics,
  snapshot construction, idempotent request keys, and no-one-keyword-one-page
  fanout.
- Integration coverage for project isolation, RBAC/CSRF, Gap and Cluster
  creation, task reuse, Worker completion linkage, and provider failure.
- Web coverage for authorized actions and visible pending/completed/failed
  state without static data.
- Fresh isolated migration, Typecheck, full Vitest, Build, E2E, and exact-head
  CI must all pass before P8 is closed. No merge to `main` or Production deploy
  is part of this phase.
