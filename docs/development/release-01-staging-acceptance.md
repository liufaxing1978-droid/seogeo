# Release-01 Staging Acceptance Record

Status: **STAGING READY — Release-01 P0-P10 staging only**
Scope: P0-P10 Release-01 staging acceptance evidence  
Production deployment: **NOT AUTHORIZED BY THIS DOCUMENT**

## 1. Purpose

This document is the evidence record for Release-01 staging acceptance. It is intentionally fail-closed: an unchecked gate is not treated as passed, missing provider credentials are not treated as successful sampling, and repository/CI readiness is not represented as an external staging deployment.

Release-01 remains staging-only. It does not authorize P11 and does not authorize Production deployment.

## 2. Repository-side integrated identity

Repository integration is complete and has post-merge evidence for both the repaired staging candidate and its acceptance checkpoint:

- Accepted deployed candidate: `main@68881188c62028051c136de77cad4b7f2f1d38ca`
- Gates 5–24 checkpoint: `main@7cd090c91cef5c61261881de79dfd68541b2b2ef`, PR #178
- Runtime compatibility fix: PR #175
- Crawl API RBAC/CSRF fix: PR #176
- Worker signal-forwarding fix: PR #177
- Accepted-candidate CI: CI #2263, workflow run `33087173292`
- Checkpoint main CI: CI #2266, workflow run `33090471138`
- `verify`: PASS — Prisma validate/generate/migrate, Typecheck, full Vitest, Build
- `production-audit`: PASS
- `e2e`: PASS — Chromium browser smoke suite and screenshot artifacts
- `deployment-artifact`: PASS — exact source SHA, runtime image build, migration image build, offline runtime-content check, and runtime Prisma CLI absence
- Original Release-01 integration remains traceable through PR #173; later fixes were created only from failures observed during real staging acceptance.
- Diff audit remained limited to approved Release-01 runtime/env/proxy/process/packaging/CI/tests/runbooks/spec-plan scope; no Prisma schema/feature migration, P11 feature, UI redesign, autonomous deploy/rollback, or default-branch direct-write implementation was introduced

Repository-side evidence alone does not establish external staging identity. The exact deployed `main` SHA and its green CI are therefore recorded together with the external evidence below; they must not be silently combined with evidence from another artifact.

External staging identity for Gates 5–25:

- Exact deployed source SHA: `68881188c62028051c136de77cad4b7f2f1d38ca`.
- Runtime image: exact-SHA tag with local immutable ID `sha256:393475ec44099a186c2e15341dc5ec21600415b9987f973b26f2d3c2cf148dc1`.
- Migration image: exact-SHA tag with local immutable ID `sha256:e43a5c9cef7aa83b6614121d8b2c718bbabb57ffa3a461e928179c77827cc855`.
- Candidate backup: `20260827T152441Z-68881188/pre-migration.dump`, SHA-256 `fc664284dc682f79268f37f39a2155b6ddd2cd347ab5925af53c7bb5de0ef453`.
- Public staging origin: `https://seogeo-staging.43-128-23-16.sslip.io`.
- Operator: Codex in an operator-authorized staging session.
- Evidence window: `2026-08-27T10:50Z` through `2026-08-27T16:07Z`.
- Gate 25 rehearsal source: checkpoint runtime `7cd090c91cef5c61261881de79dfd68541b2b2ef`, immutable ID `sha256:563fb5c769b299b69bf22299c9af97b87134fde4ec5a75be813e4741d29a318a`.
- Gate 25 rollback target and final active artifact: accepted candidate `68881188c62028051c136de77cad4b7f2f1d38ca` for both Web and Worker.

Server connection details and credentials are supplied out-of-band to the operator/Codex session and must never be committed to this repository or pasted into this acceptance record.

## 3. Frozen truth and authority boundaries

These statements remain true throughout acceptance:

- AI/DeepSeek output is advisory and non-authoritative.
- Deterministic crawler, SEO, GEO, content, competitor, reporting, and Growth facts retain their existing authority.
- Official-provider visibility is authoritative only when actually sampled and persisted.
- Missing provider configuration or sampling remains explicit `not-configured/not-sampled`; it is never converted into a fabricated success/ranking state.
- Search Console remains read-only.
- Direct default-branch writes remain prohibited.
- `PR_CREATED != DEPLOYED != VERIFIED`.
- DeepSeek cannot approve, execute, merge, deploy, restore, or roll back.
- Distribution normally requires VERIFIED primary publication; manual handoff remains manual.
- Optimization/autopilot does not gain merge, deploy, or rollback authority.
- Settings configuration state does not equal provider health.

