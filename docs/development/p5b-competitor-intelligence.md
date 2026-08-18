# P5-B Competitor Intelligence Operator Guide

## Boundary

P5-B compares owned-site deterministic content facts with a separately persisted competitor fact domain. It does not import competitor pages into owned `Page`, `SeoIssue`, `GeoRuleResult` or entity tables.

P6 remains separate. P5-B must not claim AI Visibility, prompt rank, citation share, Share of Voice, search-engine rank or traffic unless a future explicitly sourced subsystem supplies those facts.

## Pipeline

1. Register a competitor domain.
2. Create a bounded `CompetitorCrawl`.
3. The `competitor` BullMQ worker reuses P1 `fetchPage` public-target policy and `parseHtml`.
4. Persist `CompetitorPageSnapshot` rows.
5. `COMPETITOR_COMPARISON_V1` compares the latest completed competitor crawl with owned `ContentDocument` facts.
6. Persist `CompetitorComparison` with `ownedMetrics`, `competitorMetrics`, versioned `gaps` and `sourceReferences`.
7. Optional `COMPETITOR_GAP_ANALYSIS` sends only the persisted comparison packet through the existing P4 AI Gateway.

## Crawl limits

- default: 25 pages per competitor crawl
- hard maximum: 100 pages
- same-domain traversal only
- production fetch uses P1 SSRF/public-target protection
- CI worker tests inject a fixture fetcher and perform no live internet calls
- BullMQ attempts: 1

## Deterministic comparison

Current metrics include:

- successful response share
- average word count
- title presence share
- H1 presence share
- average heading count
- average internal-link count
- structured-data presence share
- indexable share where known

Gap states are `AHEAD`, `BEHIND`, `EVEN`, or `UNKNOWN`. `UNKNOWN` must remain unknown; it is not converted to zero.

## AI boundary

Prompt: `competitor-gap-v1`.

DeepSeek may explain and prioritize persisted gaps. It may not invent:

- ranking positions
- estimated organic traffic
- keyword volume
- AI citations
- AI Visibility
- Share of Voice
- competitor facts not present in the comparison packet

AI task execution, model routing, token accounting and safe provider observability remain owned by P4.

## Feature gate

`COMPETITOR_INTELLIGENCE` is available to Standard, Advanced and Enterprise projects. It is intentionally distinct from the P6 `COMPETITOR_SOV` gate.

## Observability

Allowed events:

- `competitor.crawl.queued`
- `competitor.crawl.started`
- `competitor.crawl.completed`
- `competitor.crawl.failed`
- `competitor.comparison.created`

Allowed fields are bounded identifiers, aggregate page counts and stable error codes. Do not log competitor URLs, page bodies, prompts, AI output, credentials, cookies, Authorization headers or provider reasoning.

## Release checks

Before merge:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
npm run test:e2e
```

CI must not call live DeepSeek or live competitor sites.
