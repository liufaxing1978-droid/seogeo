# Release-01 Production Readiness Design

Status: **REVIEW**  
Date: **2026-08-27**  
Base: `main@1c258e0becc64c39148dcfea45722254a1eed217`

## 1. Purpose

Release-01 turns the P0-P10 application from a CI-verified codebase into a repeatable **staging-ready runtime** without changing product semantics, provider truth, authorization boundaries, or deployment authority.

This release does **not** start P11 and does **not** authorize a production deployment. Its deliverable is a production-shaped staging runtime plus the operational contracts required to deploy it safely and repeatedly.

## 2. Frozen Authority and Truth Boundaries

Release-01 must preserve all P8-P10 authority boundaries:

- AI remains advisory only.
- Deterministic crawler, SEO, GEO, content, competitor, reporting, and Growth facts remain authoritative within their existing domains.
- P6 official-provider visibility observations are authoritative only when actually sampled and persisted; they must never be represented as consumer-app ranking facts.
- Search Console remains read-only.
- Direct default-branch writes remain prohibited.
- `PR_CREATED != DEPLOYED != VERIFIED` remains true.
- DeepSeek cannot approve, execute, merge, deploy, or roll back changes.
- Distribution normally requires a VERIFIED primary publication.
- `MANUAL_HANDOFF` remains manual.
- Community final actions remain human-operated.
- Optimization policy and controlled autopilot do not grant merge, deploy, or rollback authority.
- UI or settings pages must not imply that configured credentials equal live provider health.

Release-01 may add runtime/process/deployment mechanics only. It must not expand application permissions or autonomous authority.

## 3. Current Repository Facts

The current application already has a strong test/runtime foundation:

- Node.js runtime floor is 22.
- CI provisions PostgreSQL 17 and Redis 7.
- CI validates Prisma, generates the Prisma client, runs `prisma migrate deploy`, typechecks, runs the full Vitest suite, builds, performs a deployable-runtime dependency audit, and runs Playwright browser smoke tests.
- `src/server.ts` starts the Express application.
- `/health/live` exists for process liveness.
- `/health/ready` performs real PostgreSQL and Redis dependency checks.
- BullMQ worker registration already exists in `src/queue/worker-bootstrap.ts` through `startWorkers()`.
- The current `package.json` has `start: node dist/src/server.js` but no production worker command.
- The repository currently has no Dockerfile, Compose manifest, Procfile, or platform-specific deployment manifest.
- Production environment validation currently enforces a 32-character minimum `SESSION_SECRET`, but `DATABASE_URL`, `REDIS_URL`, and `SESSION_SECRET` still have development defaults at schema level.
- `env.ts` supports Google OAuth variables and `OAUTH_CREDENTIAL_ENCRYPTION_KEY`, while `.env.example` does not currently document those variables.
- Login origin validation derives expected origin from the Express request protocol and Host; the app does not currently establish an explicit trusted reverse-proxy contract.

These facts make the application testable and locally runnable, but not yet fully repeatable as a production-shaped Web + Worker deployment.

## 4. Chosen Runtime Architecture

Release-01 will use **one build artifact with three execution roles**:

1. **Migration role** — one-shot job that runs `prisma migrate deploy` before a new application release is accepted.
2. **Web role** — long-running process that starts Express/UI/API only.
3. **Worker role** — long-running process that starts BullMQ workers only.

PostgreSQL 17 and Redis 7 remain independent services.

TLS/HTTPS termination occurs in a reverse proxy or managed edge/load-balancer layer. The Node application receives forwarded scheme/host information through an explicit trusted-proxy contract.

This separation is intentionally platform-neutral. The application may later run on a VM/process manager, containers, or a managed deployment platform without changing the Web/Worker boundary.

## 5. Web / Worker Process Boundary

### 5.1 Web

The Web process must:

- start only the Express application;
- expose `/health/live` and `/health/ready`;
- terminate predictably on SIGTERM/SIGINT;
- never implicitly start queue workers;
- continue to enforce all existing session, RBAC, CSRF, provider, publication, distribution, and optimization rules.

### 5.2 Worker

A dedicated production worker entry point must call the existing `startWorkers()` registration path and own worker lifecycle shutdown.

The Worker process must:

- use the same validated environment contract as Web;
- connect to the same PostgreSQL and Redis services;
- register the existing queue set without changing queue semantics;
- close workers/connections cleanly on SIGTERM/SIGINT;
- fail startup when required production configuration is invalid;
- not expose an HTTP application merely to simulate process health.

