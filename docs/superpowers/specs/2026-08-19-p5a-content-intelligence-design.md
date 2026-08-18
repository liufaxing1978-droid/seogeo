# P5-A Content Intelligence Design

## Status

Proposed design for P5-A. Implementation must not begin until this written spec is reviewed and approved.

## Context

P0–P4 are complete. The platform already has:

- P1 deterministic crawl/page facts.
- P2 deterministic SEO audits, issue identities, severity, scores and comparisons.
- P3 deterministic GEO readiness, Citability readiness, Entity facts and AI crawler/brand readiness.
- P4 provider-neutral AI Gateway backed by DeepSeek, durable AI tasks/runs/provider-call metadata/results, bounded fact packets, structured JSON validation, project-scoped AI Analysis Center, observability and safe retry semantics.

P5-A adds a project-scoped Content Intelligence layer. Its role is to organize owned-site content facts, detect deterministic content opportunities, and request bounded AI recommendations from the existing P4 Gateway without turning AI output into authoritative SEO/GEO facts.

## Goals

1. Build a durable owned-content inventory derived from persisted page snapshots.
2. Produce deterministic content facts and explainable opportunity records.
3. Support content briefs and optimization recommendations through P4 DeepSeek analysis.
4. Keep every AI recommendation traceable to exact source references.
5. Provide project-scoped REST APIs and a Content Center UI.
6. Preserve P6 AI Visibility separation: no prompt-platform sampling, observed citation counts, platform ranking or SOV in P5-A.

## Non-goals

P5-A does not:

- Automatically publish, edit or rewrite the user's live website.
- Mutate P1 crawl facts, P2 SEO audit facts or P3 GEO facts.
- Mark P2 issues resolved or P3 readiness findings fixed.
- Invent keyword ranking, traffic, search volume, external citation, AI Visibility or SOV metrics.
- Crawl competitors; that belongs to P5-B.
- Generate final cross-module reports; that belongs to P5-C.
- Perform live DeepSeek calls in CI.

## Approaches Considered

### Approach A — AI-first content scoring

Send page text to DeepSeek and let the model score content quality, gaps and priorities.

Rejected because this makes subjective model output look authoritative, weakens reproducibility, increases token cost and violates the established P1–P4 deterministic-facts-first architecture.

### Approach B — Deterministic content facts + bounded AI recommendations

Extract durable content facts from P1/P2/P3, compute deterministic content opportunities with versioned rules, then provide bounded fact packets to P4 DeepSeek for briefs and recommendations.

Recommended. It preserves auditability, cost control, source-reference traceability and the existing deterministic/AI separation.

### Approach C — Store editable content drafts as the primary P5 object

Make drafts and generation workflows the center of the subsystem, with page facts attached secondarily.

Deferred. It is useful later, but P5-A should first establish trustworthy content inventory and opportunity data. Draft production can be added after the fact layer is stable.

## Architecture

P5-A is divided into three layers:

1. **Content Fact Layer** — deterministic inventory and signals derived from persisted owned-site data.
2. **Content Opportunity Layer** — deterministic, versioned rules over those facts.
3. **Content Intelligence Layer** — bounded DeepSeek briefs/recommendations using P4 AI tasks and source references.

Business modules must never call DeepSeek directly. AI calls continue through:

`Content Intelligence -> P4 AI Task/Gateway -> Provider Interface -> DeepSeek Provider`

## Data Model

### ContentDocument

Represents one owned-site page as a content-analysis unit.

Fields:

- `id`
- `projectId`
- `pageId`
- `canonicalUrl`
- `latestPageSnapshotId`
- `title`
- `metaDescription`
- `h1`
- `language`
- `wordCount`
- `paragraphCount`
- `headingCount`
- `listCount`
- `tableCount`
- `imageCount`
- `internalLinkCount`
- `externalLinkCount`
- `schemaTypes` JSON
- `entityIds` JSON array of deterministic P3 Entity IDs
- `contentHash`
- `extractedAt`
- timestamps

Constraints:

