# P12 — Production Release Checklist

Date: 2026-09-04

Status: **NOT AUTHORIZED FOR PRODUCTION**

This checklist defines the release gate after P12 hardening freeze. It is intentionally fail-closed. Completing repository-side verification does not itself authorize merge or deployment.

## 1. Release identity

Before any Production action, record and freeze all of the following:

- [ ] Draft closure PR number.
- [ ] Exact final PR head SHA.
- [ ] Exact target `main` SHA immediately before merge authorization.
- [ ] Exact successful CI workflow/run IDs for the final PR head.
- [ ] Exact immutable deployment artifact/image identity produced from the authorized SHA.

Never substitute a prior branch SHA, PR head, merge commit or historical CI run for the actual release candidate.

## 2. Required exact-head CI

The final closure SHA must complete the repository's full release gates successfully:

- [ ] Prisma validate.
- [ ] Prisma generate.
- [ ] Migration verification / isolated `migrate deploy` gate.
- [ ] Typecheck.
- [ ] Full Vitest.
- [ ] Build.
- [ ] Playwright E2E.
- [ ] `production-audit`.
- [ ] `deployment-artifact`.

A cancelled, skipped, stale, superseded or different-SHA result is not acceptance evidence.

## 3. P12 safety-contract confirmation

Confirm the frozen P12 controls remain represented by tests on the release candidate:

- [ ] Automation Definition management API is project-scoped and strictly validated.
- [ ] Definition mutations and reconciliation retain RBAC + CSRF protection.
- [ ] Runtime scheduler reconciliation rejects unsafe persisted definitions.
- [ ] Worker startup reconciliation runs before automation readiness and fails closed.
- [ ] `SKIP_IF_RUNNING` overlap behavior remains atomic.
- [ ] Active request idempotency remains intact.
- [ ] Skipped-run request identity remains intact.
- [ ] Initial enqueue failure compensation remains intact.
- [ ] Retry enqueue compensation/deadline semantics remain intact.
- [ ] Overdue `RUNNING` and `QUEUED` runs are eligible for timeout repair.

## 4. Database and migration gate

Before deployment:

- [ ] Review all pending migrations between current Production and the authorized SHA.
- [ ] Confirm migrations are forward-safe for the existing Production schema/data volume.
- [ ] Confirm required PostgreSQL extensions/functions/permissions are available.
- [ ] Confirm migration execution uses the migration image/target, not the web runtime by accident.
- [ ] Take and verify a restorable Production database backup/snapshot according to the operating runbook.
- [ ] Record backup identity/checksum out-of-band without committing credentials or private connection details.
- [ ] Do not run destructive/down migrations as an implicit rollback mechanism.

## 5. Runtime configuration gate

Confirm Production configuration exists without exposing secrets in Git:

- [ ] Web and Worker use the same authorized application release identity.
- [ ] PostgreSQL connectivity is configured.
- [ ] Redis/BullMQ connectivity is configured.
- [ ] Session/CSRF secrets are present and valid.
- [ ] Provider/API credentials required by enabled features are present server-side only.
- [ ] Optional provider features remain disabled/fail-closed when their credentials are absent.
- [ ] Production base URLs/origins/callback URLs are correct.
- [ ] No staging/test credentials or fixture transports are enabled in Production.

## 6. Automation scheduler pre-deploy gate

Because P12 introduces a durable automation control plane, verify the operational state before rollout:

- [ ] Review enabled `AutomationDefinition` rows and cron/config values.
- [ ] Confirm unsupported/invalid definitions do not exist, or remediate them before startup.
- [ ] Confirm current active `AutomationRun` backlog is understood.
- [ ] Confirm no stale `QUEUED`/`RUNNING` backlog will create unexpected overlap blockers.
- [ ] Confirm timeout/retry limits are operationally acceptable.
- [ ] Confirm startup reconciliation is expected to complete with current Redis/BullMQ availability.

If startup reconciliation cannot complete, the release must fail closed rather than bypass the check.

## 7. Deployment authorization gate

These are separate human decisions:

- [ ] Explicit authorization to move the Draft PR out of Draft / merge it.
- [ ] Required review/approval completed.
- [ ] Merge target and exact SHA revalidated immediately before merge.
- [ ] Explicit authorization to deploy Production **after** merge/release identity is known.

Repository completion or green CI does not satisfy either authorization automatically.

## 8. Deployment execution gate

Only after explicit deployment authorization:

- [ ] Freeze the immutable deployment artifact/image digest.
- [ ] Apply forward migrations once, with output captured in the release evidence.
- [ ] Deploy Web and Worker from the same authorized release.
- [ ] Confirm processes remain healthy without restart loops.
- [ ] Confirm HTTPS/live/ready probes.
- [ ] Confirm worker startup reconciliation completes successfully.
- [ ] Confirm BullMQ queues/workers are connected and processing expected jobs.

## 9. Post-deploy acceptance

Run bounded, non-destructive Production smoke verification:

- [ ] Authentication/session/origin/CSRF behavior.
- [ ] Project membership/RBAC boundaries.
- [ ] Operations / Today surface loads from persisted facts.
- [ ] Automation definitions can be read only within project scope.
- [ ] Protected automation writes reject insufficient capability or invalid CSRF.
- [ ] Scheduler reconciliation is authorized and project-scoped.
- [ ] Automation run visibility is project-scoped.
- [ ] A deliberately bounded operator-approved automation probe, if used, has one traceable run identity and no duplicate delivery effects.
- [ ] Alert/operations surfaces show expected persisted state without fabricated success.
- [ ] Existing crawler/SEO/GEO/content/visibility/growth/publication paths remain healthy for representative reads.

Do not create real external provider writes merely to prove a smoke test unless that provider action is separately authorized.

## 10. Rollback readiness

Before declaring the rollout accepted:

- [ ] Preserve the previous known-good Web/Worker image identities.
- [ ] Confirm rollback means application rollback to a known-good image while keeping forward migrations unless an approved data recovery plan says otherwise.
- [ ] Confirm database backup restore procedure is available for genuine data-loss scenarios.
- [ ] Confirm operator access needed for rollback is available.
- [ ] Record rollback/recovery evidence without secrets.

## 11. Production acceptance record

Production may be marked accepted only after recording:

- authorized source SHA;
- merge/release identity;
- exact successful CI run IDs;
- immutable Web/Worker artifact/image identities;
- migration result;
- health/readiness result;
- startup reconciliation result;
- bounded smoke-test result;
- rollback identity/readiness;
- explicit human deployment authorization.

Until those facts exist, the correct status remains:

**P12 IMPLEMENTATION COMPLETE / HARDENING FROZEN — PRODUCTION NOT DEPLOYED.**
