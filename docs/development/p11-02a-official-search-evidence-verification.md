# P11-02A Official Search Evidence Verification

## Status

This document records the implementation evidence for P11-02A Official Search Evidence.

- Stacked base: `e1786e7019c6eeaacf5e1c4a7d0993c504763ae8`
- Implementation head before this verification document: `0fc3b3f09068f1815e001858fcd8de3a62600d4a`
- Pull request: #186
- Scope: persisted official search evidence only
- Closure state at document creation: **pending documentation-head exact CI**

P11-02A must not be declared closed until the commit containing this document has a fresh four-job successful CI run and PR #186 is rechecked as Draft/open, unmerged, and undeployed.

## Phase A — Query normalization and pure aggregation

### RED

- Commit: `95efef64cb477918b0735dd1fb5515fd6cb602ae`
- CI: #2352, run `33253568634`
- Result: expected failure
- Evidence: TypeScript could not resolve the new `keyword-search-evidence.js` aggregation module. The contract tests existed before the implementation.

### GREEN / freeze

- Commit: `fde3da6afbc179820ac1ce7e88c8b48071db27d2`
- CI: #2353, run `33253658669`
- Result: four CI jobs successful
- Outcome: official-query normalization and pure Google/Bing evidence aggregation contract established.

## Phase B — Persisted read service

### RED

- Commit: `57bad44b5b78846e888ea5784f7dd73c68db1baa`
- CI: #2358, run `33257927076`
- Result: expected failure
- Evidence: TypeScript reported missing `keyword-search-evidence.repository.js` and `keyword-search-evidence.service.js`; tests/build did not proceed after the expected typecheck failure.

### GREEN / freeze

- Commit: `0224e07b79311076157a93536e7f00101eb7fbc5`
- CI: #2360, run `33258142055`
- Result: `verify`, `production-audit`, `deployment-artifact`, and `e2e` all successful
- Outcome:
  - reads persisted SearchFact evidence only;
  - default range is the prior 28 UTC days ending yesterday;
  - strict `YYYY-MM-DD` parsing with an inclusive 93-day maximum;
  - invalid ranges use `KEYWORD_SEARCH_EVIDENCE_RANGE_INVALID`;
  - invalid provider/market/text filters use `KEYWORD_SEARCH_EVIDENCE_FILTER_INVALID`;
  - Google reads query-page evidence and Bing reads query evidence;
  - exact evidence lanes remain separated by provider/market/locale/propertyRef;
  - project evaluation loads one project window and aggregates in memory rather than issuing one database window read per keyword.

## Phase C — Secured read-only API

### RED

- Commit: `5bcade82b1fdeea8e1e5c7e77547488eba36ee48`
- CI: #2361, run `33258455429`
- Result: expected failure
- Typecheck: successful
- Vitest: 1 failed file / 379 passed; 5 failed tests / 1768 passed
- Evidence: all five new API cases reached the pre-implementation 404 path. Examples included VIEWER expected 200 but received 404, anonymous expected 401 but received 404, and invalid filter/range expected 400 but received 404.

### GREEN / freeze

- Commit: `0e59fdb7010181be00c90d9f7aa483c67b58bd0a`
- CI: #2364, run `33258785446`
- Result: all four CI jobs successful
- Endpoint: `GET /api/v1/projects/:projectId/keywords/:keywordId/search-evidence`
- Security contract:
  - authentication required;
  - project membership required;
  - `PROJECT_READ` required;
  - GET does not require CSRF;
  - foreign keyword fails closed as `KEYWORD_NOT_FOUND`;
  - no mutation is introduced by this endpoint.

## Phase D — Keyword Center read model, truthful UI, and browser contract

### Read-model RED

- Commit: `3ae51c5cdc734c85fed07306a4a0ae2bd27d0284`
- CI: #2365, run `33259028905`
- Result: expected failure
- Evidence: the new read-model contract expected one `searchEvidence.evaluateProject()` call but observed zero, and expected missing evidence to reject while the old read model still resolved.

### Read-model GREEN

- Commit: `0df25d2fdd45464000abd3392b1cc04525acbe25`
- CI: #2368, run `33259417309`
- Result: successful after rerunning the single `verify` job for an unrelated pre-existing Prisma P2034 serialization flake; no unrelated production or test code was changed.
- Outcome: every Keyword Center row receives authoritative `searchEvidence`, and the center performs one bulk `evaluateProject()` call.

### UI RED

- Commit: `bfca77332ea8ff8b7256a3e56c720cbe616f4848`
- CI: #2369, run `33259989639`
- Result: expected failure
- Evidence: Typecheck passed and only the new search-evidence UI contract failed because the existing page did not yet contain the `搜索证据` UI, stable hooks, provider semantics, or truth copy. All other test files passed.

### UI GREEN

