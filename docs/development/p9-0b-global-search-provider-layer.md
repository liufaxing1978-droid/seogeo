# P9-0B Global Search Provider Layer

## Purpose

P9-0B introduces a provider-neutral read-only search-provider boundary for global search data while preserving all existing Google Search Console (GSC) persistence and normalization behavior.

This phase adds two provider codes:

- `GOOGLE_SEARCH_CONSOLE`
- `BING_WEBMASTER`

It does **not** create unified multi-provider persisted facts. Cross-provider persistence and normalization remain deferred to P9-0F.

## Ownership boundaries

- **P9-0A Market Layer** remains the authority for project market/locale resolution.
- **Existing Search Console module** remains the authority for Google OAuth, bound properties, GSC daily snapshots, GSC query-page facts, and `GSC_QUERY_NORMALIZATION_V1`.
- **P9-0B Search Provider Layer** owns provider codes, capability manifests, read-only provider transports/adapters, and provider-specific observation contracts.
- **P7 Growth Intelligence** is unchanged.
- **P8 Publication / Mutation** is unchanged.
- P9-0B adds no queues, schedulers, site writes, autonomous optimization, or provider write actions.

Provider source must not independently interpret legacy `Project.targetCountry` or `Project.defaultLanguage`. Later callers consume P9-0A market decisions instead.

## Capability matrix

| Capability | Google Search Console | Bing Webmaster |
|---|---|---|
| List properties/sites | Supported, on demand, read-only | Supported, on demand, read-only |
| Query + Page daily | Supported, daily | **Not supported as an equivalent shape** |
| Query statistics | Not implemented in P9-0B | Supported, weekly |
| Page statistics | Not implemented in P9-0B | Supported, weekly |
| Site traffic daily | Not implemented in P9-0B | Supported, daily |
| Crawl stats | Not implemented | Not implemented |
| URL inspection | Not implemented | Not implemented |
| URL submission | Not supported in this phase | Not implemented / non-callable |
| Sitemap submission | Not implemented / non-callable | Not implemented / non-callable |

`SUPPORTED`, `NOT_SUPPORTED`, and `NOT_IMPLEMENTED` are explicit states. Missing semantics are never silently treated as zero or as an equivalent metric from another provider.

## Google Search Console semantics

`GoogleSearchProviderAdapter` reuses the existing GSC transport instead of creating a second Google integration.

The adapter requests:

- one source date at a time;
- dimensions exactly `query` + `page`;
- row limit default `25,000`, bounded to `1..25,000`;
- existing Search Console access-token handling supplied by the current Search Console service boundary.

Output kind:

- `QUERY_PAGE_DAILY`

Completeness:

- `TOP_ROWS_ONLY`

The completeness marker is important: Search Console Search Analytics does not guarantee that every possible row is returned. P9-0B therefore does not claim completeness.

The adapter validates returned query/page rows and rejects invalid URLs, credential-bearing URLs, malformed dates, invalid CTR, negative/non-finite metrics, fractional click/impression counts, and malformed key shapes.

P9-0B does **not** persist or re-normalize Google rows. Existing GSC persistence remains authoritative.

## Bing Webmaster semantics

### Authentication

P9-0B supports authentication injection only:

- `API_KEY`
- `OAUTH_BEARER`

Credentials are supplied by the caller. The provider layer does not own credential storage or OAuth token exchange.

Request behavior:

- API-key JSON calls use the documented `https://ssl.bing.com/webmaster/api.svc/json` host and an encoded `apikey` query parameter.
- OAuth Bearer JSON calls use `https://www.bing.com/webmaster/api.svc/json` with an `Authorization: Bearer ...` header.
- `siteUrl` is encoded through `URLSearchParams`.

Errors are bounded to provider code/status information and must not include API keys, Bearer tokens, or provider response bodies.

### Implemented read methods

P9-0B implements only:

- `GetUserSites`
- `GetQueryStats`
- `GetPageStats`
- `GetRankAndTrafficStats`

It intentionally does not expose provider write methods such as URL or sitemap submission.

### Observation shapes

Bing statistics are kept provider-specific:

- `QUERY_STATS`
- `PAGE_STATS`
- `SITE_TRAFFIC_DAILY`

Bing query and page statistics are treated as weekly-source observations. Site rank/traffic statistics are treated as daily-source observations.

P9-0B explicitly does **not**:

- join Bing query statistics and page statistics into fabricated query-page rows;
- calculate CTR when Bing did not return CTR;
- synthesize one Google-style `position` value from Bing `AvgClickPosition` and `AvgImpressionPosition`;
- coerce unavailable metrics to zero.

The two Bing average-position metrics remain separate nullable values.

All Bing observations use `PROVIDER_UNSPECIFIED` completeness because P9-0B does not have an authoritative guarantee that the returned collection is globally complete.

## Protocol policy

P9-0B uses JSON/HTTP provider interfaces only. Retired/retiring SOAP and POX protocol implementations are not present in production source.

This protects the system from coupling new architecture to legacy Bing transport protocols and keeps later provider upgrades isolated behind the transport interface.

## Security rules

- No credential persistence in `src/modules/search-providers`.
- No secrets in observation objects.
- No secrets or raw provider bodies in transport errors.
- Credential-bearing HTTP URLs are rejected.
- Read-only operations only.
- Unsupported/unimplemented capabilities fail closed through the capability registry.

## Relationship to P9-0A markets

Search-provider modules are deliberately market-agnostic. They do not read `Project.targetCountry` or `Project.defaultLanguage` and do not decide which provider a project should use.

P9-0A resolves market/locale intent. Higher layers may use that resolved market to select or prioritize providers, but provider adapters themselves only implement provider capabilities.

## Relationship to P9-0F unified facts

P9-0B returns provider-specific observations and deliberately stops before unified persistence.

P9-0F will be responsible for deciding how provider observations are persisted and normalized without erasing source semantics. In particular, P9-0F must preserve:

- provider identity;
- source cadence;
- source completeness;
- metric availability;
- separate Bing average-position metrics;
- Google `TOP_ROWS_ONLY` semantics;
- provenance back to original provider observations.

P9-0F must not retroactively reinterpret P9-0B observations as equivalent when the provider manifests say they are not.

## Rollback guidance

P9-0B has no Prisma migration and does not alter existing GSC persistence. Rollback is therefore code-only:

1. stop callers from constructing the new provider adapters;
2. remove/revert `src/modules/search-providers` changes;
3. remove P9-0B tests/documentation if reverting the phase completely;
4. leave existing Search Console connections, GSC snapshots, GSC facts, P7, and P8 data untouched.

No provider-side write rollback is required because P9-0B performs no provider writes.

## Release gate

P9-0B is complete only when the exact feature head passes:

1. Prisma validate/generate/migrate through `verify`;
2. TypeScript typecheck;
3. full Vitest suite;
4. build;
5. Chromium E2E;
6. production dependency audit.

Final compatibility assertions also verify that:

- GSC normalization stays `GSC_QUERY_NORMALIZATION_V1`;
- GSC Prisma delegates remain available;
- provider source does not read legacy market fields;
- Bing does not claim daily query-page equivalence;
- provider source contains no Bing write operations or SOAP/POX implementation.
