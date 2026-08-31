# P11-02B Official Search Sync & Query Discovery — Verification

## Closure target

- PR: #187 `P11-02B: Official Search Sync & Query Discovery`
- Base branch: `feat/p11-02a-official-search-evidence`
- Base SHA: `8d8e59a19ed40ffc99a320fc2bfcdddfd806447d`
- Implementation branch: `feat/p11-02b-official-search-sync`
- Approved design: `docs/superpowers/specs/2026-08-29-p11-02b-official-search-sync-design.md`
- Approved design commit: `feadb2a04a89eea593f0a6e25b49a484b77ef89b`
- Approved plan: `docs/superpowers/plans/2026-08-30-p11-02b-official-search-sync.md`
- Approved plan commit: `2aa1c14c3a5968a233be303ddab201b339bf822a`
- Implementation verification head: `8b5967cd75ce3daaf0a8461181c89eb13d282bbc`

This verification is for P11-02B only. It does not authorize merge, deployment, or P11-02C implementation.

## Delivered scope

P11-02B adds the write-side official search synchronization and human-reviewed real-query discovery loop while preserving the existing SearchFact truth layer:

1. explicit project-scoped provider lane bindings for Google Search Console and Bing Webmaster;
2. authenticated, capability-guarded explicit sync commands;
3. Google and Bing official-provider observations normalized into the existing SearchFact layer;
4. deterministic discovery projection from persisted SearchFact rows;
5. persisted discovery-candidate identity / review state without duplicating provider metrics;
6. human accept / reject decisions, with accepted discoveries creating authoritative Keyword rows only after explicit review;
7. Keyword Center read-only discovery display with provider-qualified metrics and manual controls for authorized writers;
8. production Bing runtime wiring using the existing Bing client / adapter / source repository path.

## Truth boundaries

The following boundaries are part of the verified contract:

- persisted official search-platform facts only;
- no global or monthly keyword-search-volume claim;
- provider impressions are observations for this site/property, not global demand volume;
- Search Console average position is not a live/current deterministic Google SERP rank;
- Bing average click / impression positions are provider-reported averages, not guaranteed current Bing rank;
- `UNKNOWN` is not zero;
- absence from incomplete provider evidence does not prove no demand or no ranking;
- no provider-health inference from an absent query;
- no live SERP scraper or third-party rank-tracking provider in P11-02B;
- read-side Keyword Center / discovery routes do not initiate provider synchronization or other network writes;
- no crawl, AI, content-generation, publication, or distribution side effects are introduced by the P11-02B read path;
- discovery candidates store identity / review metadata only; SearchFact remains the provider-metric truth layer;
- provider credentials are not rendered in the Keyword Center and are excluded from P11-02B observability payloads;
- P11-02C is excluded.

## Security and isolation review

### Provider binding and sync routes

- binding reads require authentication, project membership, and `PROJECT_READ`;
- binding create / patch and explicit sync require authentication, CSRF, project membership, and `PROJECT_SETTINGS_WRITE`;
- binding repository reads and mutations are scoped by `projectId`, including identity lookup, binding lookup, and activation state changes;
- a foreign-project binding does not become addressable through a bare binding id.

### Discovery routes

- discovery GET requires authentication, membership, and `PROJECT_READ`;
- Keyword Center GET calls only `list({ projectId })` for discovery data;
- GET does not call `refresh`, `accept`, or `reject`;
- accept / reject require authentication, CSRF, membership, and `CONTENT_WRITE`;
- candidate / Keyword reads and writes remain project-scoped;
- decision writes execute through the serializable discovery transaction boundary.

### Secrets and observability

P11-02B observability is limited to operational metadata such as project id, binding id, provider, date range, state/reason, row/fact counts, and duration. It does not include Bing API keys, OAuth tokens, credential material, or raw query collections.

## Persistence review

The P11-02B migration is `20260830010000_add_p11_02b_official_search_sync`.

`KeywordDiscoveryCandidate` persists candidate identity / workflow fields such as normalized query, representative text, status, first/last observed dates, accepted Keyword id, decision actor/time, and timestamps. It does **not** persist clicks, impressions, CTR, average position, current rank, or search-volume fields.

`SearchProviderLaneBinding` persists non-secret lane identity/configuration: project, provider, property reference, market, locale, active state, and timestamps.

Provider observations and metrics continue to materialize through SearchFact.

## TDD evidence

### Keyword Center discovery UI RED

- RED commit: `55ec8dc2dd4edae7cf1ee3be08b73ca6651246d6`
- Commit message: `test: define keyword discovery web contract`
- CI: #2414, run `33320602791`
- Result: expected RED in `verify`; Prisma validation/generation/migration and Typecheck passed; production-audit, e2e, and deployment-artifact passed.
- RED cause: the new discovery Web contract expected the persisted official-query discovery panel, provider-qualified evidence, and human review controls before production wiring existed.

### Keyword Center discovery UI GREEN

