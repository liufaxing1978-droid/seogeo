# Release-01 Staging Acceptance Record

Status: **STAGING DEPLOYABLE — external staging acceptance pending**  
Scope: P0-P10 Release-01 staging acceptance evidence  
Production deployment: **NOT AUTHORIZED BY THIS DOCUMENT**

## 1. Purpose

This document is the evidence record for Release-01 staging acceptance. It is intentionally fail-closed: an unchecked gate is not treated as passed, missing provider credentials are not treated as successful sampling, and repository/CI readiness is not represented as an external staging deployment.

Release-01 remains staging-only. It does not authorize P11 and does not authorize Production deployment.

## 2. Repository-side integrated identity

Repository integration is complete and has post-merge evidence:

- Integrated main: `main@d33e8f4e16876f0d50c7c4e5c9313a9270b87f32`
- PR #173 merged into `main`
- Main CI: CI #2251, workflow run `33037317158`
- `verify`: PASS — Prisma validate/generate/migrate, Typecheck, full Vitest, Build
- `production-audit`: PASS
- `e2e`: PASS — Chromium browser smoke suite and screenshot artifacts
- `deployment-artifact`: PASS — exact source SHA, runtime image build, migration image build, offline runtime-content check, and runtime Prisma CLI absence
- Original Release-01 PR head: `25ea91078fa43e1bf1547075ad0e42990d3075e4`
- Original Release-01 base before integration: `1c258e0becc64c39148dcfea45722254a1eed217`
- Diff audit remained limited to approved Release-01 runtime/env/proxy/process/packaging/CI/tests/runbooks/spec-plan scope; no Prisma schema/feature migration, P11 feature, UI redesign, autonomous deploy/rollback, or default-branch direct-write implementation was introduced

The repository-side evidence above does not fill in external staging identity. Codex must freeze the exact `main` SHA it will actually deploy and verify that SHA has green repository CI before external acceptance begins. If `main` has moved beyond the integrated baseline above, do not silently combine the old CI identity with a newer deployed artifact.

Before external acceptance, record separately and without secrets:

- exact deployed source SHA;
- runtime image identity/digest;
- migration image identity/digest;
- previous known-good application artifact;
- PostgreSQL backup identifier/checksum;
- staging public HTTPS origin;
- operator;
- acceptance start/completion timestamps in UTC.

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

Attach concrete evidence to every checked item. Repository-side gates 1–4 are checked from post-merge main CI #2251. Gates 5–25 remain unchecked until the required real staging/external operation is exercised. All 25 gates must be checked before external staging acceptance can be declared.

1. [x] Integrated `main` CI `verify` is green, including Prisma validation/generation/migrations, Typecheck, full Vitest, and Build. Evidence: CI #2251 / run `33037317158`, `main@d33e8f4e16876f0d50c7c4e5c9313a9270b87f32`.
2. [x] Integrated `main` CI `production-audit` is green for the deployable runtime dependency tree. Evidence: CI #2251 / run `33037317158`.
3. [x] Integrated `main` CI `e2e` is green, including the Chromium browser smoke suite. Evidence: CI #2251 / run `33037317158`.
4. [x] Production-mode environment validation rejects missing required infrastructure values (`DATABASE_URL`, `REDIS_URL`, and a valid `SESSION_SECRET`). Evidence: CI #2251 full Vitest includes the Release-01 environment fail-fast contract.
5. [ ] The one-shot Migration role completes `prisma migrate deploy` successfully for the staging database before the application candidate is accepted.
6. [ ] The Web role starts separately and `GET /health/live` succeeds through the intended staging path.
7. [ ] `GET /health/ready` succeeds with real staging PostgreSQL and Redis dependencies available.
8. [ ] The Worker role starts separately with `npm run start:worker`, connects successfully, and registers the existing worker set without booting Express.
9. [ ] HTTPS login works through the intended trusted proxy using the configured `TRUST_PROXY_HOPS`; same-origin login succeeds, invalid/mismatched Origin is rejected, secure-session behavior is correct, and public redirects do not downgrade to HTTP.
10. [ ] Project creation and read access work under the existing server-authoritative RBAC model without client-side permission expansion.
11. [ ] A representative crawl executes through the Worker path and completes without moving crawler authority into the Web process.
12. [ ] SEO analysis completes from the persisted crawl/audit facts using the existing deterministic semantics.
13. [ ] GEO/readiness facts remain visibly and semantically distinct from AI/official-provider visibility observations.
14. [ ] At least one configured official-provider visibility path is exercised when staging credentials are available; when unavailable, the state remains explicitly `not-configured/not-sampled` and no ranking/sampling result is fabricated.
15. [ ] DeepSeek advisory analysis works when configured and remains advisory only; it does not approve, execute, merge, deploy, verify, or roll back changes.
16. [ ] The content lifecycle remains intact across its existing stages and preserves persisted fact/advisory boundaries.
17. [ ] Publication state truth is preserved exactly: `PR_CREATED != DEPLOYED != VERIFIED`, and no PR creation is presented as deployment or verification.
18. [ ] Distribution preserves VERIFIED-source requirements, `MANUAL_HANDOFF`, prepare-only/entity-platform behavior, and trusted server-side provider boundaries.
19. [ ] Report generation uses persisted snapshots and does not silently perform fresh crawl/provider sampling or invent missing provider facts.
20. [ ] Optimization Operations preserves the global kill-switch posture and human merge/deployment/rollback boundaries; policy configuration does not become execution authority.
21. [ ] Members & Permissions enforces existing server RBAC for read/mutation operations, including last-owner protection.
22. [ ] Settings exposes no secrets/tokens/credential-bearing connection strings and does not represent configuration presence as live provider health.
23. [ ] A Worker restart demonstrates queue recovery/continuation and successful representative work without changing semantic or authorization authority.
24. [ ] A staging PostgreSQL backup is created for the candidate and the documented restore procedure is successfully exercised against a clearly isolated non-production target.
25. [ ] The previous known-good immutable application artifact can be redeployed for both Web and Worker according to `release-01-rollback.md`, with post-rollback health and queue checks recorded.

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

Current repository-side status is:

**STAGING DEPLOYABLE — external staging acceptance pending**

This means the repository has integrated-main CI evidence, reproducible Web/Worker/Migration packaging, and operator runbooks. It does **not** mean an external staging environment has been deployed or that Gates 5–25 have been exercised.

Only after all 25 items are backed by evidence for the exact externally deployed staging candidate may Release-01 be described as **STAGING READY**.

Even then:

- `STAGING READY` does not mean `PRODUCTION DEPLOYED`;
- Production deployment requires a separate explicit operator instruction;
- this acceptance record does not authorize P11.
