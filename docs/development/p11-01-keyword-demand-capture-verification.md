# P11-01 Keyword Demand Capture — Verification Evidence

Status: implementation evidence complete; closure document itself still requires exact-head CI before integration.

## Scope and pinned heads

- Repository: `liufaxing1978-droid/seogeo`
- Implementation branch: `feat/p11-01-keyword-demand-capture`
- Draft PR: `#182`
- Pinned `main` design base: `2136087a5ae74b474b1b191b4ef957b4c7b61e96`
- Approved implementation-plan/base commit: `bde000144bf553170bdb9d90d21a1d9fc1f6d6a2`
- Final implementation head before this closure-document commit: `d8a3a6039413eeeead0439541fabe21d79a111ef`

This document records observed implementation and CI evidence only. It does not authorize merge or deployment.

## Database changes

P11-01 introduced two forward migrations:

1. `20260828060000_add_keyword_demand_capture`
   - keyword identity and metadata
   - canonical parent relation
   - project-scoped groups and memberships
   - advisory keyword suggestions
   - keyword audit events
2. `20260828152000_add_keyword_expansion_ai_task`
   - adds `KEYWORD_EXPANSION` only when the existing AI worker path is implemented for it

At the final implementation head, CI `verify` successfully executed Prisma validation, Prisma client generation, and `prisma migrate deploy` with both migrations applied.

## A/B/C/D TDD milestones

### P11-01A — Authoritative manual keyword capture and secured JSON API

RED:

- `117263038cd36d69de66ed2741aa1b6bb41b830f` — `test(keywords): add secured API RED`
- CI run `33155488894` (`#2287`) — expected failure after adding the secured keyword API contract before the route implementation existed.

GREEN / freeze:

- `b0123e05279d4403de21446ab748ab122c83d927`
- CI run `33173729573` (`#2292`)
- `verify`: SUCCESS
- `production-audit`: SUCCESS
- `deployment-artifact`: SUCCESS
- `e2e`: SUCCESS

A establishes authenticated project reads, `CONTENT_WRITE` mutation authority, CSRF protection, fail-closed project membership behavior, and the authoritative manual keyword command path.

### P11-01B — Persisted content coverage truth

RED chain:

- `9a616507405313285729f898c0accbda20c75a79` — deterministic coverage scorer RED; CI `33174240914` (`#2293`) failed as expected before scorer implementation.
- `1c6e23ab516c56f0e3e068cca538bf37cd3f9a42` — persisted coverage read API RED; CI `33175322860` (`#2296`) failed as expected before read orchestration/API implementation.

GREEN / freeze:

- `1ca5cc9ea80a21a4a5c053ba6314c7c963fb30f4`
- CI run `33175893188` (`#2300`)
- `verify`: SUCCESS
- `production-audit`: SUCCESS
- `deployment-artifact`: SUCCESS
- `e2e`: SUCCESS

Coverage uses persisted site facts only: active pages and their latest usable persisted crawl snapshots. Reading coverage does not start a crawl and does not start AI work.

Truth boundary:

- `STRONG` / `PARTIAL` indicate matching persisted content evidence.
- `NONE` means usable persisted page evidence exists but no keyword match was found.
- `UNKNOWN` means evidence is insufficient, such as no active page evidence or no usable persisted snapshot.
- Therefore `UNKNOWN != NONE`.
- Content coverage is not search-engine ranking and must not be presented as ranking.

### P11-01C — Keyword Center operator UI and browser contract

RED chain:

- `808cee152c08ec29dd218bf8fc3aeb2b94268537` — secured Keyword Center UI RED; CI `33176427719` (`#2302`) failed as expected before the web read model/routes/view existed.
- `944c681f0c62ae7671c410d5c707c42e6e3d9bee` — Keyword Center browser/E2E RED; CI `33181397010` (`#2314`) failed as expected before the browser contract was complete.

GREEN / freeze:

- `6e2a117caf5d6389ee3b8ab43d4a497b5e959f01`
- CI run `33181869185` (`#2315`)
- `verify`: SUCCESS
- `production-audit`: SUCCESS
- `deployment-artifact`: SUCCESS
- `e2e`: SUCCESS

C provides the existing-shell Keyword Center for manual demand capture, truthful coverage display, strategic-lock state, groups/parent relationships, and responsive browser behavior without fabricating ranking information.

### P11-01D — DeepSeek advisory expansion plus explicit human decisions

Initial AI/advisory RED:

- `7f89d08d769d11819ec2a11ef1f434cf6ac77754` — keyword expansion parser RED
- CI run `33182390183` (`#2316`) — expected failure before the expansion parser/worker materialization path existed.

Service-level GREEN before API/UI shell:

- `1072e0fb8bc902af9e1e4aa826efbade73c56ddd`
- CI run `33239283735` (`#2337`)
- `verify`: SUCCESS
- `production-audit`: SUCCESS
- `deployment-artifact`: SUCCESS
- `e2e`: SUCCESS

API RED / GREEN:

- RED `c7139e8704f34a09cb2322a4a1833c3efa9cc9e4`, CI `33239511416`: seven new suggestion API tests failed with route-not-found behavior while the rest of the suite remained green.
- GREEN `380a5cd2b4201730b4c21a72d43a672c81dc2ebf`, CI `33240368893`: all required jobs SUCCESS.

