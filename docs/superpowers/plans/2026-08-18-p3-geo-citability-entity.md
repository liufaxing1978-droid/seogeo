# P3 GEO Engine + Citability + Entity Implementation Plan

**Date:** 2026-08-18  
**Status:** execution baseline  
**Depends on:** P1 factual crawler + P2 deterministic SEO audit  
**Explicitly excludes:** DeepSeek/AI Gateway, live AI-platform sampling, Prompt Monitor, Citation Monitor, AI Visibility, Share of Voice

## Goal

P3 builds the deterministic GEO-readiness layer on top of real P1/P2 facts. It answers: “Is this site structurally ready to be understood, extracted, attributed and cited by AI/search systems?” It does **not** answer “Did ChatGPT/Gemini/DeepSeek actually mention this brand?” That belongs to P6 AI Visibility.

The main pipeline is:

```text
Project
  → completed CrawlRun / PageSnapshot / Schema / links / robots facts
  → GEO Audit Run
  → deterministic Citability / Entity / Brand / AI-Crawler readiness rules
  → GEO Rule Results
  → GEO Opportunities
  → GEO Readiness Score + components
  → GEO Overview / Citability / Entity / AI Crawler UI
```

## Critical scoring decision

P3 must never fabricate an AI Visibility component. Therefore P3 introduces **GEO Readiness Score v1** using only evidence available in P1/P2:

- Citability: 30%
- Entity Authority/Clarity: 25%
- Technical AI Readiness: 20%
- Brand Authority/Consistency: 15%
- Content GEO Quality: 10%

The product UI may label the headline metric “GEO Score”, but its stored score type/formula version must explicitly be `GEO_READINESS_V1`. AI Visibility remains a separate, unavailable metric until real P6 sampling exists. P6 must not silently rewrite historical P3 scores; if a later composite performance score is desired, create a separately versioned metric.

## Source-of-truth rules

1. P3 may read P1 Page/PageSnapshot/robots/sitemap/render facts and selected P2 deterministic facts.
2. P3 may write GEO-owned audit, rule-result, entity-observation and score records only.
3. UNKNOWN is a first-class outcome. Missing evidence must not become an invented FAIL or PASS unless the rule definition explicitly states that factual absence itself is the condition.
4. DeepSeek is not called in P3. Semantic inference that requires an LLM waits for P4.
5. No live ChatGPT/Gemini/Perplexity/DeepSeek/Doubao/Baidu AI sampling is allowed in P3.
6. No “citation” metric in P3 may mean actual AI citations. P3 Citability measures **citation readiness/extractability**, not observed external citations.

## Data model

### GEO audit core

`GeoAuditRun`
- id UUID
- projectId
- crawlRunId
- status QUEUED/RUNNING/COMPLETED/FAILED
- eligiblePages
- rulesEvaluated
- engineVersion
- startedAt / finishedAt / errorMessage
- createdAt / updatedAt

`GeoRule`
- id
- ruleCode unique
- name
- category
- description
- enabled

`GeoRuleVersion`
- id
- geoRuleId
- version
- dimension: CITABILITY / ENTITY / BRAND / AI_CRAWLER / CONTENT_GEO
- severity: HIGH/MEDIUM/LOW (readiness priority, not SEO severity)
- weight
- detectionType PAGE_FACT / CRAWL_FACT / PROJECT_AGGREGATE / ENTITY_FACT
- detectionConfig JSONB
- geoImpact
- fixGuide
- releaseAt / deprecatedAt
- unique(ruleId, version)

`GeoRuleResult`
- id
- geoAuditRunId
- pageId nullable
- entityId nullable
- ruleVersionId
- resultKey
- outcome PASS/FAIL/UNKNOWN
- evidence JSONB
- createdAt
- unique(auditRunId, ruleVersionId, resultKey)

### Citability

