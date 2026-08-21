# P7-A Growth Opportunity Intelligence — Operator Guide

P7-A adds read-only Google Search Console ingestion plus a deterministic Growth Opportunity layer over persisted GSC and P2/P3/P5/P6 facts. The authoritative path is database-first: Google is used only by the Search Console ingestion path; Growth materialization and all Growth GET/rendering paths consume persisted facts only.

## 1. Source-of-truth boundary

The authoritative chain is:

```text
Google Search Console (read-only OAuth)
  -> immutable/versioned GSC daily snapshots + Query/Page facts
  -> stable 28-day current + 28-day previous windows
  -> persisted P2/P3/P5/P6 evidence adapters
  -> deterministic Growth score/detectors/topic materialization
  -> immutable opportunity/topic snapshots + mutable lifecycle
  -> optional P4 DeepSeek advisory explanation
```

Growth materialization must make zero Google API calls, zero P6 provider calls and zero DeepSeek calls. Growth API/web GET rendering must not create Google, P6 or AI work.

DeepSeek explanation is optional, explicitly user-triggered advisory work through the existing P4 AI pipeline. It cannot mutate deterministic Growth snapshots, breakdowns, evidence, score, priority or lifecycle.

## 2. Required Search Console environment

Search Console connection work uses these five variables:

```text
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=
OAUTH_CREDENTIAL_ENCRYPTION_KEY=
OAUTH_CREDENTIAL_KEY_VERSION=v1
```

The application may start without Google OAuth configuration. Search Console OAuth/sync must fail safely when required connection configuration is absent; CI and tests must use fixtures/mocks and must not require live Google credentials.

`OAUTH_CREDENTIAL_ENCRYPTION_KEY` must decode to exactly 32 bytes. The vault accepts either 64 hex characters or base64 that decodes to 32 bytes. Credentials are encrypted with AES-256-GCM using a random 12-byte IV, a 16-byte authentication tag and project/provider/key-version AAD.

Never log, render, report or pass to AI plaintext access tokens, refresh tokens, client secrets or encrypted credential payloads.

## 3. Google OAuth callback setup

Configure the Google OAuth client with the exact server callback URI supplied in `GOOGLE_OAUTH_REDIRECT_URI`.

The requested scope is exactly:

```text
https://www.googleapis.com/auth/webmasters.readonly
```

P7-A requests offline access so scheduled synchronization can refresh access tokens. OAuth `state` is high-entropy, hashed at rest, project/actor scoped, expiring and single-use. Unknown, expired, cross-project/cross-actor or replayed state must be rejected before token exchange.

The first successful connection must yield a refresh token. Property binding is allowed only for an exact property URI returned by the authorized Search Console site list with readable permission.

## 4. Credential key/version rotation

P7-A V1 intentionally uses a single active encryption key/version, not a multi-key keyring. A stored credential whose `keyVersion` does not equal the running `OAUTH_CREDENTIAL_KEY_VERSION` is treated as unavailable.

Therefore do not rotate by simply replacing both environment values in place and expecting existing records to remain decryptable.

Safe V1 rotation procedure:

1. plan a controlled Search Console reconnect window;
2. record the current key version and affected connection count without exposing credential payloads;
3. disconnect/revoke affected Search Console credentials while the old deployment can still read them;
4. deploy the new 32-byte key and incremented key version;
5. reconnect Search Console so new credential records are encrypted under the new version;
6. verify property binding and a controlled daily sync;
7. retire the old secret only after no active credential records depend on it.

A future seamless in-place rotation requires a designed multi-key/key-migration mechanism; do not improvise one in production.

## 5. Daily Search Console synchronization

Queue: `search-console-sync`.

Worker concurrency: 2.

One job represents one project/property/source date:

```text
{ projectId, propertyId, date: YYYY-MM-DD }
```

The worker makes one Search Analytics request for that day with dimensions `query,page`, `rowLimit=25000`, `startRow=0`.

The daily source is intentionally labeled `TOP_ROWS_ONLY`; Search Console Search Analytics is not treated as a complete keyword universe.