UI RED / GREEN:

- RED `afb9313e7d45a0c08797951433c4ea23d0a1e14c`, CI `33240685483`: expected Advisory-panel/web-command failures; existing tests remained green.
- Production candidate `fcd44137ff02cb5209302c09e45f3b6c6ef36af9`, CI `33241082842`: `verify`, `production-audit`, and `deployment-artifact` succeeded; E2E exposed one Playwright strict-locator test defect because two valid seed keywords correctly rendered two generate forms.
- Test-only correction `d8a3a6039413eeeead0439541fabe21d79a111ef` changed the locator to allow multiple valid generation forms; production code did not change.

Final D / implementation freeze:

- Exact implementation head: `d8a3a6039413eeeead0439541fabe21d79a111ef`
- CI run `33241613225` (`#2347`)
- `verify`: SUCCESS
  - Prisma validate: SUCCESS
  - Prisma generate: SUCCESS
  - Prisma migrate deploy: SUCCESS
  - Typecheck: SUCCESS
  - Full Vitest: `376` test files passed / `1757` tests passed
  - Build: SUCCESS
- `e2e`: SUCCESS — `39/39` Playwright tests passed
- `deployment-artifact`: SUCCESS
- `production-audit`: SUCCESS

## Authoritative keyword semantics

The authoritative keyword model remains human/project controlled:

- Manual creation is the primary authoritative path and stores source `MANUAL`.
- Logical identity is unique by `(projectId, normalizedText)` across `ACTIVE`, `DISABLED`, and `ARCHIVED` states.
- Archiving does not free logical identity; reusing an archived normalized term requires explicit restore rather than silently creating a second keyword.
- Normalization is conservative: Unicode NFKC, trim, collapse whitespace, lowercase Latin; it does not intentionally collapse Traditional and Simplified Chinese semantic forms.
- Parent relationships are project scoped, allow one canonical parent per child, reject self-parenting and cycles, and fail closed for foreign-project references.
- Keyword groups are project scoped and may be many-to-many.
- Successful authoritative commands and suggestion decisions append audit evidence in the same transactional command boundary.
- Strategic lock protects strategic/destructive changes. A locked keyword requires explicit authenticated human acknowledgement for protected mutation paths.

## AI advisory authority boundary

AI is advisory only in P11-01:

- DeepSeek expansion reuses the existing `AiTask -> BullMQ -> DeepSeek -> structured output -> atomic completion/materializer` path.
- `KEYWORD_EXPANSION` produces persisted `KeywordSuggestion` candidates first.
- A generated suggestion is not an authoritative `Keyword`.
- AI does not autonomously rename, archive, re-parent, delete, change priority/type/intent/lock, publish, merge, deploy, or roll back.
- Generating suggestions requires project membership, CSRF, and `AI_RUN`.
- Accepting or rejecting suggestions requires project membership, CSRF, and `CONTENT_WRITE`.
- Only explicit human acceptance creates or links the authoritative keyword through the normal keyword service; newly created accepted terms use source `AI_ACCEPTED`.
- Rejecting a suggestion creates no keyword.
- Foreign-project suggestion identifiers fail closed.
- Accepted/rejected decisions are transactionally persisted and audited.

## Ranking/provider truth boundary

P11-01 does not claim any search ranking or provider-derived demand metric.

- No Google/Baidu/Bing ranking is fabricated.
- No search volume is fabricated.
- No provider-health status is inferred from configuration presence.
- Existing Search Console integration remains read-only and does not convert site content coverage into ranking evidence.
- Adding or accepting a keyword is a demand-capture action, not a guarantee of ranking, indexing, traffic, or AI citation.

## Explicit exclusions

The following are outside this P11-01 closure and remain unimplemented/unapproved here:

- P11-02 ranking/provider integration and live rank tracking
- production deployment
- autonomous publication
- autonomous merge
- autonomous deployment
- autonomous rollback

P11-01 also does not change existing P0-P10 merge/deploy authority boundaries.

## Final implementation-head regression evidence

For implementation head `d8a3a6039413eeeead0439541fabe21d79a111ef`, exact-head CI `33241613225` is the controlling implementation regression evidence. All four required jobs completed successfully:

| Gate | Result |
| --- | --- |
| `verify` | SUCCESS |
| `production-audit` | SUCCESS |
| `deployment-artifact` | SUCCESS |
| `e2e` | SUCCESS |

The install output in the general dependency tree reported three high-severity vulnerabilities; this document therefore does **not** claim that the entire dependency tree has zero vulnerabilities. The dedicated deployable-runtime `production-audit` gate nevertheless completed successfully at the exact implementation head.

## Closure rule for this documentation commit

Creating this file changes branch HEAD. Per the approved P11-01 plan, the implementation is not eligible for integration based only on the prior implementation-head green run. The exact commit containing this verification document must itself obtain a new CI run with all currently required gates green (`verify`, `production-audit`, `deployment-artifact`, and `e2e`).

Until that documentation-head run is green:

- do not state P11-01 is fully closed for integration;
- do not merge PR #182;
- do not deploy;
- do not begin P11-02 as part of this closure step.