`CitabilityResult`
- id
- geoAuditRunId
- pageId
- answerFirstScore 0..100
- headingStructureScore
- factualDensityScore
- sourceSupportScore
- extractabilityScore
- definitionClarityScore
- overallScore
- evidence JSONB
- engineVersion
- createdAt
- unique(auditRunId,pageId)

These scores are deterministic proxies from available page structure/content facts; no LLM semantic quality score in P3.

### Entity

`Entity`
- id
- projectId
- entityType ORGANIZATION/PERSON/PRODUCT/SERVICE/PLACE/TOPIC/OTHER
- canonicalName
- normalizedName
- description nullable
- officialUrl nullable
- status ACTIVE/ARCHIVED
- confidence 0..1
- createdAt / updatedAt
- unique(projectId, entityType, normalizedName)

`EntityAlias`
- id
- entityId
- alias
- normalizedAlias
- sourceType
- unique(entityId,normalizedAlias)

`EntityRelation`
- id
- projectId
- sourceEntityId
- relationType
- targetEntityId
- sourcePageId nullable
- confidence
- evidence JSONB

`EntityObservation`
- id
- geoAuditRunId
- entityId
- pageId nullable
- sourceType SCHEMA/HTML_META/OPEN_GRAPH/TITLE/HEADING/INTERNAL_LINK/PROJECT_CONFIG
- property
- value
- evidence JSONB

`PageEntity`
- pageId
- entityId
- role PRIMARY/MENTIONED/AUTHOR/PUBLISHER/ABOUT
- confidence
- sourceType
- unique(pageId,entityId,role,sourceType)

P3 entity extraction is deterministic-first: JSON-LD/schema names/types/URLs/sameAs, OpenGraph site name/profile data, explicit publisher/author metadata and configured project identity. Free-text semantic NER waits for P4.

### AI crawler readiness

`AiCrawlerResult`
- id
- geoAuditRunId
- crawlerCode (GPTBOT/OAI_SEARCHBOT/GOOGLE_EXTENDED/CLAUDEBOT/PERPLEXITYBOT/BYTEDANCE/DATAFORSEO/etc when rules are factually known)
- robotsAllowed nullable
- metaRobotsAllowed nullable
- xRobotsAllowed nullable
- reachable nullable
- status PASS/FAIL/UNKNOWN
- evidence JSONB
- createdAt

Do not assume a crawler user-agent rule when not present. Unknown policy remains UNKNOWN.

### Brand authority/readiness

`BrandAuthorityResult`
- id
- geoAuditRunId
- officialIdentityPresent
- organizationSchemaPresent
- sameAsCount
- publisherConsistency
- contactIdentityConsistency
- aboutPagePresent
- overallScore
- evidence JSONB

This is on-site/owned identity readiness in P3. Third-party earned authority and real external mentions require later external data integrations.

### Score

Prefer the existing common score direction if practical, but P3 may initially use:

`GeoScore`
- id
- geoAuditRunId unique
- projectId
- scoreType = GEO_READINESS_V1
- score 0..100
- previousScore nullable
- change nullable
- formulaVersion
- calculatedAt
- engineVersion

`GeoScoreComponent`
- id
- geoScoreId
- componentCode
- componentName
- rawScore
- weight
- weightedScore
- sourceType
- sourceReference nullable

Historical score snapshots are append-only per audit.

## Deterministic P3 dimensions

### Citability rules

Initial rule set should include factual/structural signals such as:

- CITABILITY_NO_CLEAR_H1
- CITABILITY_HEADING_STRUCTURE_WEAK
- CITABILITY_NO_SUMMARY_BLOCK
- CITABILITY_LONG_UNBROKEN_SECTION
- CITABILITY_LOW_FACT_SIGNAL
- CITABILITY_NO_SOURCE_LINKS
- CITABILITY_NO_DEFINITION_PATTERN
- CITABILITY_TABLE_LIST_ABSENT_WHEN_STRUCTURED_CONTENT_EXISTS (only where deterministic evidence exists; otherwise UNKNOWN)
- CITABILITY_PAGE_TOO_THIN
- CITABILITY_CANONICAL_IDENTITY_WEAK

