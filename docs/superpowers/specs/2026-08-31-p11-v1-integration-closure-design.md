# P11 V1 Integration Closure Design

## Goal

Produce one non-production integration candidate that contains the complete approved P11 stack (P11-01, P11-02A, P11-02B, P11-02C) plus every commit currently on `main`, then verify that exact candidate with the repository's full required CI gates.

This design does **not** authorize merging any P11 PR into `main` and does **not** authorize deployment.

## Pinned inputs

- Repository: `liufaxing1978-droid/seogeo`
- P11 closure input: `feat/p11-02c-current-serp-rank-tracking@9f785b6b36a8dd50131412a9b57ec0db15942429`
- Current main input: `main@2ff7a8551b46140714e7af918b36ac3fb87c08c8`
- Merge base: `2136087a5ae74b474b1b191b4ef957b4c7b61e96`
- Integration branch: `integration/p11-v1-closure`

At design freeze, the P11 closure input is 166 commits ahead of and 3 commits behind `main`.

The three main-only commits are:

1. `801dbd9427844793f98eaa5f61d1bf502dfbf31f` — accept fenced structured AI JSON;
2. `89bea6d0fcaaeb5c938ecf467640e0cbf5e7b294` — use real report references in AI summary prompts;
3. `2ff7a8551b46140714e7af918b36ac3fb87c08c8` — preserve sole-project navigation context from project list.

## Integration strategy

Use a dedicated integration branch rather than changing `main` or rewriting the existing Draft P11 stack.

The candidate must contain the content of the three main-only fixes and then record current `main` as a merge parent so the integration candidate is not behind `main` by ancestry.

Only files touched by the main-only fixes may be changed for reconciliation unless CI exposes a real integration defect. The known main-only file set is:

- `src/modules/ai/prompts/prompt-registry.ts`
- `src/modules/ai/structured-output.ts`
- `src/web/routes.ts`
- `tests/integration/projects.web.test.ts`
- `tests/unit/ai.report-prompt.test.ts`
- `tests/unit/ai.structured-output.test.ts`

`prompt-registry.ts` requires semantic reconciliation because P11 also changed that file for `KEYWORD_EXPANSION`. The reconciled file must preserve both:

- P11 `KEYWORD_EXPANSION` prompt registration and authority boundaries;
- main's real report source-reference behavior.

The other main-only files should use the latest main behavior unless a P11 change is proven to overlap.

## Required truth and authority preservation

The integration candidate must preserve all previously verified P11 boundaries:

- human/project-owned authoritative Keywords;
- AI suggestions remain advisory until explicit human acceptance;
- `UNKNOWN != NONE` for coverage/evidence;
- official provider average position remains distinct from live/current SERP rank;
- realtime SERP missing-within-depth remains `position = null`, never fabricated sentinel rank;
- provider/config/secret failures fail closed;
- same logical realtime observation remains idempotent in SearchFact;
- no crawler, AI, content, publication, distribution, merge, deployment, or rollback side effect is added to read-only ranking/discovery paths;
- no credentials are committed or rendered.

The three main fixes must also remain intact:

- fenced-but-valid structured AI JSON is accepted without weakening schema/source-reference validation;
- AI report prompts use real persisted report source references rather than fabricated placeholders;
- the project-list page preserves the sole accessible project as navigation context.

## Verification contract

The exact integration head must receive a fresh full CI run proving all currently required jobs green:

- `verify`
  - Prisma validate
  - Prisma generate
  - Prisma migrate deploy
  - Typecheck
  - Full Vitest
  - Build
- `e2e`
- `deployment-artifact`
- `production-audit`

Additionally, compare evidence must prove the final integration branch is `ahead` of current `main` and `behind_by = 0`.

Any failing gate is treated as a real integration blocker. Fix only the demonstrated root cause and rerun exact-head CI.

## Closure outputs

After the exact integration head is fully green:

1. add `docs/development/p11-02c-current-serp-rank-tracking-verification.md` if still absent;
2. add `docs/development/p11-v1-integration-verification.md` with pinned heads, compare evidence, CI evidence, scope review, and explicit no-merge/no-deploy state;
3. run CI again on the documentation head because documentation changes branch HEAD;
4. only then declare P11 V1 integration candidate ready for the separate main-merge authorization gate.

## Explicit exclusions

- no new P11-03 feature;
- no competitor rank tracking expansion;
- no scheduled rank polling or alerts;
- no new realtime lane persistence table;
- no production API credentials;
- no merge of #182/#186/#187/#188 into `main`;
- no production deployment.
