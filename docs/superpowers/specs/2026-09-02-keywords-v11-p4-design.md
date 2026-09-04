# Keywords V1.1 P4 Target URL + Cannibalization Design

## Context and scope

- Production and the original development baseline are exact SHA `461193813cb5dc61e1d2ef6fea40df0289f1a38d`.
- P1-P3 are complete on Draft PR #193. P4 continues on `feat/keyword-v11-p1-p3`; it does not merge or deploy.
- The repository already has project-scoped `Keyword`, `KeywordGroup`, memberships, crawl `Page` facts, keyword coverage, search evidence, and persisted Growth `KEYWORD_CANNIBALIZATION` opportunities.
- P4 adds persisted Target URL planning and a Keywords-facing cannibalization analysis that reuses existing evidence. It must not create a parallel search-performance detector.
- P4 detects and recommends only. It never executes merge, redirect, canonical, publication, deletion, or Production data repair.
- Content Gap state and brief creation remain P5/P8. P4 may report that no Target URL exists, but it does not create P5 state.

## Existing capabilities to preserve

- Growth already detects material multi-page competition for a normalized query from persisted GSC/search facts. Its detector requires eligible demand, sufficient impressions, balanced page share, and ranking competition, then persists identity, snapshot, provenance, evidence, and lifecycle.
- Keyword coverage already evaluates active, usable crawl pages from title, H1, meta description, and path facts.
- `Page.normalizedUrl` is unique per project; planned URLs may legitimately exist before a Page has been crawled.
- Keywords can belong to more than one `KeywordGroup`. P4 must not silently select one group when inherited Target URLs disagree.
- Keyword mutations already use project membership, `CONTENT_WRITE`, CSRF, lock acknowledgement, strict Zod validation, and `KeywordAuditEvent`.

## Chosen architecture

P4 uses one Target URL mapping entity for Keyword and Cluster scopes, plus append-only cannibalization snapshots. A deterministic service resolves effective mappings and combines planning, coverage, and existing Growth evidence.

This architecture is preferred over adding `Keyword.targetUrl` because a scalar cannot express Cluster-level ownership, inheritance, or shared pages. It is preferred over using only Growth because Growth has no representation for planned mappings and may have no search observations for new keywords.

## Data model

### KeywordTargetMapping

Add a `KeywordTargetMapping` model with:

- `id`, `projectId`
- nullable `keywordId`
- nullable `groupId`
- `targetUrl`: accepted user-facing URL
- `normalizedUrl`: canonical comparison key
- nullable `pageId`: linked only when a matching project Page already exists
- nullable `createdByUserId`, `updatedByUserId`
- `createdAt`, `updatedAt`

Database constraints:

- Exactly one of `keywordId` and `groupId` must be non-null.
- A Keyword has at most one direct mapping.
- A Cluster has at most one direct mapping.
- Project/normalized URL and subject lookup indexes support analysis and workbench reads.
- Deleting a Keyword or Cluster cascades its mapping. Deleting a linked Page sets `pageId` to null while retaining the planned URL.
- Service-level project validation is required before every write; foreign-project subjects or Pages are rejected.

The mapping is not unique by `normalizedUrl`: multiple Keywords and Clusters may intentionally share a page. This is necessary to avoid imposing “one keyword, one page.”

### KeywordCannibalizationSnapshot

Add append-only `KeywordCannibalizationSnapshot` with:

- `id`, `projectId`
- exactly one nullable subject: `keywordId` or `groupId`
- `risk`: `NONE | LOW | MEDIUM | HIGH`
- nullable `recommendedAction`: `REVIEW | MERGE | REDIRECT | REPOSITION | CANONICAL_REVIEW`
- `conflictingUrls` JSON array
- `reasonCodes` JSON array
- `sourceProvenance` JSON object
- `dataConfidence` constrained to 0..1
- `formulaVersion`, fixed initially to `keyword-cannibalization-v1`
- nullable `createdByUserId`, `createdAt`

Indexes support latest-by-Keyword, latest-by-Cluster, and project history. Snapshot rows are not updated after creation.

`MERGE` and `REDIRECT` remain valid recommendation vocabulary for future evidence-rich rules, but version 1 does not emit them because current facts do not prove content equivalence or redirect safety.

### Migration safety

- Use one additive migration after the existing 48 migrations.
- Create new enums/tables/indexes/check constraints only; do not rename or remove existing schema.
- No backfill is required. Existing Keywords and Clusters begin with no direct mapping and no P4 snapshot.
- Old application versions ignore both new tables, so application rollback is possible before database rollback.
- A database down procedure may drop the P4 snapshot table, mapping table, and P4-only enums only after backup and confirmation that no newer application writes depend on them. No Production migration is executed in this task.

## URL validation and normalization