- Unique `(projectId, pageId)` for the current content-document identity.
- Content facts are refreshed from newer deterministic page snapshots; historical page snapshots remain immutable.

### ContentSignal

Versioned deterministic observations attached to a ContentDocument.

Fields:

- `id`
- `projectId`
- `contentDocumentId`
- `ruleKey`
- `ruleVersion`
- `status` (`PASS`, `FAIL`, `UNKNOWN`)
- `severity` (`INFO`, `LOW`, `MEDIUM`, `HIGH`)
- `numericValue` nullable
- `textValue` nullable/bounded
- `sourceReferences` JSON
- timestamps

Signal examples:

- `CONTENT_TITLE_PRESENT`
- `CONTENT_H1_PRESENT`
- `CONTENT_META_DESCRIPTION_PRESENT`
- `CONTENT_BODY_SUBSTANTIVE`
- `CONTENT_HEADING_STRUCTURE`
- `CONTENT_INTERNAL_LINK_SUPPORT`
- `CONTENT_STRUCTURED_DATA_SUPPORT`
- `CONTENT_ENTITY_SUPPORT`
- `CONTENT_CITABILITY_SUPPORT`

The exact thresholds are versioned constants and must be explainable in code/tests.

### ContentOpportunity

Stable deterministic opportunity identity derived from one or more signals.

Fields:

- `id`
- `projectId`
- `contentDocumentId`
- `opportunityKey`
- `opportunityVersion`
- `category`
- `priority`
- `status` (`OPEN`, `IN_PROGRESS`, `IGNORED`, `VERIFIED_FIXED`)
- `summary`
- `sourceReferences` JSON
- `firstDetectedAt`
- `lastDetectedAt`
- `verifiedFixedAt` nullable

Rules:

- AI cannot create `VERIFIED_FIXED`.
- `VERIFIED_FIXED` requires a later deterministic refresh proving the underlying failing signals no longer fail.
- Human workflow may set `IN_PROGRESS` or `IGNORED` only.

### ContentBrief

A durable AI-derived content brief linked to immutable fact input.

Fields:

- `id`
- `projectId`
- `contentDocumentId` nullable for net-new topic briefs
- `aiTaskId`
- `promptVersion`
- `factSnapshotHash`
- `briefJson`
- `sourceReferences` JSON
- timestamps

P5-A reuses P4 `AiTask`, `AiTaskRun`, `AiProviderCall` and `AiAnalysisResult`; `ContentBrief` stores the content-specific validated result/reference and does not create a second provider-call system.

## Deterministic Fact Sources

Allowed sources include:

- P1 Page/PageSnapshot technical and extracted HTML signals.
- P2 SEO Audit/Issue facts for the same owned page.
- P3 GEO/Citability/Entity facts for the same owned page/project.
- ContentDocument deterministic derived counts and classifications.

Disallowed AI inputs include:

- Cookies, auth headers, sessions, secrets.
- Full raw HTML when structured deterministic facts are sufficient.
- Unlimited page text.
- Invented traffic/ranking/search-volume/citation/visibility facts.
- Provider `reasoning_content`.

## Bounded Text Policy

Some content recommendations require actual page wording. P5-A may include bounded clean text excerpts only when necessary.

Rules:

- Remove scripts/styles/navigation boilerplate where possible using existing parsed page content.
- Never include credentials, headers, cookies or query-string secrets.
- Maximum total AI input remains governed by `AI_MAX_INPUT_CHARS`.
- Per-document clean-text excerpt has a deterministic cap.
- When over budget, preserve title/H1/headings/key paragraphs/source refs first and reduce lower-priority body excerpts deterministically.

## Deterministic Opportunity Rules V1

The first rule catalog is intentionally conservative.

### Thin or unavailable main content

- `UNKNOWN` when usable extracted body content is unavailable.
- `FAIL` only under an explicit versioned threshold.
- Does not claim the page cannot rank.

### Missing or weak document framing

Uses deterministic presence/length/duplication facts already available from P1/P2 where possible. It must not create a second conflicting SEO truth; P5-A references P2 issues when the same defect is already authoritative there.

