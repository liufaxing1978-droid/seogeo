# Release-01 Codex Staging Handoff

Status: **STAGING DEPLOYABLE — external staging acceptance pending**  
Scope: external staging execution for Release-01 P0-P10 Gates 5–25 only.

## 1. Purpose

This document is the operational handoff for completing Release-01 external staging acceptance in Codex. Repository development, packaging, integration, and post-merge CI are already complete. The remaining work is real staging execution and evidence collection.

At the start of the Codex session, **supply server connection details out-of-band**. Do not commit server addresses, usernames, credentials, private keys, API keys, tokens, database URLs, Redis URLs, or staging secrets to this repository.

Do not start P11.  
Do not deploy Production.

## 2. Integrated baseline

The completed Release-01 baseline is:

- repository: `liufaxing1978-droid/seogeo`;
- integrated baseline: `main@d33e8f4e16876f0d50c7c4e5c9313a9270b87f32`;
- integration PR: #173, merged;
- post-merge main CI: #2251, workflow run `33037317158`;
- `verify`, `production-audit`, `e2e`, and `deployment-artifact`: PASS.

Before deploying, Codex must fetch the current `main`, freeze the exact SHA it will deploy, and verify that SHA has green main CI. If `main` has advanced beyond the baseline, treat the newer SHA as a new exact candidate and do not reuse old CI identity without verification.

## 3. Read these files first

Codex must read these repository documents before touching staging:

1. `docs/development/release-01-staging-runbook.md`
2. `docs/development/release-01-backup-restore.md`
3. `docs/development/release-01-rollback.md`
4. `docs/development/release-01-staging-acceptance.md`
5. `Dockerfile`
6. `.env.example`

The acceptance record is the source of truth for which gates are complete. An unchecked gate remains incomplete.

## 4. Frozen authority and truth boundaries

These boundaries remain mandatory during Codex execution:

- AI/DeepSeek is advisory only.
- DeepSeek cannot approve, execute, merge, deploy, restore, or roll back.
- Search Console remains read-only.
- `PR_CREATED != DEPLOYED != VERIFIED` remains true.
- Missing provider configuration or sampling stays `not-configured/not-sampled`.
- Settings configuration presence is not provider health.
- Distribution keeps VERIFIED-source and `MANUAL_HANDOFF` boundaries.
- Controlled autopilot keeps no merge/deploy/rollback authority.
- `CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH=true` remains the default safety posture unless an explicit staging test requires otherwise.
- Acceptance-document changes go through a branch/PR; do not write directly to the default branch.

## 5. Staging execution sequence

Execute the remaining gates in order and stop on a failed or unverifiable prerequisite.

### Gate 5 — migration

1. Freeze and record the exact deployment SHA.
2. Build immutable runtime and migration images from that SHA.
3. Record image identities/digests.
4. Create the required pre-migration PostgreSQL backup.
5. Run the migration role exactly once using:

```bash
npx prisma migrate deploy
```

Do not use `prisma migrate dev` in staging. Migration failure blocks Web and Worker rollout.

### Gates 6–9 — Web, readiness, Worker, HTTPS

For Gate 6, start Web separately with the production Web command and prove public liveness through the intended staging path:

```text
/health/live
```

For Gate 7, prove readiness against real staging PostgreSQL and Redis:

```text
/health/ready
```

For Gate 8, start Worker separately with `npm run start:worker`. Verify it registers the existing worker set, connects to the same staging data services, does not boot Express, and shuts down cleanly.

For Gate 9, configure the intended HTTPS reverse proxy/edge and exact `TRUST_PROXY_HOPS`. Verify same-origin login succeeds, invalid/mismatched Origin is rejected, secure-session behavior is correct, and public redirects never downgrade to HTTP.

### Gates 10–13 — deterministic product paths

- Gate 10: project creation/read and server-authoritative RBAC.
- Gate 11: representative crawl through the Worker path.
- Gate 12: SEO analysis from persisted deterministic crawl/audit facts.
- Gate 13: GEO/readiness remains separate from AI/official-provider visibility observations.

Record only evidence produced by the exact deployed candidate.

### Gates 14–15 — provider and DeepSeek paths

