# P9-0A Market & Locale Foundation

## Purpose

P9-0A introduces explicit multi-market configuration for each project while preserving the legacy `Project.targetCountry` and `Project.defaultLanguage` fields unchanged. It establishes the market-resolution boundary that later P9 search-provider, AI-visibility, unified-evidence, and growth-adapter work must consume.

The foundation is additive. Existing projects continue to behave as before when they have no `ProjectMarket` rows.

## Supported market codes

P9-0A supports exactly these market codes:

- `CN`
- `GLOBAL`
- `HK`
- `TW`
- `SG`
- `MY`

Locale values are BCP-47 language tags. The service canonicalizes locale casing with `Intl.getCanonicalLocales`, for example `zh-cn` becomes `zh-CN` and `zh-hant` becomes `zh-Hant`.

A project may configure at most 20 explicit market rows. The database enforces uniqueness for `(projectId, marketCode, locale)`.

## Fallback contract

`MarketService.listResolvedMarkets(projectId)` is the authoritative market-resolution contract.

When explicit `ProjectMarket` rows exist, the service returns those rows only. It does not append a synthetic legacy market.

When zero explicit rows exist, the service resolves exactly one read-only fallback from the legacy project fields:

- `CN` -> `CN`
- `HK` -> `HK`
- `TW` -> `TW`
- `SG` -> `SG`
- `MY` -> `MY`
- any other legacy country, including `US`, -> `GLOBAL`

The fallback locale is the canonicalized `Project.defaultLanguage` value. A resolved fallback is marked with `source: "LEGACY_FALLBACK"`.

Reading markets never persists the fallback and never rewrites `targetCountry` or `defaultLanguage`. Clearing all explicit rows intentionally restores legacy fallback behavior.

## REST contract

Routes are mounted under `/api`:

```text
GET /api/projects/:projectId/markets
PUT /api/projects/:projectId/markets
```

Both return:

```json
{
  "data": []
}
```

### GET

`GET /api/projects/:projectId/markets` calls only `listResolvedMarkets(projectId)`. It is side-effect free and performs no configuration write.

### PUT

`PUT /api/projects/:projectId/markets` replaces the complete explicit market set.

Request shape:

```json
{
  "markets": [
    {
      "marketCode": "CN",
      "locale": "zh-CN",
      "enabled": true
    }
  ]
}
```

The route uses a strict Zod schema. Unknown market codes, unknown object properties, locale strings longer than 64 characters, and more than 20 rows fail with HTTP 400 before the service write method is called. If `enabled` is omitted it defaults to `true`.

Locale canonicalization and duplicate detection remain service responsibilities. The service normalizes locales before checking duplicate identities.

Replacement is atomic: the repository deletes the previous explicit rows and creates the new set inside one Prisma transaction. If creation fails, the previous rows remain intact. Sending an empty `markets` array deletes all explicit rows and causes subsequent resolution to use the legacy fallback.

`PROJECT_NOT_FOUND` maps to HTTP 404. Market validation failures map to HTTP 400.

## Downstream rule

Later P9 modules must resolve active markets through one of these supported boundaries:

- `MarketService.listResolvedMarkets(projectId)`
- `MarketApiPort.listResolvedMarkets(projectId)` where an application port is required

P9-0B and later provider/search/visibility code must not read `Project.targetCountry` or `Project.defaultLanguage` directly to decide active markets. Those fields remain compatibility inputs owned by the P9-0A fallback resolver.

This rule prevents provider implementations from inventing independent country/locale semantics and gives later multi-provider evidence one stable project-market identity.

## Non-goals

P9-0A does not introduce or change:

- search-provider network adapters or provider API calls;
- ranking collection or SERP facts;
- AI sampling, DeepSeek authority, or visibility-provider behavior;
- queues, schedulers, or background workers;
- P7 growth scoring, evidence authority, formulas, or lifecycle state;
- P8 publication, mutation, approval, deployment, verification, or rollback behavior;
- autonomous optimization or Controlled Autopilot behavior.

Those capabilities remain in their existing modules or later P9 phases.

## Rollback

Application rollback is safe: an earlier application version can stop consuming the P9-0A market module while the additive `ProjectMarket` table remains present. Legacy project fields were not removed or rewritten, so legacy behavior remains available.

A database rollback may drop only `ProjectMarket` and `MarketCode`, and only after confirming that no later P9 migration or deployed application version depends on them. Do not remove or rewrite `Project.targetCountry` or `Project.defaultLanguage` as part of a P9-0A rollback.

## Release verification

P9-0A is release-ready only when the exact branch head passes all existing repository gates:

1. Prisma validation and client generation;
2. migration deployment;
3. TypeScript typecheck;
4. full Vitest suite;
5. production build;
6. full Chromium Playwright E2E;
7. `npm audit --omit=dev --audit-level=high --legacy-peer-deps` against the deployable runtime dependency tree.

Focused market tests are useful during development but are not sufficient to declare P9-0A complete.
