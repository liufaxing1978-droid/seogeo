# Operations Layer OL-1 — Today / Action Center Implementation Plan

## Goal
Add a deterministic Today / Action Center projection to the existing P9-F Operations Center without creating a parallel data model or fabricating SEO metrics.

## Constraints
- Work only on `feat/p12-operations-layer`.
- Reuse persisted Operations inbox facts and existing feature gates.
- No database migration for OL-1.
- Preserve existing API/UI behavior; add fields only.
- No automatic merge/deploy/rollback authority.
- RED → minimal GREEN → full verify → exact-head CI.

## Slice 1 — Pure projection
Files:
- `tests/unit/operations.today-actions.test.ts` (new)
- `src/modules/optimization-operations/operations.types.ts`
- `src/modules/optimization-operations/operations.derive.ts`

Behavior:
- Map persisted inbox categories to concrete action kinds and stable copy.
- Map HIGH/MEDIUM/LOW to P0/P1/P2.
- Preserve existing inbox ordering (severity → wait → stable id).
- Deduplicate by authority/category and cap the Today list at 7.
- Carry target URL, authority URL, reason code, and updatedAt for traceability.

## Slice 2 — Overview integration
Files:
- `src/modules/optimization-operations/operations.service.ts`

Behavior:
- Add `todayActions` to `OperationsOverview`.
- Derive actions from the same `inboxItems` already read in `getOverview`.
- Do not add extra provider/AI/Git calls.

## Slice 3 — UI contract
Files:
- `tests/unit/p12-operations-layer-today-ui.contract.test.ts` (new)
- `src/views/optimization-operations/index.ejs`

Behavior:
- Render a top-level “今日行动 / Today” section before the existing metrics/inbox.
- Show priority, action title, reason, target, timestamp, and existing authority link where available.
- Empty state must explicitly say there are no priority actions.
- Preserve the existing human merge/deploy boundary messaging.

## Verification
Targeted RED/GREEN:
- `npm test -- tests/unit/operations.today-actions.test.ts`
- `npm test -- tests/unit/p12-operations-layer-today-ui.contract.test.ts`

Full branch verification:
- `npm run test`
- `npm run typecheck`
- `npm run build`
- `npm run verify`

Completion evidence:
- exact feature-branch head SHA
- exact-head CI runs green
- no merge/deploy to `main`

## Next slices after OL-1
OL-2 Automation Scheduler → OL-3 Alert Center → OL-4 Post-Publish Verification → OL-5 Conversion & Action Impact Tracking → OL-6 integration/hardening.
