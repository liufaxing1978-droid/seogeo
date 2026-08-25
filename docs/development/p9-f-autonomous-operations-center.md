# P9-F Autonomous Operations Center — Development and Authority Guide

## Purpose

P9-F is a project-scoped Operations Center over persisted facts produced by P7 through P9-E. It gives an operator one SSR dashboard and bounded read APIs for understanding the optimization pipeline, current action inbox, experiment outcomes, learned feedback, quota usage, policy state, and recent activity.

P9-F is deliberately not a new execution engine. It must not broaden the authority already owned by P9-C or P8. In particular, P9-F does not gain direct Merge, Deploy, or Rollback authority, does not call AI/search/visibility providers from its GET paths, and does not mutate the global kill switch.

The primary UI route is:

`/projects/:id/optimization`

The primary overview API is:

`/api/v1/projects/:projectId/optimization/operations`

The feature is gated by `OPTIMIZATION_OPERATIONS_CENTER` and is available only to ADVANCED and ENTERPRISE projects. STANDARD projects are rejected before Operations read ports are called.

## Ownership map: P7 → P9-F

P9-F preserves the existing source-of-truth ownership chain rather than copying authority into a new table.

- **P7 Growth Intelligence** owns `GrowthOpportunityIdentity` and the persisted growth snapshot/evidence that makes an opportunity discoverable.
- **P9-A Optimization Planner** owns immutable `OptimizationCandidate` and `OptimizationPlan` records, including deterministic rank, AI adjustment, historical rank adjustment, recommended action, evidence coverage, and automation eligibility.
- **P9-B Workflow Orchestrator** owns `OptimizationRun` and `OptimizationRunItem`. The Operations Center reuses the existing P9-B manual Optimization Run command; P9-F does not define a second run executor.
- **P9-C Controlled Autopilot** owns `OptimizationAutopilotDecision`, project autopilot policy enforcement, `LOW` risk authority, `CREATE_CONTENT_PAGE` operation-class authority, reservation decisions, and the controlled handoff into P8.
- **P8 Publication** owns proposal, publication plan, preview, approval or automation authorization, execution, draft PR, and verification facts. P9-F may display those persisted facts but cannot Merge, Deploy, Rollback, force verification, or rewrite P8 authority.
- **P9-D Experiment Engine** owns immutable experiment and observation facts. Terminal outcome semantics come from the actual final scheduled observation and its `inputCutoffAt`.
- **P9-E Feedback Learning** owns immutable feedback evidence and profile snapshots. P9-F displays accepted/deferred evidence and the current historical effect summary; it never materializes feedback itself.
- **P9-F Operations Center** owns only the read projection, HTTP/SSR presentation, immutable `AutopilotPolicyRevision` audit records, and the narrowly bounded optimistic policy-revision command.

No copied pipeline-authority table is created by P9-F. Every displayed identifier should remain traceable to the owning persisted record above.

## Pipeline semantics: exactly one farthest stage

Each P7 growth identity is counted in exactly one **farthest** confirmed stage. The stages are ordered:

1. `DISCOVERED`
2. `ELIGIBLE`
3. `PLANNED`
4. `AUTOPILOT_DECIDED`
5. `P8_HANDOFF`
6. `DRAFT_PR`
7. `VERIFIED`
8. `OBSERVING`
9. `EVALUATED`

The projection follows persisted foreign-key/source-reference authority from the growth identity through the latest candidate and plan, P9-C decision, P8 proposal/plan/execution/verification, and P9-D experiment/terminal observation. A row is never duplicated across two stages merely because several earlier facts also exist.

`EVALUATED` requires an actual terminal P9-D observation matching the experiment's final observation schedule. A non-terminal observation cannot promote an item to `EVALUATED`.

## Inbox semantics

The Operations Inbox is derived from persisted P9-C decisions and P8 execution state. It does not create a second work queue. Categories are:

- `AWAITING_HUMAN_MERGE`
- `POLICY_BLOCKED`
- `P8_VALIDATION_BLOCKED`
- `VERIFICATION_FAILED`
- `STALE`
- `EXECUTION_FAILED`

Severity order is `HIGH` before `MEDIUM` before `LOW`. Within the same severity, older `updatedAt` authority is surfaced first, with a stable ID tiebreaker.

An inbox item points back to its owning authority record when a safe URL exists. A missing authority link must remain null rather than being invented.

## Outcome windows and `inputCutoffAt`

The 7-day and 30-day experiment summaries use the P9-D terminal observation's business cutoff, `inputCutoffAt`, not the row's `createdAt`. This matters because a terminal observation can be materialized after the measurement window has already closed.

The effect states are:

- `POSITIVE`
- `NEUTRAL`
- `NEGATIVE`
- `INCONCLUSIVE`

P9-F reads only persisted terminal observations. It does not call the P9-D experiment evaluator from a GET route.

