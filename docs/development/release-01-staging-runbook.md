# Release-01 Staging Deployment Runbook

Status: **STAGING OPERATIONS RUNBOOK**  
Scope: P0-P10 Release-01 only  
Production deployment: **NOT AUTHORIZED BY THIS DOCUMENT**

## 1. Purpose

This runbook defines the operator-controlled procedure for deploying an exact Release-01 candidate to a production-shaped **staging** environment. It preserves the frozen authority boundaries from P8-P10 and does not start P11.

The runtime has three roles built from the same candidate source:

- Migration — one-shot schema migration role.
- Web — Express/UI/API role only.
- Worker — BullMQ worker role only.

PostgreSQL 17 and Redis 7 remain external services. HTTPS terminates at the intended reverse proxy or managed edge.

## 2. Preconditions

Before any staging deployment, record:

- candidate SHA: the exact Git commit being evaluated;
- CI run proving `verify`, `production-audit`, `e2e`, and `deployment-artifact` for that candidate;
- previous known-good staging application SHA/image;
- PostgreSQL backup identifier;
- operator identity and deployment timestamp.

Do not continue if the candidate SHA differs from the SHA that produced the accepted CI artifacts.

## 3. Required staging environment

Use a staging-only secret source. Never commit the real environment file or pass real secrets as Docker build arguments.

Required when `NODE_ENV=production`:

```text
NODE_ENV=production
DATABASE_URL=<staging PostgreSQL URL>
REDIS_URL=<staging Redis URL>
SESSION_SECRET=<staging secret, at least 32 characters>
TRUST_PROXY_HOPS=<exact trusted proxy hop count>
```

Feature-dependent values are supplied only when those staging features are being exercised. Examples include DeepSeek, Google OAuth/Search Console, and official visibility-provider credentials. Configuration presence does not prove provider health.

Keep `CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH=true` unless an explicit operator decision for the staging test says otherwise.

`TRUST_PROXY_HOPS` must match the actual staging topology. Do not increase it merely to make forwarded headers work.

## 4. Build the exact candidate

From a clean checkout of the candidate SHA:

```bash
CANDIDATE_SHA="$(git rev-parse HEAD)"
git status --short

docker build --target runtime -t "seogeo-runtime:${CANDIDATE_SHA}" .
docker build --target migration -t "seogeo-migration:${CANDIDATE_SHA}" .
```

The runtime image is shared by Web and Worker. The migration image exists only for schema deployment.

Do not bake `.env`, API keys, OAuth secrets, tokens, database credentials, Redis credentials, or encryption keys into either image.

## 5. Backup before migration

Create and verify the staging PostgreSQL backup according to `release-01-backup-restore.md` before applying migrations. Record the backup identifier alongside the candidate SHA.

A missing or unverified backup blocks the migration step.

## 6. Run the migration role once

The migration role runs the deploy-only Prisma command:

```bash
npx prisma migrate deploy
```

With the Release-01 migration image, run the one-shot container with the staging runtime environment attached. The image default command is the same `prisma migrate deploy` operation.

Migration rules:

- run once per candidate rollout;
- never run `prisma migrate dev` in staging;
- migration failure blocks Web/Worker rollout;
- do not hide a migration failure by starting the application anyway.

## 7. Start or update the Web role

The Web role uses the runtime image and the repository's production command:

```bash
npm start
```

Operational requirements:

- exactly the candidate runtime image;
- staging environment injected at runtime;
- no queue worker is implicitly started by Web;
- only the reverse proxy/load balancer exposes the public HTTPS endpoint;
- traffic is routed only after readiness succeeds.

Verify liveness:

```bash
curl --fail --silent --show-error https://<staging-host>/health/live
```

Verify readiness:

```bash
curl --fail --silent --show-error https://<staging-host>/health/ready
```

`/health/live` proves Web process liveness. `/health/ready` must prove real PostgreSQL and Redis readiness; do not replace it with a static success response.

## 8. Start or update the Worker role

Run a separate process/container from the same runtime image with:

```bash
npm run start:worker
```

The Worker must:

- use the same validated staging environment contract;
- connect to the same staging PostgreSQL and Redis services;
- register the existing queue set;
- not expose Express merely to simulate health;
- shut down cleanly on SIGTERM/SIGINT;
- remain observable through process state and logs.

Use one Worker replica for initial Release-01 staging acceptance unless a later explicit scaling decision changes that.

## 9. Reverse proxy and HTTPS acceptance

Staging acceptance is valid only through the intended HTTPS proxy path.

Confirm all of the following:

- browser/public URL is HTTPS;
- forwarded protocol and host are accepted only through the configured trusted proxy hops;
- `TRUST_PROXY_HOPS` equals the actual trusted-hop count;
- same-origin login POST succeeds;
- mismatched/invalid Origin remains rejected;
- secure-session behavior works behind the proxy;
- redirects never downgrade the public URL to HTTP.

Do not weaken origin validation or trust arbitrary forwarded headers to make the deployment pass.

## 10. Smoke sequence

After Web readiness and Worker startup:

1. log in through the real HTTPS staging URL;
2. open/create a staging project under existing RBAC;
3. execute a crawl through the Worker path;
4. run SEO analysis;
5. inspect GEO/readiness separately from visibility facts;
6. exercise an official-provider visibility path only when credentials are configured; otherwise preserve `not-configured/not-sampled`;
7. run DeepSeek advisory analysis only when configured;
8. exercise content lifecycle, publication truth, distribution boundaries, reporting, optimization, Members, and Settings;
9. restart the Worker and prove queue recovery/continuation;
10. complete all 25 gates in `release-01-staging-acceptance.md`.

## 11. Logging and secret handling

Required operational signals:

- Web startup/shutdown;
- Worker startup/shutdown;
- fatal configuration/startup failures on stderr;
- worker registration or shutdown failures;
- migration result and candidate SHA in the external deployment record.

Never log API keys, OAuth client secrets, access tokens, `SESSION_SECRET`, credential-encryption keys, or full credential-bearing database/Redis URLs.

## 12. Stop conditions

Stop the staging rollout immediately if any of these occur:

- candidate SHA mismatch;
- backup not verified;
- `prisma migrate deploy` failure;
- Web `/health/ready` failure;
- Worker cannot register/connect;
- HTTPS/origin/session behavior weakens;
- a UI/API surface fabricates provider health or deployment truth;
- any frozen authorization/AI/publication/distribution/optimization boundary is violated.

Use `release-01-rollback.md` for operator-controlled application rollback. Database recovery follows `release-01-backup-restore.md`.

## 13. Completion statement

A successful run of this document makes the exact candidate **staging-deployable** only. It does not mean Production deployed, does not authorize a production cutover, and does not authorize P11.