The initial staging deployment uses one Worker replica unless evidence shows a queue requires different scaling. Release-01 does not introduce per-queue autoscaling.

## 6. Migration Contract

Database migration is a release step, not a Web-process side effect.

Required order:

1. build/install the candidate artifact;
2. validate production environment configuration;
3. create/verify a database backup according to the staging runbook;
4. execute `prisma migrate deploy` once;
5. start/update Web and Worker roles;
6. wait for readiness;
7. run Release-01 staging acceptance tests.

Web and Worker must not execute `prisma migrate dev`.

A migration failure blocks the release. A failed migration must not be hidden by starting the application anyway.

## 7. Production Environment Contract

When `NODE_ENV=production`, the application must fail fast rather than silently use development defaults for infrastructure secrets/connections.

Required production values:

- `DATABASE_URL`
- `REDIS_URL`
- `SESSION_SECRET` with at least 32 characters

Feature-dependent values remain conditional:

- DeepSeek features require the existing DeepSeek configuration.
- Search Console OAuth requires `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`, and `OAUTH_CREDENTIAL_ENCRYPTION_KEY` under the existing provider rules.
- Provider-specific visibility credentials remain optional unless their feature is enabled/used.

`.env.example` must document the complete non-secret variable surface supported by the runtime, including Google OAuth and credential-encryption settings. It must never contain real secrets.

The default `CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH=true` safety posture must remain unchanged unless an explicit operator decision changes it outside Release-01.

## 8. Reverse Proxy and HTTPS Contract

Staging is accepted only over HTTPS through the intended proxy path.

The application must explicitly configure Express proxy trust narrowly enough for the deployment topology. The goal is correct scheme/secure-cookie/origin behavior behind the trusted proxy without trusting arbitrary forwarded headers from untrusted hops.

Acceptance must include a real HTTPS login flow proving that:

- same-origin POST login succeeds;
- invalid/mismatched Origin remains rejected;
- secure session behavior is correct behind the proxy;
- redirects do not downgrade to HTTP;
- forwarded host/protocol values produce the expected public origin.

Release-01 must not weaken login origin validation merely to make proxy deployment convenient.

## 9. Health and Readiness

Existing health semantics remain the base contract:

- `/health/live` means the Web process is alive.
- `/health/ready` means required Web dependencies, including PostgreSQL and Redis, are ready.

The deployment platform must route traffic only to Web instances that pass readiness.

Worker health is operationally evaluated by:

- process liveness;
- successful Redis connection;
- successful worker registration/startup;
- queue acceptance/completion during staging smoke tests.

A new public Worker health endpoint is not required for Release-01.

## 10. Deployment Packaging

Release-01 must provide a **repeatable deployment packaging contract**, not merely a handwritten shell sequence.

The implementation plan may choose a minimal Docker-based packaging layer as the reference artifact because it can encode Node 22, dependency installation, build output, browser/runtime needs, and the Web/Worker command split consistently. Platform-specific production infrastructure is out of scope.

Packaging requirements:

- deterministic Node 22 base;
- production runtime dependencies only in the final runtime layer where practical;
- generated Prisma client present;
- built TypeScript output present;
- EJS/static assets included;
- Playwright/Chromium runtime support included only where crawler browser fallback requires it;
- no secrets baked into the image/artifact;
- identical artifact usable by Web and Worker commands.

The CI production dependency audit remains a required gate.

## 11. Logging and Operational Signals

Release-01 must establish a minimum deployable logging contract without introducing a full observability platform.

Minimum requirements:

- startup/shutdown events for Web and Worker;
- fatal startup/configuration failures written to stderr;
- worker startup/shutdown failures observable in logs;
- no API keys, OAuth client secrets, tokens, session secrets, database URLs with credentials, Redis credentials, or encryption keys logged;
- request/application behavior must not fabricate provider health from configuration presence.

A full metrics stack, distributed tracing, and external alerting platform are explicitly deferred.

## 12. Backup, Restore, and Rollback

Staging must have a documented rollback path before Release-01 is considered complete.

### 12.1 Database backup

Before migration, the operator must create a PostgreSQL backup/snapshot appropriate to the hosting platform. The runbook must record the backup identifier and release SHA.

### 12.2 Application rollback

Application rollback means redeploying the previous known-good immutable artifact/commit for both Web and Worker.

### 12.3 Database rollback