The `operations/experiments` list uses a bounded persisted DateTime range. Its open upper bound is represented with a Prisma-safe value rather than the JavaScript maximum Date, so the read remains serializable by the database client.

## P9-E feedback semantics

Outcome effects and feedback acceptance are separate facts. A positive P9-D outcome does not itself prove that P9-E accepted feedback. Acceptance is evidenced only by the existence of persisted P9-E `OptimizationFeedbackEvidence`.

The overview therefore reports effect counts independently from `feedbackAccepted` and `feedbackDeferred`. The latest feedback profile exposes persisted sample counts, positive/neutral/negative counts, rolling effect balance, historical rank adjustment, and newest evidence cutoff.

The historical effect weight is advisory input to future P9-A ranking. It is not a P9-F editor and does not retroactively change an existing immutable plan.

## Quota and reservation semantics

The daily draft-PR quota is derived from the current project policy plus persisted P9-C reservation facts for the UTC date.

- `RESERVED` consumes capacity.
- `CONSUMED` consumes capacity.
- `RELEASED` does not consume capacity.

`remaining` is clamped at zero. P9-F does not create or release reservations from a GET request.

## Recent activity and `occurredAt`

Recent activity is sorted by semantic event time rather than whichever table happened to receive a row last. The `occurredAt` mapping is:

- P9-A plan: `createdAt`
- P9-B run: `completedAt ?? startedAt ?? createdAt`
- P9-C decision: `createdAt`
- P8 execution: `completedAt ?? startedAt ?? createdAt`
- P8 verification: `observedAt ?? createdAt`
- P9-D observation: `inputCutoffAt`
- P9-E feedback evidence: `inputCutoffAt`
- P9-F policy revision: `createdAt`

Activity projection is read-only and sorted descending by `occurredAt` with a stable authority-ID tiebreaker.

## Autopilot Policy Revision command

P9-F has one bounded mutation surface: immutable project policy revision. It changes only the existing allowed project policy fields. The client cannot submit actor identity, risk authority, or operation-class authority.

The command uses **optimistic concurrency** through `expectedUpdatedAt`. If the persisted policy has changed since the operator loaded it, the server returns `409` rather than silently overwriting the newer policy.

The command also provides request **idempotency** through a unique `requestId`/revision identity. A replay of the same accepted request returns the existing revision as an idempotent replay; a request collision with different content fails closed.

The policy update and immutable `AutopilotPolicyRevision` creation are atomic. If revision persistence fails, the policy update rolls back.

`AutopilotPolicyRevision` is append-only. Update and delete are rejected by the database immutability boundary.

## Actor rollout gate and fail-closed behavior

Policy mutation requires a server-resolved authenticated **actor**. The HTTP client is never trusted to provide `actorId`.

The default `createApp()` does not fabricate an operator identity. Without an injected server actor resolver, the policy-revision POST returns `503 OPERATIONS_ACTOR_UNAVAILABLE`. This is the deliberate rollout gate and is **fail-closed**.

Read APIs and the SSR Operations Center remain available to an eligible project when the actor resolver is absent. The page disables Policy Save and explains that the authenticated operator identity is unavailable.

Production rollout must inject the actor from the authenticated server session or equivalent trusted server context. Do not replace this gate with a hard-coded actor or a client-provided header/body field.

## Safety authority: locked `LOW` / `CREATE_CONTENT_PAGE`

P9-C safety authority remains locked. P9-F displays `LOW` and `CREATE_CONTENT_PAGE` as read-only authority facts and never provides an editor for them.

The Policy Revision body may change only the approved project policy controls such as enabled state, daily draft-PR limit, concurrency, evidence requirements, verification-failure pause, and project kill switch. It cannot broaden risk class or allowed operation classes.

The global controlled-autopilot kill switch is read-only in P9-F. There is no POST, PUT, PATCH, or DELETE route for a global kill switch and no client action that writes it.

## HTTP endpoints

All GET routes below are project scoped, feature gated, paginated where applicable, and persisted-read only:

- `GET /api/v1/projects/:projectId/optimization/operations`
- `GET /api/v1/projects/:projectId/optimization/operations/pipeline`
- `GET /api/v1/projects/:projectId/optimization/operations/inbox`
- `GET /api/v1/projects/:projectId/optimization/operations/experiments`
- `GET /api/v1/projects/:projectId/optimization/operations/feedback`
- `GET /api/v1/projects/:projectId/optimization/autopilot-policy`
- `GET /api/v1/projects/:projectId/optimization/autopilot-policy/revisions`

The bounded mutation endpoint is:

- `POST /api/v1/projects/:projectId/optimization/autopilot-policy/revisions`

The dashboard is:

- `GET /projects/:id/optimization`

Manual execution is intentionally not duplicated. The page calls the existing P9-B Optimization Run endpoint and sends a fresh `manualRequestId` generated by `crypto.randomUUID()`.

## Opening the Operations Center