- Commit: `0757fdebfa71f656396585f4b28549b00f5d4c9c`
- CI: #2371, run `33261211309`
- Result: all four CI jobs successful
- UI contract includes:
  - `data-ui="keyword-search-evidence"`;
  - provider `data-provider` attributes;
  - Google label `Search Console 平均位置`;
  - truthful `UNKNOWN` copy that explicitly prevents interpreting missing incomplete evidence as zero search volume or zero ranking;
  - truthful `UNAVAILABLE` copy for unsupported query-level provider capability;
  - no `Google 当前排名` claim;
  - no synthetic `排名 0` rendering.

### Browser regression discovery and fix

- Browser-contract commit: `6a8496e48082ced0601572cf0a3d212b6068296c`
- CI: #2372, run `33261485572`
- Observation: Playwright exposed a real 820px viewport document overflow of 242px. The run was later superseded by a newer push, but the e2e failure was observed before cancellation.

- First isolated CSS hypothesis: `656839ea9210e6f1c9ac1766afb26ac6463be9e9`
- CI: #2373, run `33261644924`
- Observation: the same 242px overflow reproduced, disproving the first hypothesis. The run was later superseded by a newer push.

- Root-cause fix / implementation head: `0fc3b3f09068f1815e001858fcd8de3a62600d4a`
- CI: #2374, run `33261822977`
- Result: all four jobs successful
- Root cause: the grid-item `.keyword-panel` retained the table's intrinsic minimum width through `min-width:auto`, leaking the 980px table width to the document. The fix permits the panel to shrink at the tablet breakpoint while retaining horizontal scrolling inside the table wrapper.

## Task 9 — Scope, security, truth, determinism, and performance review

No defect requiring a new RED test was found.

### Scope

The stacked-base-to-implementation-head comparison contains only the approved matcher/aggregation, SearchFact read extension, persisted read service, read-only API, Keyword Center projection/UI, tests, and documentation work.

No P11-02A change introduces:

- a new Prisma migration;
- a new ranking persistence table;
- live SERP provider execution;
- provider sync/write transport;
- crawler execution changes;
- AI execution changes;
- publication/distribution execution changes.

### Security

- Search-evidence JSON access is a guarded GET requiring authentication, project membership, and `PROJECT_READ`.
- Foreign keyword access fails closed as `KEYWORD_NOT_FOUND`.
- No OAuth token or credentialRef is rendered or accessed by the read path.
- No mutation or write-side CSRF exemption was added.

### Truth semantics

Verified boundaries:

- `TOP_ROWS_ONLY` absence => `UNKNOWN`.
- `PROVIDER_UNSPECIFIED` absence => `UNKNOWN`.
- Absence becomes `NOT_OBSERVED` only when all relevant persisted snapshots are `COMPLETE`.
- A matched Bing query can be `OBSERVED` while an unsupported/unknown position metric remains `null`.
- Google position is labeled only as `Search Console 平均位置`.
- `UNKNOWN` and `UNAVAILABLE` never synthesize zero metrics.

### Determinism and performance

- Real evidence lanes are ordered deterministically by provider/market/locale/propertyRef.
- Snapshot and page ordering is deterministic.
- Keyword Center uses one bulk `evaluateProject()` search-evidence read rather than one database window load per keyword.

## Implementation-head verification — CI #2374

Implementation head: `0fc3b3f09068f1815e001858fcd8de3a62600d4a`

| Gate | Evidence |
| --- | --- |
| Prisma validate | schema valid |
| Prisma generate | Prisma Client v6.19.3 generated successfully |
| Prisma migrate deploy | 43 existing repository migrations successfully applied; P11-02A adds no migration |
| Typecheck | success |
| Full Vitest | 381/381 test files passed; 1776/1776 tests passed |
| Build | success (`tsc -p tsconfig.json`) |
| Playwright | 40/40 passed, including persisted Google evidence and 820px overflow regression |
| production-audit | success; deployable runtime dependency audit passed and Prisma CLI absent from runtime tree |
| deployment-artifact | success; exact artifact source SHA checked, runtime/migration images built, runtime contents verified without network, Prisma CLI absent from runtime image |
| e2e | success |

## Final truth boundaries

P11-02A deliberately guarantees only the following:

- **Persisted official facts only.** Read-side evaluation does not fetch live provider data.
- **`UNKNOWN != 0`.** Unknown evidence is not zero search volume, zero clicks, zero impressions, or zero rank.
- **`UNKNOWN != NOT_OBSERVED`.** Incomplete persisted evidence cannot prove absence.
- **Search Console average position is not a live deterministic SERP rank.**
- **Bing average position metrics are not guaranteed current rank.**
- **No search-volume claim is made.**
- **No provider-health inference is made from missing evidence.**
- **No read-side provider, crawl, AI, publication, or distribution execution occurs.**
- **No new ranking persistence or migration is introduced.**
- **P11-02B and P11-02C are excluded from this implementation.**

## Closure gate

After this document is committed, P11-02A closure requires a fresh exact documentation-head CI where all four jobs succeed. Then confirm:

- PR #186 remains Draft and open;
- `merged=false`;
- no deployment was performed;
- no P11-02B or P11-02C implementation has started.

Until those checks are complete, the correct state is **closure pending**.