Each persisted row keeps raw Query/Page values plus deterministic `normalizedQuery`, normalization version and canonical page URL. Query text and page URLs are data, not observability metadata.

### Versioning and idempotency

Daily snapshots are immutable/versioned. Retries after a failed attempt advance `syncVersion`. The highest COMPLETED source version is authoritative for a date; FAILED versions are never selected.

Once an authoritative COMPLETED snapshot exists for a project/property/date, repeat delivery is idempotent and does not refetch/overwrite that day. A COMPLETED snapshot is finalized only after its facts are durable.

Failure reason codes are bounded to:

- `TOKEN_REVOKED`
- `PERMISSION_DENIED`
- `PROPERTY_UNAVAILABLE`
- `RATE_LIMITED`
- `TRANSIENT_PROVIDER_ERROR`
- `INVALID_RESPONSE`
- `PERSISTENCE_FAILED`
- `SYNC_NOT_CONFIGURED`

## 6. Freshness, coverage and stable windows

The default Growth measurement contract is:

- current window: 28 calendar days;
- previous window: the immediately preceding 28 calendar days;
- data cutoff: exclude the most recent 3 calendar days.

A materialization is window-eligible only when all 56 expected source dates have a selected COMPLETED daily snapshot. A missing or FAILED date is incomplete evidence, not zero impressions.

`UNKNOWN` must never be coerced to zero. A legitimate numeric zero is valid only when the underlying evidence is known and the deterministic calculator produces zero.

Search Console freshness and coverage should be shown separately from Growth score/priority. `TOP_ROWS_ONLY` completeness must remain visible to operators.

## 7. Growth materialization and scoring

Queue: `growth-materialization`.

Authoritative materialization reads persisted database facts only. It must not call Google, visibility providers or DeepSeek.

`GROWTH_SCORE_V1` uses deterministic weighted components:

- Demand: 30
- Position Potential: 25
- CTR Gap: 20
- Site Gap: 15
- GSC Trend: 6
- P6 Visibility: 4

Evidence availability gates ranking:

- `availableWeight >= 70`: ranking-eligible;
- `50..69`: diagnostic PARTIAL only;
- `<50`: authoritative score/priority UNKNOWN.

Evidence quality remains explicit as `COMPLETE`, `PARTIAL` or `UNKNOWN`.

Normal stable identity is based on project + identity type + normalized Query + canonical page. Dynamic primary opportunity type and Topic membership are snapshot facts and do not redefine a normal Query/Page identity.

Keyword Cannibalization and New Content use their own stable identity types. A cannibalization identity requires 2–20 unique canonical pages.

## 8. Bounds and fail-closed behavior

Current implementation bounds include:

- GSC Query+Page rows/source-day: 25,000;
- Growth materialization candidates: 1,000 (stricter than the design ceiling);
- Topic member Queries/snapshot: 500;
- Cannibalization competing pages/identity: 20;
- Growth API page size: maximum 100.

The approved design also caps opportunity snapshots/project/window at 10,000 and Topic Clusters/project at 2,000. The implementation may stay stricter; do not raise limits beyond approved ceilings without a design/release review.

When a bound, source contract or invariant is violated, fail closed. Do not truncate silently in a way that changes authoritative semantics.

## 9. Opportunity lifecycle

Mutable lifecycle status is separate from immutable opportunity snapshots/evidence.

Statuses:

```text
NEW
REVIEWED
PLANNED
IN_PROGRESS
DONE
DISMISSED
RESOLVED
REOPENED
```

Append-only event types are:

```text
CREATED
REVIEWED
PLANNED
STARTED
DONE
DISMISSED
AUTO_RESOLVED
AUTO_REOPENED
```

Automatic reconciliation may resolve/reopen opportunities from later deterministic windows, but must preserve user intent:

- `DISMISSED` is not auto-reopened;
- `PLANNED` and `IN_PROGRESS` are not auto-completed by scoring;
- lifecycle events remain auditable and append-only.

## 10. Search Console and Growth observability

Final Search Console event catalog:

```text
gsc.connection.connected
gsc.connection.revoked
gsc.property.bound
gsc.sync.started
gsc.sync.completed
gsc.sync.failed
```

Final Growth event catalog:

```text
growth.materialization.started
growth.materialization.completed
growth.materialization.failed
growth.lifecycle.changed
growth.ai_explanation.completed
growth.ai_explanation.failed
```

Observability is strict allowlist-only. Allowed metadata is bounded scalar operational data such as internal project/property/identity IDs, status/reason/error codes, safe dates/windows, counts and duration. String metadata is sanitized and bounded.

Never emit through P7-A observability:

- Query text or Query arrays;
- evidence bodies or source-provenance payloads;
- OAuth credentials, access/refresh tokens, client secrets or authorization headers;
- Google account payloads;
- AI prompts, AI responses or provider raw bodies;
- P6/provider reasoning;
- arbitrary caller-supplied objects/arrays.

## 11. Access and product boundaries

Search Console and Growth endpoints are project-scoped and must enforce plan/feature gates before restricted repository reads or side effects.

Standard exposes only the bounded basic Growth surface defined by the P7-A plan. Advanced unlocks the advanced Growth views/detectors. Enterprise-only portfolio Growth rows remain bounded and deterministic.

Dashboard/Growth Center rendering uses persisted facts. It must not turn a page view into a synchronization, materialization or AI request.

AI explanation is visibly advisory and cannot replace deterministic Why/Score Breakdown/Evidence/Lifecycle facts.

## 12. Incident triage

### Search Console connection failure

- verify the exact redirect URI and read-only scope;
- check OAuth state expiry/replay rejection;
- check credential record is active and its key version matches the running key version;
- check exact property URI and permission level;
- use only bounded reason codes/IDs in logs.

### Missing or incomplete Growth materialization

- verify all 56 expected source dates have selected COMPLETED snapshots;
- inspect source freshness/coverage rather than substituting zero;
- verify the selected windows/cutoff;
- verify materialization bounds were not exceeded;
- confirm database/Redis worker health;
- confirm no provider/DeepSeek call is occurring inside materialization.

### Unexpected score or priority

- inspect `availableWeight`, evidence quality and the deterministic component breakdown;
- confirm UNKNOWN/NOT_APPLICABLE inputs were not coerced to zero;
- inspect root-cause dedupe and stable identity;
- compare against the same persisted source window, not live Search Console state.

### Unexpected lifecycle state

- inspect the append-only lifecycle events;
- verify whether the opportunity became actionable/non-actionable in later windows;
- confirm DISMISSED was preserved;
- confirm PLANNED/IN_PROGRESS was not auto-completed.

## 13. Rollback guidance

Prefer application rollback before destructive database rollback.

1. stop/disable P7-A web/API exposure and the `search-console-sync` / `growth-materialization` workers if they are causing operational pressure;
2. deploy the last known-good application revision;
3. preserve immutable GSC and Growth snapshots/evidence for auditability;
4. do not rewrite completed source days or Growth snapshots to make a rollback look clean;
5. if OAuth is implicated, revoke/disconnect credentials rather than copying secrets into diagnostics;
6. if AI explanation is implicated, disable that user-triggered path without changing deterministic Growth facts;
7. resume workers only after database/Redis/Google configuration is healthy.

Schema down-migrations are not the default rollback mechanism.

## 14. Release gate

Focused release invariants include OAuth replay rejection, daily sync idempotency, immutable source/Growth snapshots, `UNKNOWN != 0`, deterministic score/root-cause dedupe, Cannibalization/New Content exclusion rules, stable identity across primary-type changes, lifecycle resolve/reopen behavior, plan fail-before-read gates, and zero external calls during materialization/GET rendering.

Fresh full gate:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=high
```

CI must retain three exact-head jobs:

- `verify`
- Chromium `e2e`
- `production-audit`

Google credentials must not be required in CI. Tests use mocked/fixture transports and make no live Google calls.

Mark P7-A complete only after the release branch exact head has all three jobs successful. Record the exact head SHA and workflow run in PR/release evidence.