1. Ensure the project plan level is ADVANCED or ENTERPRISE.
2. Start the application with the normal database and Redis configuration used by the rest of the system.
3. Open `/projects/<project-id>/optimization`.
4. Confirm the header states that the view is based only on persisted facts.
5. Review effective autopilot state, today's run count, quota, pipeline, Inbox, 7/30-day outcomes, feedback, activity, and policy.

A STANDARD project should receive the feature-not-available response rather than partial dashboard data.

## Applying a policy revision

1. Load the current policy from the dashboard or policy GET endpoint.
2. Ensure a trusted server actor resolver is installed. If it is not, Policy Save must remain disabled and POST must return `503`.
3. Change only the editable project policy fields.
4. Confirm the change in the UI.
5. Submit the generated request ID together with the exact `expectedUpdatedAt` that was loaded.
6. On success, read the returned policy/revision state.
7. On `409`, re-read the current policy and let the operator review the newer values before retrying. Never force overwrite.

## Running Optimization manually

The Operations Center does not own a new executor. Its manual Run button reuses P9-B:

1. Generate a fresh `manualRequestId` with `crypto.randomUUID()`.
2. POST through the existing P9-B manual Optimization Run route.
3. Display the accepted result/error.
4. Refresh persisted Operations reads after the command completes.

Never attach Merge, Deploy, Rollback, provider execution, experiment evaluation, or feedback materialization to the refresh loop.

## Client refresh behavior

The page-scoped client polls the overview at a bounded interval of 30 seconds only while `document.visibilityState === 'visible'`.

If the policy form is marked `data-dirty`, background refresh must not overwrite in-progress operator edits. Refresh is a read operation only.

A `409` policy conflict triggers a fresh policy read; it does not widen authority or force a write.

## Troubleshooting

### Dashboard returns 403

Check the project `planLevel`. `OPTIMIZATION_OPERATIONS_CENTER` is intentionally unavailable to STANDARD.

### Policy Save is disabled / POST returns 503

The trusted server actor resolver is not available. This is expected fail-closed rollout behavior. Verify authenticated server identity wiring; do not add `actorId` to the browser payload.

### Policy revision returns 409

The policy changed after the page loaded, or the request ID collided with different content. Re-read the current policy, compare values, and submit a new operator-approved revision using the new `expectedUpdatedAt` and request ID.

### Experiment list returns a server error

Check that DateTime filters passed to Prisma are inside its supported serialization range. The Operations service uses a stable persisted-read upper cutoff (`9999-12-31T23:59:59.999Z`) rather than JavaScript's maximum Date.

### Counts do not match row creation time

For outcomes and P9-E activity, inspect `inputCutoffAt`, not `createdAt`. For P8 and P9-B activity use the semantic `occurredAt` mapping above.

### Pipeline item appears only once

That is expected. Each growth identity belongs to its single farthest confirmed pipeline stage.

## Purge and retention

P9-F must respect the immutability guarantees of P8, P9-A, P9-C, P9-D, P9-E, and P9-F revision records. Normal application cleanup must not mutate or delete immutable authority rows merely to make the dashboard smaller.

Any production **retention** or purge policy must be designed around the owning module's documented retention boundary, referential integrity, audit requirements, and database immutability triggers. P9-F itself does not expose a purge endpoint. Operational database archival or legally required deletion must be handled by an explicitly reviewed maintenance procedure, not by the Operations GET routes or browser client.

## Verification commands

From the repository root, use the same commands as CI:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
```

For focused development, run the P9-F Vitest files first, including the repository/service, HTTP routes, SSR routes, policy-revision persistence/identity, and authority-boundary suites. Then run the full `vitest` suite through `npm test` before declaring the task complete.

Final verification must include the browser smoke/e2e job and production dependency audit in CI. A green focused test is not a substitute for the exact-head full CI result.

## Authority review checklist

Before releasing P9-F, verify all of the following against the exact PR head:

- Operations GET and SSR paths only read persisted authority.
- No Operations read path imports DeepSeek, AI gateway, search/visibility provider execution, queue producers, GitHub execution clients, P9-D evaluator, or P9-E materializer.
- Pipeline uses one farthest stage per P7 identity.
- Outcome windows use terminal `inputCutoffAt`.
- P9-E feedback acceptance remains independent from P9-D effect sign.
- Quota counts `RESERVED` and `CONSUMED` but not `RELEASED`.
- Activity uses semantic `occurredAt`.
- Policy revision has optimistic concurrency and idempotency.
- Actor identity is server-resolved and fail-closed.
- `LOW` and `CREATE_CONTENT_PAGE` remain locked P9-C authority.
- There is no global kill-switch write route.
- There are no Merge, Deploy, Rollback, force-verification, force-overwrite, risk-class, operation-class, or historical-weight mutation controls.
- The existing P9-B manual run command is reused rather than reimplemented.
- The PR remains Draft until separate authorization is given for readiness, merge, or deployment.