- Accept absolute `http:` or `https:` URLs only.
- Normalize with the repository crawler URL normalization behavior: lowercase host, remove fragment, normalize default ports/path representation, and use the normalized string for comparison.
- Require the normalized URL to be in the Project `primaryDomain` scope using the existing crawler scope rule.
- Preserve the accepted URL in `targetUrl`; use `normalizedUrl` for equality, inherited resolution, Page lookup, and conflict detection.
- A URL need not already have a `Page` row. If it does, link `pageId`; otherwise retain a planned mapping with `pageId = null`.
- Clearing a mapping deletes only the mapping row and appends an audit event. It never deletes Page, Keyword, Cluster, search facts, or prior analysis snapshots.

## Effective Target URL resolution

For each Keyword:

1. A direct Keyword mapping wins and returns source `KEYWORD`.
2. Otherwise collect mappings from all Cluster memberships.
3. No mapped Cluster returns `UNMAPPED`.
4. One distinct normalized Cluster URL, even if supplied by multiple Clusters, returns source `CLUSTER`.
5. More than one distinct inherited normalized URL returns `AMBIGUOUS`; the service returns every candidate and never chooses one silently.

The workbench displays direct, inherited, unmapped, or ambiguous state. Shared URLs are normal and are not themselves a conflict.

When a mapping is created for a Keyword whose lifecycle is `DISCOVERED`, `EVALUATING`, or `APPROVED`, the same transaction advances it to `MAPPED` and records the transition in `KeywordAuditEvent`. Later lifecycle states and `RETIRED` are not changed. Clearing a mapping never silently regresses lifecycle.

## Cannibalization inputs

The P4 analysis service uses only persisted facts available at calculation time:

1. **Mapping plan evidence**
   - effective Target URL resolution for the subject;
   - direct Keyword mapping versus inherited Cluster mapping;
   - distinct effective URLs among active members sharing the same Cluster and Intent;
   - ambiguous inheritance from multiple Cluster mappings.
2. **Existing Growth evidence**
   - latest persisted `KEYWORD_CANNIBALIZATION` snapshot whose normalized query equals the Keyword normalized text;
   - its competing pages, reason codes, evidence quality, coverage, window, and identity reference;
   - no new query/page detector or duplicated Growth snapshot.
3. **Coverage evidence**
   - existing Keyword coverage matches from active usable Page snapshots;
   - two or more strong matching pages are a weak signal only.
4. **Unavailable content-overlap evidence**
   - title/body similarity is marked unavailable unless a future persisted, versioned similarity fact exists;
   - P4 does not infer content equivalence or invent similarity scores.

All provenance returned to API/UI is sanitized and contains stable internal references, fact versions, time windows, and reason codes rather than secrets or raw provider credentials.

## Risk and recommendation policy

The policy is centralized in a pure, versioned evaluator.

- `HIGH`
  - latest existing Growth cannibalization is detected for the normalized query; or
  - detected search competition and a mapping-plan conflict are both present.
  - Recommendation: `REVIEW`, unless a safer deterministic `REPOSITION` rule applies.
- `MEDIUM`
  - same Cluster + same non-null Intent resolves to two or more distinct planned URLs; or
  - inherited Target URL is ambiguous across multiple Cluster memberships.
  - Recommendation: `REPOSITION`.
- `LOW`
  - two or more strong coverage pages exist without detected search competition; or
  - a direct Keyword override differs from one otherwise unambiguous inherited Cluster URL.
  - Recommendation: `REVIEW`; use `CANONICAL_REVIEW` only when a persisted canonical fact specifically disagrees with the planned target.
- `NONE`
  - no known conflict signal is present.
  - Recommendation is null.

Risk is the maximum supported severity, not an average. `conflictingUrls` is normalized, unique, sorted, and limited to project-scope URLs. Missing search or coverage data lowers `dataConfidence` and produces explicit unavailable reason codes; it is never converted into a positive or negative search signal.

## Service and transaction boundaries

### Target mapping service

- Set, replace, or clear one Keyword mapping.
- Set, replace, or clear one Cluster mapping.
- Atomically apply one Target URL to up to 100 project Keywords.
- Validate every subject and lock before any bulk write; a validation error causes zero writes.
- Use Keyword lock acknowledgement for direct and bulk Keyword mappings.
- Append `TARGET_URL_SET`, `TARGET_URL_CLEARED`, `TARGET_URL_BULK_SET`, or `TARGET_URL_BULK_CLEARED` audit events without logging secrets.

### Cannibalization service

- Analyze one Keyword or one Cluster on demand.
- Read mappings, memberships, Keyword intent/status, latest coverage, and latest matching Growth evidence.
- Call the pure evaluator and append exactly one P4 snapshot plus an audit event in a transaction.
- Read the latest P4 snapshot without recalculation.
- Analysis never modifies Target URLs, Cluster membership, Page facts, Growth opportunities, lifecycle, publication state, redirect state, or canonical state.

