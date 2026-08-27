# Release-01 Staging Acceptance Record

Status: **STAGING DEPLOYABLE — external staging acceptance pending**  
Scope: P0-P10 Release-01 staging acceptance evidence  
Production deployment: **NOT AUTHORIZED BY THIS DOCUMENT**

## 1. Purpose

This document is the evidence record for the exact Release-01 staging candidate. It is intentionally fail-closed: an unchecked gate is not treated as passed, missing provider credentials are not treated as successful sampling, and repository/CI readiness is not represented as an external staging deployment.

Release-01 remains staging-only. It does not authorize P11 and does not authorize Production deployment.

## 2. Repository-side candidate identity

Repository-side handoff evidence was collected for this exact implementation candidate:

- Candidate SHA: `4a17fbfe0761662afaddb81fe58baee1527bce10`
- Base SHA: `1c258e0becc64c39148dcfea45722254a1eed217`
- Pull request: `#173` (`docs/release-01-production-readiness` -> `main`), still Draft and unmerged
- Exact-head CI: `#2249`, workflow run `33033331080`
- `verify`: PASS — Prisma validate/generate/migrate, Typecheck, full Vitest, Build
- `production-audit`: PASS
- `e2e`: PASS — Chromium browser smoke suite
- `deployment-artifact`: PASS — exact source SHA, runtime image build, migration image build, offline runtime-content check, and runtime Prisma CLI absence
- Diff audit: 25 changed files, limited to approved Release-01 runtime/env/proxy/process/packaging/CI/tests/runbooks/spec-plan scope; no Prisma schema/feature migration, P11 feature, UI redesign, autonomous deploy/rollback, or default-branch direct-write implementation was introduced
- Local isolated checkout note: the execution environment could not resolve `github.com` for `git clone`, so no claim of an additional local clone run is made; exact-head GitHub Actions is the authoritative repository verification evidence

The repository-side evidence above does not fill in external staging identity. Before external acceptance, record separately:

- Runtime image identity/digest: `<record immutable staging identity>`
- Migration image identity/digest: `<record immutable staging identity>`
- Previous known-good application artifact: `<record immutable identity>`
- PostgreSQL backup identifier/checksum: `<record backup evidence>`
- Staging public HTTPS origin: `<record staging URL>`
- Operator: `<record operator>`
- Acceptance started at UTC: `<record timestamp>`
- Acceptance completed at UTC: `<record timestamp>`

Do not combine CI from one implementation SHA with externally deployed images or processes from another implementation SHA without recording the relationship explicitly.

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

Attach concrete evidence to every checked item. Repository-side gates 1–4 are checked from exact-head CI #2249. Gates 5–25 remain unchecked until the required real staging/external operation is exercised. All 25 gates must be checked before external staging acceptance can be declared.

1. [x] Exact candidate CI `verify` is green, including Prisma validation/generation/migrations, Typecheck, full Vitest, and Build. Evidence: CI #2249 / run `33033331080`, candidate `4a17fbfe0761662afaddb81fe58baee1527bce10`.
2. [x] Exact candidate CI `production-audit` is green for the deployable runtime dependency tree. Evidence: CI #2249 / run `33033331080`.
3. [x] Exact candidate CI `e2e` is green, including the existing Chromium browser smoke suite. Evidence: CI #2249 / run `33033331080`.
4. [x] Production-mode environment validation rejects missing required infrastructure values (`DATABASE_URL`, `REDIS_URL`, and a valid `SESSION_SECRET`). Evidence: exact-head `verify` full Vitest in CI #2249 includes the Release-01 environment fail-fast contract.
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

For each external gate, record a short evidence reference such as:

- immutable image digest;
- staging request timestamp and response status;
- sanitized log excerpt identifier;
- provider observation identifier/state;
- backup file/snapshot ID and checksum;
- restore rehearsal target/result;
- rollback target SHA and post-rollback health result.

Never paste API keys, OAuth client secrets, access tokens, `SESSION_SECRET`, credential-encryption keys, or credential-bearing database/Redis URLs into this record.

## 6. Failure handling

Any failed or unverifiable gate blocks Release-01 external staging acceptance. Record the failure, preserve evidence, and follow the relevant runbook:

- deployment/runtime failure → `release-01-staging-runbook.md`;
- database recovery concern → `release-01-backup-restore.md`;
- application rollback → `release-01-rollback.md`.

Do not mark a gate complete from intention, configuration presence, mocked provider state, local-only success, or a different external candidate identity.

## 7. Final decision

Current repository-side status is:

**STAGING DEPLOYABLE — external staging acceptance pending**

This means the repository has exact-head CI evidence, reproducible Web/Worker/Migration packaging, and operator runbooks. It does **not** mean an external staging environment has been deployed or that gates 5–25 have been exercised.

Only after all 25 items are backed by evidence for the exact external staging candidate may Release-01 be described as **STAGING READY**.

Even then:

- `STAGING READY` does not mean `PRODUCTION DEPLOYED`;
- Production deployment requires a separate explicit operator instruction;
- this acceptance record does not authorize P11.
