# Release-01 Application Rollback Runbook

Status: **STAGING OPERATIONS RUNBOOK**  
Scope: operator-controlled Release-01 staging rollback  
Production deployment: **NOT AUTHORIZED BY THIS DOCUMENT**

## 1. Purpose

This runbook defines how an operator restores the application layer to a **previous known-good** Release-01/P10 artifact when a staging candidate is unhealthy or violates an acceptance boundary.

Rollback is an operator action. Web, Worker, DeepSeek, optimization, publication, distribution, and queue flows do not receive autonomous rollback authority.

## 2. Rollback identity

Before every staging rollout, record:

- candidate SHA/image identity;
- previous known-good SHA/image identity;
- database backup identifier created before migration;
- current Prisma migration state;
- operator identity and timestamp.

Never roll back to an unverified branch tip or a mutable `latest` image tag.

## 3. Rollback triggers

An operator should stop the rollout and evaluate rollback when any of these occur:

- migration fails;
- Web fails `/health/live` or `/health/ready`;
- Worker fails to start/register existing workers;
- HTTPS/proxy/session/origin behavior weakens;
- queue work does not recover after Worker restart;
- an existing RBAC, last-owner, publication, distribution, AI, or optimization authority boundary is violated;
- secrets are exposed;
- provider/configuration state is represented as fabricated health or sampling truth;
- a critical staging acceptance gate fails after rollout.

## 4. First containment

Before changing artifacts:

1. stop routing new staging traffic to the failing Web candidate when the platform supports it;
2. pause/stop the failing Worker candidate cleanly so it does not continue new work;
3. preserve logs and the candidate SHA;
4. determine whether the database migration completed;
5. determine whether the previous known-good application is schema-compatible with the current database.

Do not ask DeepSeek or any optimization flow to decide or execute rollback.

## 5. Application rollback when schema is compatible

If the database remains compatible with the previous application:

1. select the exact previous known-good immutable runtime artifact;
2. redeploy that artifact to the **Web** role;
3. redeploy the same previous known-good artifact to the **Worker** role;
4. keep the same operator-controlled staging environment and secrets unless a configuration defect itself caused the incident;
5. wait for Web `/health/live` and `/health/ready`;
6. verify Worker process startup, Redis connection, and worker registration;
7. execute focused smoke tests for the failed area plus login/RBAC/queue continuity;
8. record the rollback result.

Web and Worker must return to the same known-good release identity. Do not leave them on different application SHAs without a separately reviewed compatibility decision.

## 6. Database compatibility decision

Prisma migrations are forward migrations. Release-01 does not provide automatic down-migrations.

If the previous known-good application can operate safely against the forward-migrated schema, prefer application rollback only.

If it cannot, do not invent reverse SQL. Choose an operator-reviewed recovery path:

- restore the verified pre-migration backup using `release-01-backup-restore.md`; or
- prepare a reviewed **forward-fix** migration that restores compatibility.

A forward-fix requires the normal code review and exact-head verification process before use.

## 7. Database restore path

If restore is required:

- identify the exact pre-migration backup tied to the candidate SHA;
- assess data written after the backup and potential loss;
- rehearse/verify the restore procedure in a non-production target if not already proven;
- perform the recovery under explicit operator control;
- redeploy the previous known-good Web and Worker artifacts against the recovered database;
- rerun readiness and acceptance checks.

Application code does not initiate this procedure.

## 8. Configuration-related rollback

If the incident is caused by runtime configuration rather than code:

- correct the staging secret/configuration source under operator control;
- do not commit real secrets;
- keep `TRUST_PROXY_HOPS` constrained to the actual proxy topology;
- keep `CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH=true` unless an explicit staging test requires otherwise;
- verify that config presence is not reported as provider health.

A configuration correction does not change product authority.

## 9. DeepSeek and provider boundaries during rollback

During rollback:

- DeepSeek may remain available only as the existing advisory service;
- DeepSeek cannot approve, merge, deploy, roll back, or choose a database restore;
- visibility-provider states that were not sampled remain `not-configured/not-sampled` or the existing equivalent truth state;
- Search Console remains read-only;
- `PR_CREATED != DEPLOYED != VERIFIED` remains true.

## 10. Post-rollback verification

At minimum confirm:

- Web `/health/live` passes;
- Web `/health/ready` passes against real PostgreSQL and Redis;
- HTTPS login succeeds and invalid Origin remains rejected;
- Worker is running separately and accepts/completes representative queue work;
- existing RBAC/last-owner protections remain intact;
- no secret is exposed;
- the prior failed acceptance condition is no longer present;
- application and database release identities are recorded.

## 11. Closure record

Record:

- failed candidate SHA;
- rollback target SHA;
- database migration state;
- backup/restore identifier if used;
- reason for rollback;
- Web/Worker health results;
- operator and timestamp;
- follow-up action, including any required forward-fix.

Successful staging rollback proves the procedure, not Production readiness by itself. Production deployment remains a separate explicit operator decision outside Release-01.