Prisma migrations are treated as forward migrations. Release-01 must not invent automatic down-migrations. If a migration is incompatible with rollback, recovery uses the documented backup/restore procedure or a forward-fix migration after operator review.

### 12.4 Authority boundary

No application code, DeepSeek flow, optimization flow, or queue worker receives autonomous rollback authority.

## 13. Staging Acceptance Gate

Release-01 is complete only when all of the following pass against the exact staging candidate:

1. CI `verify` is green.
2. CI `production-audit` job is green.
3. CI `e2e` is green.
4. Production environment validation rejects missing required infrastructure values.
5. Migration job completes successfully.
6. Web process starts and `/health/live` passes.
7. `/health/ready` passes with real PostgreSQL and Redis.
8. Worker process starts separately and registers existing workers.
9. HTTPS login works through the trusted proxy and invalid Origin is still rejected.
10. Project creation/read access works under existing RBAC.
11. Crawl execution completes through the Worker path.
12. SEO analysis completes.
13. GEO/readiness and visibility truth remain distinct.
14. At least one configured official-provider visibility path is exercised when credentials are available; otherwise it remains explicitly not-configured/not-sampled rather than fabricated.
15. DeepSeek advisory analysis works when configured and remains non-authoritative.
16. Content lifecycle behavior remains intact.
17. Publication state truth preserves `PR_CREATED != DEPLOYED != VERIFIED`.
18. Distribution preserves VERIFIED/manual-handoff/provider boundaries.
19. Report generation uses persisted snapshots rather than fresh provider/crawl invention.
20. Optimization operations preserve kill-switch and human deployment boundaries.
21. Members/permissions enforce existing server RBAC, including last-owner protection.
22. Settings never expose secrets and do not represent configuration as live health.
23. Worker restart demonstrates queue recovery/continuation without changing semantic authority.
24. Staging database backup is created and a restore procedure is exercised in a non-production target.
25. Previous known-good application artifact can be redeployed according to the rollback runbook.

Failure of any item blocks Release-01 closure.

## 14. CI Changes Required by Release-01

Implementation must extend CI only where needed to prove new runtime contracts. At minimum, tests must cover:

- production environment fail-fast behavior;
- dedicated Worker entry/startup contract without booting Express;
- Web entry does not implicitly start workers;
- trusted-proxy HTTPS/origin behavior;
- deployment artifact/build command integrity;
- existing full test/build/audit/e2e gates remain green.

Tests should follow RED -> minimal GREEN -> exact-head full CI for each independently reviewable runtime change.

## 15. Files Expected to Change During Implementation

The implementation plan should keep changes focused around these responsibilities:

- `package.json` — production Web/Worker commands.
- `src/server.ts` — Web startup/shutdown and proxy-aware runtime integration where appropriate.
- `src/queue/worker-bootstrap.ts` — reuse existing worker registration; only lifecycle adjustments if required.
- a new focused Worker entry file under `src/queue/` or `src/`.
- `src/config/env.ts` — production fail-fast validation.
- `.env.example` — complete non-secret environment contract.
- `src/app.ts` or a dedicated proxy configuration helper — explicit trusted-proxy behavior.
- focused unit/integration/e2e tests for the above contracts.
- deployment packaging files.
- `docs/development/` runbook(s) for staging deploy, backup/restore, rollback, and acceptance evidence.
- `.github/workflows/ci.yml` only for verifiable Release-01 gates that are not already covered.

No Prisma schema change is required by this design unless implementation uncovers a concrete production-readiness defect that cannot be solved without one; such a discovery requires a separate scope review before proceeding.

## 16. Explicitly Out of Scope

Release-01 does not include:

- P11 product development;
- production deployment;
- autonomous merge/deploy/rollback;
- new SEO/GEO/AI/visibility product features;
- new provider integrations;
- a new authorization model;
- UI redesign;
- database feature schema expansion;
- Kubernetes;
- autoscaling design;
- full external observability stack;
- secrets-manager vendor selection;
- multi-region/high-availability architecture;
- automatic database down-migrations.

## 17. Completion Definition

Release-01 is **STAGING READY** when the exact candidate is reproducibly deployable as Migration + Web + Worker roles, passes all staging acceptance gates, has a tested backup/restore and application rollback procedure, and preserves all existing product truth and authority boundaries.

`STAGING READY` does not mean `PRODUCTION DEPLOYED`.

Production deployment requires a separate explicit operator instruction after Release-01 evidence is reviewed.