### Heading/extractability support

Checks whether meaningful section structure exists for longer content. This is a content-structure opportunity, not a ranking claim.

### Internal support

Uses deterministic internal-link counts/relationships. It may identify pages with weak internal support relative to owned-site facts, but it cannot claim PageRank or ranking impact as a measured fact.

### Entity support

References P3 deterministic Entity/Observation data. Missing/weak entity support remains bounded to observed owned-site data.

### Citability support

References P3 Citability readiness facts. It must say citation readiness/extractability, never observed external AI citation.

## AI Tasks

Add P5-A task types without changing P6:

- `CONTENT_BRIEF`
- `CONTENT_OPTIMIZATION_ANALYSIS`

Prompt IDs:

- `content-brief-v1`
- `content-optimization-v1`

### Content Brief output schema

- `objective`
- `audience`
- `primaryTopic`
- `supportingTopics[]`
- `recommendedOutline[]`
- `entitiesToCover[]`
- `questionsToAnswer[]`
- `internalLinkSuggestions[]`
- `evidenceNotes[]`
- `sourceReferences[]`

### Content Optimization output schema

- `summary`
- `priorities[]`
- `sectionRecommendations[]`
- `entityRecommendations[]`
- `internalLinkRecommendations[]`
- `citabilityRecommendations[]`
- `doNotChange[]`
- `sourceReferences[]`

Every returned source reference must exist in the task's supplied source-reference set.

AI may recommend wording or structure, but the UI must label it as AI recommendation and never present it as a verified SEO/GEO fact.

## Idempotency

Logical AI request keys are stable and tied to deterministic inputs.

Examples:

- `content-brief:<contentDocumentId>:<contentHash>:content-brief-v1`
- `content-opt:<contentDocumentId>:<contentHash>:content-optimization-v1`

The same page content + same prompt version produces one logical task. Changed content hash or prompt version produces a new task.

## Feature Gating

P5-A uses the exact feature capability `CONTENT_INTELLIGENCE`.

Plan availability:

- STANDARD: content inventory, deterministic opportunities, bounded AI briefs/optimization.
- ADVANCED: same P5-A capability; P6 AI Visibility remains separately gated.
- ENTERPRISE: same P5-A capability plus future organization/report controls outside this spec.

Do not reuse `AI_VISIBILITY` as the P5 gate.

## REST API

Project-scoped endpoints:

- `GET /api/v1/projects/:projectId/content/documents`
- `GET /api/v1/projects/:projectId/content/documents/:documentId`
- `POST /api/v1/projects/:projectId/content/refresh`
- `GET /api/v1/projects/:projectId/content/opportunities`
- `PATCH /api/v1/projects/:projectId/content/opportunities/:opportunityId`
- `POST /api/v1/projects/:projectId/content/documents/:documentId/brief`
- `POST /api/v1/projects/:projectId/content/documents/:documentId/optimization`
- `GET /api/v1/projects/:projectId/content/briefs`

All reads/writes enforce project scoping.

Refresh behavior is idempotent and deterministic. It reads persisted data; it does not independently recrawl the web. A separate crawl remains a P1 action.

## Web UI

### Content Center

Route: `/projects/:id/content`

Sections:

- Summary cards: analyzed documents, open opportunities, high-priority opportunities, latest refresh.
- Document inventory table.
- Opportunity filters by category/priority/status.
- Clear separation between deterministic facts and AI recommendations.

### Content Document Detail

Route: `/projects/:id/content/documents/:documentId`

Sections:

- Deterministic content facts.
- Related P2 SEO issues.
- Related P3 GEO/Citability/Entity facts.
- Deterministic opportunities.
- Latest AI brief and optimization result.
- Actions: generate brief, analyze optimization.

### Content Brief Detail

Route: `/projects/:id/content/briefs/:briefId`

Shows validated structured brief, model/provider/prompt version metadata and clickable source references.

## Navigation

Use the existing project tab `内容` as the entry to P5-A Content Center.

Do not alter the `AI 可见性` navigation or wire P6 functionality.

## Queue and Execution