## 4. Twenty-five acceptance gates

Attach concrete evidence to every checked item. Repository-side gates 1–4 are checked from accepted-candidate main CI #2263. Gates 5–25 below were exercised against real staging.

1. [x] Integrated `main` CI `verify` is green, including Prisma validation/generation/migrations, Typecheck, full Vitest, and Build. Evidence: CI #2263 / run `33087173292`, `main@68881188c62028051c136de77cad4b7f2f1d38ca`.
2. [x] Integrated `main` CI `production-audit` is green for the deployable runtime dependency tree. Evidence: CI #2263 / run `33087173292`.
3. [x] Integrated `main` CI `e2e` is green, including the Chromium browser smoke suite. Evidence: CI #2263 / run `33087173292`.
4. [x] Production-mode environment validation rejects missing required infrastructure values (`DATABASE_URL`, `REDIS_URL`, and a valid `SESSION_SECRET`). Evidence: CI #2263 full Vitest includes the Release-01 environment fail-fast contract.
5. [x] The one-shot Migration role completes `prisma migrate deploy` successfully for the staging database before the application candidate is accepted. Evidence: exact migration image exited 0; 41 migrations found and none pending after the candidate backup.
6. [x] The Web role starts separately and `GET /health/live` succeeds through the intended staging path. Evidence: separate Web container, HTTPS response `200 {"status":"ok"}`.
7. [x] `GET /health/ready` succeeds with real staging PostgreSQL and Redis dependencies available. Evidence: HTTPS readiness returned `200 {"status":"ok"}` after dependency checks.
8. [x] The Worker role starts separately with `npm run start:worker`, connects successfully, and registers the existing worker set without booting Express. Evidence: separate no-port Worker, startup marker present, representative queue work completed.
9. [x] HTTPS login works through the intended trusted proxy using the configured `TRUST_PROXY_HOPS`; same-origin login succeeds, invalid/mismatched Origin is rejected, secure-session behavior is correct, and public redirects do not downgrade to HTTP. Evidence: same-origin login 303; invalid and malformed Origin 403; secure HttpOnly SameSite cookie; HTTP redirects to HTTPS.
10. [x] Project creation and read access work under the existing server-authoritative RBAC model without client-side permission expansion. Evidence: project created/read by its member; anonymous access returned 401 after PR #176; non-member tests are in green CI.
11. [x] A representative crawl executes through the Worker path and completes without moving crawler authority into the Web process. Evidence: manual crawl completed with one page succeeded and zero failed.
12. [x] SEO analysis completes from the persisted crawl/audit facts using the existing deterministic semantics. Evidence: deterministic audit completed, engine `0.1.0`, 20 rules, score 91.5.
13. [x] GEO/readiness facts remain visibly and semantically distinct from AI/official-provider visibility observations. Evidence: `GEO_READINESS_V1` score 42 with owned-site-only scope; `aiVisibility` remained null.
14. [x] At least one configured official-provider visibility path is exercised when staging credentials are available; when unavailable, the state remains explicitly `not-configured/not-sampled` and no ranking/sampling result is fabricated. Evidence: no provider credentials were configured; zero runs/observations and explicit not-configured/not-sampled UI states.
15. [x] DeepSeek advisory analysis works when configured and remains advisory only; it does not approve, execute, merge, deploy, verify, or roll back changes. Evidence: no DeepSeek key was configured; task failed explicitly with `AUTH`, Settings showed `NOT_CONFIGURED`, deterministic SEO facts were unchanged.
16. [x] The content lifecycle remains intact across its existing stages and preserves persisted fact/advisory boundaries. Evidence: Worker refresh persisted one document, nine signals, and five opportunities; valid status mutation succeeded and unsupported manual verification was rejected 400.
17. [x] Publication state truth is preserved exactly: `PR_CREATED != DEPLOYED != VERIFIED`, and no PR creation is presented as deployment or verification. Evidence: human draft versions persisted; no site/config or execution existed; UI showed `DEPLOYED != VERIFIED` and `NOT_CONFIGURED`.
18. [x] Distribution preserves VERIFIED-source requirements, `MANUAL_HANDOFF`, prepare-only/entity-platform behavior, and trusted server-side provider boundaries. Evidence: non-VERIFIED source rejected; runtime modes were Reddit/Medium `MANUAL_HANDOFF` and Wikidata `PREPARE_ONLY`.
19. [x] Report generation uses persisted snapshots and does not silently perform fresh crawl/provider sampling or invent missing provider facts. Evidence: `PROJECT_REPORT_V2` persisted 13 references; crawl/provider counts were unchanged during generation and visibility remained null.
20. [x] Optimization Operations preserves the global kill-switch posture and human merge/deployment/rollback boundaries; policy configuration does not become execution authority. Evidence: effective state `GLOBAL_KILL_SWITCH`; no policy record; UI remained read-only with human merge/deploy boundaries.
21. [x] Members & Permissions enforces existing server RBAC for read/mutation operations, including last-owner protection. Evidence: anonymous read 401; last-owner demotion and revocation both returned 409 `LAST_PROJECT_OWNER_REQUIRED`; owner remained active.
22. [x] Settings exposes no secrets/tokens/credential-bearing connection strings and does not represent configuration presence as live provider health. Evidence: rendered Settings matched none of the real secret/connection values; provider states remained `NOT_CONFIGURED` and UI states configuration is not health.
23. [x] A Worker restart demonstrates queue recovery/continuation and successful representative work without changing semantic or authorization authority. Evidence: corrected Worker logged SIGTERM shutdown and exited 0; work enqueued while stopped remained `QUEUED`; restart completed it on the second poll with one page succeeded.
24. [x] A staging PostgreSQL backup is created for the candidate and the documented restore procedure is successfully exercised against a clearly isolated non-production target. Evidence: PostgreSQL 17 archive list/restore passed; isolated target contained 41 migrations plus representative identity/evidence rows; loopback-only readiness returned `ok`; active staging stayed ready and was not overwritten.
25. [x] The previous known-good immutable application artifact can be redeployed for both Web and Worker according to `release-01-rollback.md`, with post-rollback health and queue checks recorded. Evidence: both roles rolled back from the checkpoint artifact to exact `68881188...`; live/ready were `ok`; session 200, invalid Origin 403, anonymous members 401, and last-owner mutation 409 remained intact; post-rollback crawl completed with one success and zero failures; both roles used the same image with zero restarts; all 41 forward migrations remained and no down-migration ran.