Avoid pretending to know “answer quality” semantically in P3.

### Entity rules

- ENTITY_ORGANIZATION_MISSING
- ENTITY_CANONICAL_NAME_INCONSISTENT
- ENTITY_OFFICIAL_URL_MISSING
- ENTITY_SAMEAS_MISSING
- ENTITY_PUBLISHER_MISSING
- ENTITY_AUTHOR_UNCLEAR
- ENTITY_SCHEMA_ID_MISSING
- ENTITY_DUPLICATE_IDENTITY
- ENTITY_RELATIONSHIP_SPARSE
- ENTITY_ABOUT_PAGE_MISSING

### Brand readiness rules

- BRAND_SITE_NAME_INCONSISTENT
- BRAND_ORGANIZATION_SCHEMA_MISSING
- BRAND_CONTACT_IDENTITY_MISSING
- BRAND_SOCIAL_IDENTITY_UNLINKED
- BRAND_ABOUT_PAGE_MISSING
- BRAND_PUBLISHER_IDENTITY_INCONSISTENT

### AI crawler readiness rules

Evaluate the site’s actual robots.txt, meta robots and X-Robots facts. Maintain a versioned crawler catalog instead of hard-coding claims in UI text. Initial UI can expose major user-agent rows only when policy semantics are implemented and tested.

### Content GEO structural rules

Use factual page structure only in P3:
- readable heading hierarchy
- answer/summary blocks where deterministically identifiable
- list/table structure
- source/reference links
- date/author/publisher presence
- FAQ/HowTo/Article/Organization schema availability
- stable canonical URL
- indexability/crawlability

## Task plan

### Task 1 — GEO persistence foundation

Files:
- modify `prisma/schema.prisma`
- add migration `prisma/migrations/..._add_geo_foundation/migration.sql`
- add `tests/integration/geo.persistence.test.ts`

TDD: test creation and append-only audit-linked data first. Implement GeoAuditRun, GeoRule/Version/Result, CitabilityResult, Entity/Alias/Relation/Observation/PageEntity, AiCrawlerResult, BrandAuthorityResult, GeoScore/Component. Verify cascade behavior does not accidentally delete P1/P2 historical facts.

### Task 2 — deterministic GEO rule catalog + synchronization

Files:
- `src/modules/geo/geo.types.ts`
- `src/modules/geo/rule-catalog.ts`
- `src/modules/geo/rule-sync.ts`
- tests for version identity/synchronization

Stable rule codes with versioned behavior. No DeepSeek fields/results.

### Task 3 — deterministic page citability analyzer

Files:
- `src/modules/geo/citability.ts`
- `src/modules/geo/geo-input.repository.ts`
- unit/integration tests

Build structural citation-readiness proxies from P1 facts and safely extracted page text/structure already available to the crawler. Where P1 lacks a factual signal, return UNKNOWN rather than inventing it. Persist per-page CitabilityResult.

### Task 4 — entity extraction from structured/owned signals

Files:
- `src/modules/geo/entity-extractor.ts`
- `src/modules/geo/entity.repository.ts`
- tests

Extract deterministic entities from Schema/JSON-LD and explicit publisher/author/OG/project metadata. Normalize aliases and relations. Free-text semantic NER is explicitly deferred to P4.

### Task 5 — AI crawler policy engine

Files:
- `src/modules/geo/ai-crawler-catalog.ts`
- `src/modules/geo/ai-crawler-evaluator.ts`
- tests

Evaluate stored robots/meta/X-Robots facts for each supported crawler identity. Unknown policy must stay UNKNOWN. Add catalog version metadata because crawler product/user-agent behavior can change over time.

### Task 6 — brand identity/readiness analyzer

