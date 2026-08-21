# P8-C Release Verification

Status: **pre-release gate pending**.

This record tracks the verified implementation evidence for P8-C Community GEO and Entity/Knowledge Graph Support before the README milestone is advanced and before the final integration PR targets `main`.

## Completed implementation tasks

### Task 24 — Entity/knowledge-graph suggestion contract

- Merged into P8-C integration at `ec97720d0dc2924356b1494d6750cccaf95e4e90`.
- Exact-head CI passed before merge.
- Entity suggestions remain source-backed `ENTITY_SUGGESTION` artifacts and do not authorize provider submission.

### Task 25 — Human-operated service gates and observability

- Exact GREEN head: `c1b14976d00dda05a0a6a3865382ce495c99ad3f`.
- CI #1492 / run `32509901601`: `verify`, Chromium `e2e`, and `production-audit` all passed.
- Merged into P8-C integration at `c317d2b54cef5ffdcd5f69a288e6accc585b67c1`.
- Community targets use human-operated `MANUAL_HANDOFF`; Entity targets require Enterprise governance and remain `PREPARE_ONLY`.
- Entity publish/manual-result/verify fail closed before provider work.
- Prepared observability events are emitted only after artifact materialization commits and use bounded safe metadata.

### Task 26 — Persisted-read Community/Entity review workspace

- Exact GREEN head: `5b2f68c596a1155d30cba8faaf37cbefc1011bcf`.
- CI #1498 / run `32515144147`: `verify`, Chromium `e2e`, and `production-audit` all passed.
- `verify` included Prisma validate/generate/migrate, Typecheck, 219 test files / 845 tests, and Build.
- Merged into P8-C integration at `d3d409b50c63992e693fccaba3850c2e4f066112`.
- GET review surfaces decode only bounded persisted Community/Entity fields; raw provider metadata is not rendered.
- Entity review pages expose no automatic publish or manual-result controls.

## Frozen P8-C safety invariants

- A normal P8-C preparation requires an already `VERIFIED` primary publication and the exact bound source content version.
- Community output is source-backed and community-native; brand/source links are optional rather than mandatory.
- Community final publishing is human-operated `MANUAL_HANDOFF`; no unofficial browser automation or provider auto-post path is introduced.
- Entity targets (`WIKIDATA`, `WIKIPEDIA`, `BAIDU_BAIKE`) are Enterprise `ENTITY_SUGGESTION` / `PREPARE_ONLY`; no auto-submit path exists.
- Normalized community target context participates in deterministic request identity through a context hash, so changed question/topic context cannot reuse stale AI work.
- DeepSeek remains advisory and cannot approve, publish, verify, fabricate platform activity, or mutate deterministic P7/P8 facts.
- Observability excludes bodies, full prompts/responses, tokens, credentials, authorization headers, source URLs, and raw provider payloads.
- CI uses no real community or knowledge-platform publishing credentials or writes.

## Task 27 release gate

The README milestone remains `P0 - P8-B complete` until this branch independently passes the pre-release CI gate.

Required CI coverage:

1. Prisma validate / generate / migrate deploy.
2. Typecheck.
3. Full Vitest regression, including P8-C unit/integration contracts.
4. Build.
5. Full Chromium E2E, including `distribution-p8c.spec.ts` and existing `distribution.spec.ts`.
6. Deployable-runtime production audit with `npm audit --omit=dev --audit-level=high --legacy-peer-deps`.

After the pre-release exact head is green, README may advance to `P0 - P8-C complete`; that README-marked head must then independently pass the same three GitHub CI jobs before final integration to `main`.