For Gate 14, exercise an official-provider visibility path only when staging credentials are actually configured. If they are absent, preserve explicit `not-configured/not-sampled`; do not manufacture a ranking or sampling result.

For Gate 15, exercise DeepSeek only when configured. Confirm its output remains advisory and cannot become approval, execution, merge, deployment, verification, restore, or rollback authority.

### Gates 16–22 — application truth and authorization

- Gate 16: content lifecycle and persisted fact/advisory boundaries.
- Gate 17: publication truth, including `PR_CREATED != DEPLOYED != VERIFIED`.
- Gate 18: distribution VERIFIED-source, manual-handoff, and provider boundaries.
- Gate 19: report snapshots without silent fresh crawl/provider sampling.
- Gate 20: Optimization Operations global kill switch and human deployment/rollback boundaries.
- Gate 21: Members & Permissions RBAC and last-owner protection.
- Gate 22: Settings contains no secrets and does not fake provider health.

### Gate 23 — Worker restart recovery

With representative queued work, restart the Worker process/container and prove queue recovery/continuation. Do not change retry, semantic, or authorization contracts merely to make the test pass.

### Gate 24 — backup and restore rehearsal

Create/confirm the candidate staging PostgreSQL backup and execute the documented restore process against a clearly isolated non-production restore target. Record backup identity/checksum, restore target, and outcome. Never restore into Production as part of this gate.

### Gate 25 — previous artifact rollback rehearsal

Use the documented previous known-good immutable application artifact for both Web and Worker. Redeploy it under operator control and record post-rollback Web health and queue/Worker checks. Database migrations remain forward-fix by default; do not invent an automatic down-migration.

After the rehearsal, the operator may return staging to the candidate if desired, but that action must also be recorded.

## 6. Evidence contract

For every Gate 5 through Gate 25, record sanitized evidence in the acceptance record. Useful evidence includes:

- exact source SHA;
- immutable image digest;
- command/result identifier;
- sanitized timestamped Web/Worker log excerpt;
- HTTP path/status and timestamp;
- persisted crawl/audit/report/provider observation identifier;
- backup checksum and isolated restore result;
- rollback artifact identity and post-rollback health result.

Never record secret values or full credential-bearing connection strings. Redact credentials before putting evidence in GitHub.

A configured provider is not automatically a passing provider gate. A mocked response is not external staging evidence. A successful command against a different SHA is not evidence for the active candidate.

## 7. Stop conditions

Codex must stop the acceptance sequence and report the exact blocker if any of these occur:

- exact SHA/CI identity cannot be established;
- pre-migration backup is unavailable;
- `prisma migrate deploy` fails;
- `/health/live` or `/health/ready` fails;
- Worker cannot start/register/connect;
- HTTPS/origin/session behavior is weakened;
- a required truth or authority boundary is violated;
- a backup restore or rollback rehearsal cannot be safely isolated;
- evidence cannot be tied to the exact deployed candidate.

Do not mark blocked gates complete.

## 8. Completion rule

The starting state is:

**STAGING DEPLOYABLE — external staging acceptance pending**

Only after Gates 5–25 have concrete evidence and all 25 acceptance items are checked may the exact candidate be described as **STAGING READY**.

`STAGING READY` still does not mean Production deployed. Do not deploy Production. Do not start P11.

## 9. Ready-to-paste Codex kickoff prompt

Use this as the opening instruction in the Codex deployment session:

> Work in `liufaxing1978-droid/seogeo` from current `main`. Read `docs/development/release-01-staging-runbook.md`, `release-01-backup-restore.md`, `release-01-rollback.md`, `release-01-staging-acceptance.md`, and `release-01-codex-staging-handoff.md` before executing anything. Freeze the exact `main` SHA you will deploy and verify its main CI is green. I will supply server connection details out-of-band; never commit or echo credentials. Execute Release-01 external staging Gates 5–25 in order, record only sanitized evidence, and update the acceptance record through a branch/PR. Stop on any failed or unverifiable gate. Do not start P11. Do not deploy Production. Do not weaken truth/authority boundaries or give DeepSeek/autopilot merge, deploy, restore, or rollback authority.