## 5. External evidence notes

For each external gate, record a short sanitized evidence reference such as:

- immutable image digest;
- staging request timestamp and response status;
- sanitized log excerpt identifier;
- provider observation identifier/state;
- backup file/snapshot ID and checksum;
- restore rehearsal target/result;
- rollback target SHA and post-rollback health result.

Never paste API keys, OAuth client secrets, access tokens, `SESSION_SECRET`, credential-encryption keys, login credentials, or credential-bearing database/Redis URLs into this record.

## 6. Execution ownership

External staging execution for Gates 5–25 is handed off to Codex using `release-01-codex-staging-handoff.md`. This changes only who performs the operational steps; it does not change any authority or truth boundary.

Codex may execute operator-approved staging commands and collect evidence. It must not invent evidence, weaken a failed gate, start P11, deploy Production, or grant DeepSeek/autopilot merge/deploy/rollback authority.

Any acceptance-record update after external execution must still go through a branch/PR rather than a direct default-branch write.

## 7. Failure handling

Any failed or unverifiable gate blocks Release-01 external staging acceptance. Record the failure, preserve sanitized evidence, and follow the relevant runbook:

- deployment/runtime failure → `release-01-staging-runbook.md`;
- database recovery concern → `release-01-backup-restore.md`;
- application rollback → `release-01-rollback.md`.

Do not mark a gate complete from intention, configuration presence, mocked provider state, local-only success, or a different external candidate identity.

## 8. Final decision

Current staging status is:

**STAGING READY — Release-01 P0-P10 staging only**

This means the exact repaired candidate has green integrated-main CI and real external evidence for all 25 Gates, including isolated restore and immutable application rollback rehearsals. The final active Staging Web and Worker remain on the accepted `68881188...` artifact.

Only after all 25 items are backed by evidence for the exact externally deployed staging candidate may Release-01 be described as **STAGING READY**.

Even then:

- `STAGING READY` does not mean `PRODUCTION DEPLOYED`;
- Production deployment requires a separate explicit operator instruction;
- this acceptance record does not authorize P11.