- Project-wide deterministic content refresh uses a dedicated BullMQ queue named `content` and a durable content-refresh job identity.
- The refresh worker reads only persisted P1/P2/P3 facts and writes P5-A derived ContentDocument/ContentSignal/ContentOpportunity state.
- AI brief/optimization uses the existing P4 `ai` queue and `attempts: 1` policy.
- Explicit manual retry semantics remain inherited from P4 for AI work.

## Observability

Add structured content lifecycle events:

- `content.refresh.queued`
- `content.refresh.started`
- `content.document.updated`
- `content.opportunity.updated`
- `content.refresh.completed`
- `content.refresh.failed`

Logs may include project/document/run IDs and aggregate counts. They must not include full page text, full AI prompt, secret headers or full model output.

P4 AI observability remains authoritative for provider calls.

## Security and Privacy

- Server-only DeepSeek API key continues unchanged.
- No live provider calls in CI.
- Clean-text excerpts sent to AI are bounded and derived from owned-site project data only.
- No auth/session/cookie/header material enters AI fact packets.
- Stored AI result contains only validated final structured output, not provider reasoning.

## Testing Strategy

### Unit

- Content fact extraction from deterministic fixtures.
- Rule catalog PASS/FAIL/UNKNOWN semantics.
- Stable opportunity identity.
- Fact packet bounding/reduction.
- Source-reference validation.
- Prompt/output Zod validation.

### Integration

- Prisma persistence and project isolation.
- Refresh idempotency.
- Opportunity state semantics.
- AI task idempotency by content hash/prompt version.
- API feature gating and project scoping.
- No deterministic record mutation by AI result creation.

### E2E

Chromium smoke flow:

1. Open project Content Center.
2. View deterministic document inventory/opportunity fixture.
3. Open document detail.
4. Trigger mocked content brief or view persisted deterministic fixture result.
5. Verify AI result is visibly labeled advisory and source links resolve.

CI must not call live DeepSeek.

## Migration and Compatibility

- New P5-A tables/enums are additive.
- Existing P1/P2/P3/P4 rows and semantics remain unchanged.
- Existing `AI_ANALYSIS` and `AI_VISIBILITY` behavior remains backward compatible.
- P5-A reuses P4 AI task infrastructure without changing existing P4 task semantics.

## Release Gate

Before P5-A is complete:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
npm run test:e2e
```

Also require:

- Production runtime dependency audit green.
- No live DeepSeek key/request in CI.
- Range check confirms only P5-A Content changes plus necessary shared integration.
- No competitor crawler/analysis implementation from P5-B.
- No cross-module reporting implementation from P5-C.
- No P6 prompt/citation/visibility/SOV sampling.

## Acceptance Criteria

P5-A is accepted only when:

1. Owned pages have durable, project-scoped ContentDocument records derived from deterministic persisted data.
2. Content signals/opportunities are versioned, explainable and independently testable.
3. UNKNOWN is preserved when source data is unavailable.
4. Existing P2/P3 facts remain authoritative and are referenced rather than duplicated as conflicting truth.
5. AI briefs/optimization consume bounded facts/excerpts and validate structured output before persistence.
6. AI returned source refs are restricted to supplied refs.
7. AI cannot mark content opportunities verified fixed.
8. Same content hash + prompt version is idempotent for paid AI work.
9. STANDARD/ADVANCED/ENTERPRISE can use P5-A through `CONTENT_INTELLIGENCE`, not P6 `AI_VISIBILITY`.
10. Content Center and document/brief views are project-scoped and tested.
11. No raw secrets/provider reasoning/full prompts/full page bodies are logged.
12. Full Prisma/TypeScript/tests/build/runtime-audit/Chromium E2E release gate is green.

## Handoff to P5-B

After P5-A is complete, P5-B Competitor Intelligence introduces a separate competitor-domain fact layer. It compares owned ContentDocument facts against deterministic competitor observations and then uses P4 AI only to explain gaps. P5-B must not treat third-party estimated traffic/rankings as measured facts unless an explicit external data source is integrated and provenance is stored.