Files:
- `src/modules/geo/brand-readiness.ts`
- tests

Evaluate on-site organization identity, publisher consistency, official URL, sameAs links, contact/about identity and schema consistency. Do not label owned signals as earned third-party authority.

### Task 7 — GEO audit engine + score v1

Files:
- `src/modules/geo/geo.repository.ts`
- `src/modules/geo/audit-engine.ts`
- `src/modules/geo/score-engine.ts`
- tests

Run all deterministic P3 dimensions and persist GEO_READINESS_V1 score with components:
Citability 30, Entity 25, Technical AI Readiness 20, Brand 15, Content GEO 10.
If a whole dimension has no eligible factual evidence, persist its confidence/availability and normalize only if the formula explicitly specifies it; never substitute AI Visibility.

### Task 8 — BullMQ + REST API

Files:
- GEO worker/queue integration
- `src/modules/geo/geo.routes.ts`
- service/API repository
- integration tests

Endpoints:
- POST `/projects/:projectId/geo-audits`
- GET `/projects/:projectId/geo/summary`
- GET `/projects/:projectId/geo/audits`
- GET `/geo/audits/:auditRunId`
- GET `/projects/:projectId/geo/citability`
- GET `/projects/:projectId/geo/entities`
- GET `/projects/:projectId/geo/ai-crawlers`
- GET `/projects/:projectId/geo/opportunities`

### Task 9 — GEO Overview UI

Files:
- web read repository
- `/projects/:id/geo`
- `src/views/geo/overview.ejs`
- tests

Show GEO Readiness Score, Citability, Entity, Brand Readiness, AI Crawler Readiness, content structural readiness, trend and prioritized deterministic opportunities. AI Visibility card remains explicitly “等待 P6 真实采样”, never a fake 0.

### Task 10 — Citability + Entity + AI Crawler detail UI

Routes/views:
- `/projects/:id/geo/citability`
- `/projects/:id/geo/entities`
- `/projects/:id/geo/ai-crawlers`

Drill down to pages/evidence/entity relations/crawler policies. Every recommendation links back to source facts.

### Task 11 — observability, navigation, docs, release gate

Structured events:
- geo.audit.started
- geo.citability.calculated
- geo.entities.observed
- geo.ai_crawler.evaluated
- geo.score.calculated
- geo.audit.completed
- geo.audit.failed

Logs contain IDs/aggregate counts only; no raw page bodies or sensitive query data.

Documentation:
- `docs/development/p3-geo-engine.md`
- README milestone update
- wire implemented GEO sidebar routes

Final verification:
- Prisma validate/generate/migrate
- TypeScript
- full Vitest/Supertest suite
- build
- production runtime audit
- Chromium Playwright E2E

## P3 acceptance criteria

1. A completed P1 crawl can produce one durable P3 GeoAuditRun without any LLM call.
2. GEO rules are versioned and deterministic.
3. Citability is clearly labeled readiness/extractability, not observed AI citation rate.
4. Entity records come only from explicit structured/owned signals in P3; semantic free-text extraction is deferred.
5. AI crawler policy is based on stored robots/meta/header facts and supports UNKNOWN.
6. GEO_READINESS_V1 has fully persisted components and never contains fabricated AI Visibility.
7. UI exposes source evidence and clearly marks unavailable P6 metrics as waiting for real sampling.
8. P3 cannot mutate P1/P2 historical facts or resolve SEO issues.
9. No DeepSeek/provider calls exist in P3 business logic.
10. Full CI including runtime audit and Chromium E2E is green before P3 is marked complete.

## Handoff to P4

P4 introduces `AI Gateway → Provider Interface → DeepSeek Provider`. P4 may consume P1/P2/P3 facts and entity observations to explain opportunities, perform semantic entity enrichment or generate content recommendations. It may not overwrite deterministic P3 facts or mark readiness issues fixed without a new deterministic audit.