No new worker is introduced in P4. The existing Growth worker remains the owner of search-derived cannibalization materialization; P4 on-demand analysis consumes its persisted result. Scheduled recalculation can be considered later without changing the P4 interfaces.

## API behavior

All routes remain below the existing `/api/v1` mount.

- `PUT /projects/:projectId/keywords/:keywordId/target-url`
  - strict body `{ targetUrl: string | null, acknowledgeLock?: boolean }`.
- `PUT /projects/:projectId/keyword-groups/:groupId/target-url`
  - strict body `{ targetUrl: string | null }`.
- `PUT /projects/:projectId/keywords/target-url`
  - strict body `{ keywordIds: uuid[1..100], targetUrl: string | null, acknowledgeLock?: boolean }`.
- `GET /projects/:projectId/keywords/:keywordId/cannibalization`
- `POST /projects/:projectId/keywords/:keywordId/cannibalization`
- `GET /projects/:projectId/keyword-groups/:groupId/cannibalization`
- `POST /projects/:projectId/keyword-groups/:groupId/cannibalization`

GET routes require `PROJECT_READ`. Mapping and analysis POST/PUT routes require authentication, CSRF, project membership, and `CONTENT_WRITE`. Cross-project access returns the existing not-found/forbidden semantics without disclosing foreign records.

Web POST routes mirror the write operations and redirect with HTTP 303 to the Keywords workbench.

## Keywords workbench behavior

- Add Target URL to the Keyword row, showing direct, inherited, unmapped, or ambiguous state.
- Add a Cluster Target URL control to the existing Keyword Cluster area.
- Add bulk Target URL mapping for selected Keyword IDs using the existing batch interaction style.
- Display latest risk, data confidence, conflicting URLs, reason summary, recommendation, and analysis time.
- Provide “运行冲突检测/重新检测” for users with `CONTENT_WRITE`.
- Link Growth-backed evidence to the existing Growth Cannibalization view when its identity is available.
- Display N/A/证据不足 for unavailable facts. Never render sample counts, fake URLs, or static risk data.
- Do not add merge, redirect, canonical mutation, or delete buttons.

## Error handling

- Invalid/non-HTTP/off-domain URL: 400 with a stable validation code.
- Missing or foreign Keyword/Cluster: existing project-scoped not-found behavior.
- Locked Keyword without acknowledgement: existing lock error behavior.
- More than 100 bulk subjects, duplicate IDs after normalization, or empty bulk list: 400.
- Ambiguous inherited mapping is a valid read/analysis result, not a server error.
- Missing Growth/coverage evidence is a partial-confidence result, not a provider call or failed calculation.
- Database errors abort the transaction; no partial mapping, lifecycle, snapshot, or audit write is accepted.

## Test strategy and acceptance criteria

Every production behavior is implemented through a witnessed RED then minimal GREEN cycle.

### Unit tests

- URL validation, project scope, normalization, and equality.
- Effective resolution: direct, one inherited URL, duplicate inherited URL, unmapped, and ambiguous multi-Cluster URL.
- Risk policy for NONE/LOW/MEDIUM/HIGH, deterministic URL ordering, recommendations, missing evidence, and canonical-review guard.
- Strict schemas reject unknown fields and unsafe URLs.

### Integration tests

- Keyword, Cluster, clear, replace, and atomic bulk mappings persist with project isolation.
- Planned URL without a Page is retained; an existing Page is linked.
- mapping advances only early lifecycle states to `MAPPED`; clear does not regress.
- lock acknowledgement and audit events remain enforced.
- analysis reuses a real persisted Growth cannibalization snapshot and creates one append-only P4 snapshot.
- foreign-project mappings, subjects, Growth evidence, and Pages cannot leak into analysis.
- no-risk, ambiguous inheritance, same Cluster + Intent conflict, coverage-only weak signal, and Growth-backed high risk.

### API/Web/E2E tests

- RBAC, CSRF, strict validation, not-found isolation, response shape, and 303 redirects.
- Workbench displays direct/inherited/ambiguous URL state, conflict URLs, risk, confidence, and advice.
- A user maps a URL, runs analysis, and sees the persisted result after reload.
- No high-risk execution controls are present.

### Completion gate

- Targeted P4 tests pass.
- Prisma validate/generate and all 49 migrations apply to an isolated PostgreSQL database.
- Full Typecheck, Vitest, Build, deployment artifact checks, Production dependency audit, and browser smoke tests pass.
- Draft PR exact-head CI is green.
- The P1-P4 comparison report records schema/API/UI/test/CI/rollback evidence and remaining P5-P12 work.
- The PR remains Draft; no merge, deployment, or Production mutation occurs.