- Web routes: `1515e199d7c6eb8a103ebe2111fedc510a172ce0`
- Discovery view: `cd526570761c679067f65807cb3cce87ad9020c2`
- Composition / frozen implementation head: `0b436e19ab2beb3e07796934c9ba79366d7b6c4d`
- CI: #2417, run `33322341329`
- Result: all four jobs SUCCESS.
- Verify evidence at that head: 392 test files / 1856 tests passed; Typecheck and Build passed.

### Task 9 browser contract

- Browser contract commit: `1286985bcf44e9cab7e6ba9a21f0bdd83a5031b8`
- Explicit human keyword type contract fix: `0c929b5b4be18763ae04a51a27c716a3e9bc9821`
- Contract verifies persisted GSC/Bing labels, no fabricated current rank/global volume, explicit human type choice, exactly one accepted `SEARCH_DISCOVERY_ACCEPTED` Keyword, rejected candidate state with SearchFact preserved, and the 820px overflow boundary.

### Production Bing wiring RED

- RED commit: `5d9b1ec581773e7efd76d0c62d793f4c8dbec43a`
- Commit message: `test: expose missing Bing production sync wiring`
- CI: #2420, run `33323769142`
- Result: expected RED in `verify`; Typecheck and the other three jobs passed.
- RED cause: default `createApp()` production composition returned `SYNC_NOT_CONFIGURED` for Bing even though `OfficialSearchSyncService`, `BingWebmasterClient`, `BingSearchProviderAdapter`, and `SearchProviderSourceRepository` already supported the path.

### Production Bing wiring GREEN

- Runtime config: `943b89d821ccf475134d75b32d18f5a9bd979a19`
- Production composition: `8b5967cd75ce3daaf0a8461181c89eb13d282bbc`
- Fix is deliberately narrow:
  - declares optional `BING_WEBMASTER_API_KEY` runtime configuration;
  - preserves fail-closed `SYNC_NOT_CONFIGURED` behavior when no key is configured;
  - lazily composes the existing Bing client, adapter, and source repository when configured;
  - does not change Bing provider algorithms or SearchFact semantics.

## Implementation-head exact CI

Implementation head: `8b5967cd75ce3daaf0a8461181c89eb13d282bbc`

CI #2422, run `33386934662`.

Latest exact-head attempt:

| Job | Job id | Result |
| --- | ---: | --- |
| `verify` | `99473780489` | SUCCESS |
| `e2e` | `99473778617` | SUCCESS |
| `deployment-artifact` | `99473780051` | SUCCESS |
| `production-audit` | `99473818635` | SUCCESS |

### Verify log evidence

- `npx prisma validate`: schema valid;
- `npx prisma generate`: Prisma Client v6.19.3 generated;
- `npx prisma migrate deploy`: 44 migrations found and successfully applied, including `20260830010000_add_p11_02b_official_search_sync`;
- Typecheck: SUCCESS;
- Full Vitest: **393 / 393 test files passed**;
- Full Vitest: **1857 / 1857 tests passed**;
- Build: SUCCESS.

The test logs include intentional negative-path database errors from immutable/uniqueness/fail-closed tests; the overall test suite completed with zero failing tests.

### Browser rerun evidence

The first successful CI #2422 e2e attempt contained one Task 9 820px overflow failure (`423px`) that passed on Playwright retry. No CSS change was made without a reproducible cause.

The same exact implementation head was rerun. Latest e2e job `99473778617` completed **41 / 41 Playwright tests on the first pass with no retry**, including:

`P11-02B keyword discovery › operator reviews real search query discoveries with explicit human type choice`

The previous overflow event therefore did not reproduce on the identical implementation head and is retained here as transparent verification history rather than hidden or papered over with an evidence-free CSS change.

## Scope review result

No P11-02B change introduces:

- a live SERP scraper;
- a third-party rank API;
- `searchVolume`, monthly/global search volume, `currentRank`, or `liveRank` product semantics;
- provider metrics duplicated onto discovery candidates;
- crawl/AI/content/publication/distribution execution from discovery reads;
- credential material in the UI or sync observability.

The implementation reuses the existing official Google Search Console and Bing Webmaster provider paths and the existing SearchFact normalization/materialization layer.

## CI note outside P11-02B closure semantics

The verify job's dependency installation emitted npm's advisory summary of `3 high severity vulnerabilities`. The dedicated `production-audit` job nevertheless completed SUCCESS and its runtime-tree checks passed. P11-02B does not claim that the repository has zero dependency advisories, and dependency remediation is not represented as part of this phase closure.

## Closure conditions after this document commit

Because this document changes the branch head, P11-02B is **not closed by this file alone**. Closure requires a fresh exact documentation-head CI proving all four jobs green after the `docs: verify P11-02B official search sync` commit, followed by a final PR-state check proving:

- PR #187 remains Draft and open;
- `merged=false`;
- no deployment was performed;
- P11-02C implementation was not started.

Only after those conditions are observed may P11-02B be declared closed.
