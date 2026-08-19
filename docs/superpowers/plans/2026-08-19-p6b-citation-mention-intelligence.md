# P6-B Citation & Mention Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic, replayable Citation & Mention Intelligence layer over persisted P6-A PlatformObservation records, with explicit subject registry, citation-evidence semantics, zero-network extraction, project-scoped APIs/UI, and no P6-C metrics.

**Architecture:** P6-B introduces an explicit monitored-subject registry, deterministic mention/citation extractors, versioned immutable extraction snapshots, and a dedicated `visibility-extraction` queue. It never calls providers or LLMs. Provider-native citation evidence state is made explicit on PlatformObservation so `UNKNOWN` is never collapsed into zero.

**Tech Stack:** Node.js 22, TypeScript, Express 5, EJS, PostgreSQL/Prisma, Redis/BullMQ, Zod, Vitest/Supertest/Playwright.

**Spec:** `docs/superpowers/specs/2026-08-19-p6b-citation-mention-intelligence-design.md`

## Global Constraints

- Authoritative mention/citation facts come only from persisted P6-A observations.
- No DeepSeek/LLM/embedding/fuzzy semantic inference in authoritative extraction.
- No live provider calls during extraction, retry, refresh, backfill, API reads, web reads, or CI.
- Generated prose URLs are not provider citations unless native citation/search metadata supports them.
- `UNKNOWN`, `NOT_ELIGIBLE`, provider failure, refusal, unsupported grounding, and budget skip are not zeros.
- `KNOWN_EMPTY` requires positive evidence that extraction was eligible and completed with zero matches/sources.
- Old extractions are immutable; subject configuration changes create a new `subjectSetHash` and new extraction.
- Extraction stores `subjectSnapshotJson` in addition to `subjectSetHash` for historical reconstruction.
- P6-B must not implement Mention Rate, Citation Rate, VisibilitySnapshot, Share of Voice, trend metrics, or weighted visibility.
- Standard plan must remain blocked from P6-B write/refresh operations.
- Existing P1-P6-A behavior must remain unchanged.

---

## File Structure

### Persistence
- `prisma/models/visibility-intelligence.prisma` — subject registry, extraction, mention/citation models and enums.
- `prisma/migrations/<timestamp>_add_visibility_intelligence/migration.sql` — DDL, FKs, indexes, citation evidence field on PlatformObservation.

### Domain
- `src/modules/visibility/visibility-subject.types.ts` — subject/alias/extraction input types.
- `src/modules/visibility/visibility-subject.repository.ts` — project-scoped subject persistence.
- `src/modules/visibility/visibility-subject.service.ts` — bootstrap, validation, linking, alias ambiguity checks.
- `src/modules/visibility/visibility-normalization.ts` — deterministic name/domain/text normalization.
- `src/modules/visibility/visibility-mention.extractor.ts` — exact/alias/domain matching.
- `src/modules/visibility/visibility-citation.extractor.ts` — native citation normalization/classification.
- `src/modules/visibility/visibility-extraction.repository.ts` — immutable extraction materialization.
- `src/modules/visibility/visibility-extraction.service.ts` — snapshot/hash/status derivation and orchestration.
- `src/modules/visibility/visibility-extraction.worker.ts` — zero-network queue processor.
- `src/modules/visibility/visibility-extraction.queue.ts` — queue/job IDs/dedup.
- `src/modules/visibility/visibility-intelligence.routes.ts` — REST endpoints.
- `src/modules/visibility/visibility-intelligence.web.routes.ts` — Citation Monitor / subject web routes.
- `src/modules/visibility/visibility-intelligence.web.repository.ts` — bounded view queries.
- `src/modules/visibility/visibility-intelligence.observability.ts` — safe extraction events.

### P6-A compatibility
- provider adapters under `src/modules/visibility/providers/*` — set explicit `citationEvidenceState` from native response contracts.
- `src/modules/visibility/visibility.worker.ts` — persist normalized evidence state without new provider calls.

### Views
- `src/views/visibility/citations.ejs`
- `src/views/visibility/subjects.ejs`
- `src/views/visibility/extractions/show.ejs`
- `src/views/partials/sidebar.ejs`

---

## Task 1: P6-B Persistence Foundation + Citation Evidence State

**Files:**
- Create: `tests/integration/visibility-intelligence.persistence.test.ts`
- Create: `prisma/models/visibility-intelligence.prisma`
- Create: `prisma/migrations/<timestamp>_add_visibility_intelligence/migration.sql`
- Modify: `prisma/models/visibility.prisma`

**Interfaces:**
- Produces models: `VisibilitySubject`, `VisibilitySubjectAlias`, `VisibilityExtraction`, `MentionObservation`, `CitationObservation`.
- Adds `PlatformObservation.citationEvidenceState`.

- [ ] **Step 1: Write the failing persistence contract**

Create tests proving:

```ts
const subject = await prisma.visibilitySubject.create({
  data: {
    projectId: project.id,
    subjectType: 'OWNED_DOMAIN',
    canonicalValue: 'xingshantang.org',
    normalizedValue: 'xingshantang.org',
    sourceType: 'PRIMARY_DOMAIN'
  }
});

const alias = await prisma.visibilitySubjectAlias.create({
  data: {
    projectId: project.id,
    subjectId: subject.id,
    alias: 'www.xingshantang.org',
    normalizedAlias: 'xingshantang.org',
    aliasType: 'DOMAIN',
    sourceType: 'PRIMARY_DOMAIN'
  }
});

const extraction = await prisma.visibilityExtraction.create({
  data: {
    projectId: project.id,
    platformObservationId: observation.id,
    extractorVersion: 'VISIBILITY_EXTRACTION_V1',
    subjectSetHash: 'hash-1',
    subjectSnapshotJson: [{ id: subject.id, normalizedValue: subject.normalizedValue }],
    status: 'COMPLETED',
    mentionStatus: 'KNOWN_EMPTY',
    citationStatus: 'KNOWN_EMPTY',
    mentionCount: 0,
    citationCount: 0
  }
});
```

Assert uniqueness for `(projectId, subjectType, normalizedValue)`, `(subjectId, normalizedAlias)`, and `(platformObservationId, extractorVersion, subjectSetHash)`. Prove project cascade cleanup does not delete unrelated project data.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/integration/visibility-intelligence.persistence.test.ts
```

Expected: missing Prisma models/enums/field.

- [ ] **Step 3: Implement minimal schema**

Required enums:

```prisma
enum VisibilitySubjectType { OWNED_BRAND OWNED_DOMAIN OWNED_ENTITY COMPETITOR }
enum VisibilitySubjectStatus { ACTIVE ARCHIVED }
enum VisibilitySubjectSource { PROJECT_CONFIG PRIMARY_DOMAIN P3_ENTITY P5_COMPETITOR }
enum VisibilityAliasType { NAME DOMAIN ENTITY_ALIAS }
enum VisibilityAliasSource { PROJECT_CONFIG P3_ENTITY_ALIAS PRIMARY_DOMAIN P5_COMPETITOR }
enum VisibilityExtractionStatus { QUEUED RUNNING COMPLETED FAILED }
enum VisibilityEvidenceStatus { EXTRACTED KNOWN_EMPTY UNKNOWN NOT_ELIGIBLE }
enum VisibilityMentionType { EXACT NORMALIZED_ALIAS DOMAIN }
enum CitationEvidenceState { KNOWN_PRESENT KNOWN_EMPTY UNKNOWN NOT_APPLICABLE }
```

Add `citationEvidenceState CitationEvidenceState @default(UNKNOWN)` to `PlatformObservation`.

- [ ] **Step 4: Add migration**

Existing PlatformObservation rows receive `UNKNOWN`; no backfill may guess `KNOWN_EMPTY` from `citationsJson=[]`.

- [ ] **Step 5: Verify GREEN**

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm test -- tests/integration/visibility-intelligence.persistence.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add prisma tests/integration/visibility-intelligence.persistence.test.ts
git commit -m "feat: add P6-B visibility intelligence persistence"
```

---

## Task 2: Citation Evidence State in P6-A Provider Normalization

**Files:**
- Create: `tests/unit/visibility.citation-evidence.test.ts`
- Modify: `src/modules/visibility/visibility.types.ts`
- Modify: `src/modules/visibility/providers/openai.provider.ts`
- Modify: `src/modules/visibility/providers/gemini.provider.ts`
- Modify: `src/modules/visibility/providers/perplexity.provider.ts`
- Modify: `src/modules/visibility/providers/anthropic.provider.ts`
- Modify: `src/modules/visibility/providers/deepseek.provider.ts`
- Modify: `src/modules/visibility/visibility.worker.ts`

**Interfaces:**
- `VisibilitySampleResponse.citationEvidenceState` is required.

- [ ] **Step 1: Write RED provider-contract tests**

Prove each adapter returns one of:

```ts
'KNOWN_PRESENT' | 'KNOWN_EMPTY' | 'UNKNOWN' | 'NOT_APPLICABLE'
```

Use fixtures where native response has citations, explicitly no citations, malformed/ambiguous citation metadata, and unsupported grounding.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/unit/visibility.citation-evidence.test.ts
```

- [ ] **Step 3: Implement minimal normalization**

Rules:
- native citation/source blocks present => `KNOWN_PRESENT`;
- native contract positively returns empty source collection => `KNOWN_EMPTY`;
- insufficient/malformed evidence => `UNKNOWN`;
- DeepSeek unsupported web grounding => `NOT_APPLICABLE`.

- [ ] **Step 4: Persist evidence state in worker**

Worker copies the normalized enum onto PlatformObservation in the same persistence update as citations/search metadata.

- [ ] **Step 5: Verify GREEN + P6-A regression**

```bash
npm test -- tests/unit/visibility.citation-evidence.test.ts tests/unit/visibility.*provider.test.ts tests/integration/visibility.worker.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/visibility tests
 git commit -m "feat: persist provider citation evidence state"
```

---

## Task 3: Subject Registry, Bootstrap, Linking, and Alias Ambiguity

**Files:**
- Create: `tests/integration/visibility.subjects.test.ts`
- Create: `src/modules/visibility/visibility-subject.types.ts`
- Create: `src/modules/visibility/visibility-subject.repository.ts`
- Create: `src/modules/visibility/visibility-subject.service.ts`

**Interfaces:**
- `bootstrapOwnedDomain(projectId)`
- `createSubject(projectId, input)`
- `addAlias(projectId, subjectId, input)`
- `archiveSubject(projectId, subjectId)`
- `buildActiveSubjectSnapshot(projectId)`

- [ ] **Step 1: Write RED tests**

Prove first bootstrap creates only normalized `OWNED_DOMAIN` from `Project.primaryDomain`; no P3 entities/P5 competitors are automatically added.

Prove selected P3 Entity/P5 Competitor must belong to same project.

Prove alias conflict:

```ts
await expect(service.addAlias(project.id, subjectB.id, { alias: 'XST', aliasType: 'NAME' }))
  .rejects.toMatchObject({ code: 'AMBIGUOUS_VISIBILITY_ALIAS' });
```

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/integration/visibility.subjects.test.ts
```

- [ ] **Step 3: Implement deterministic normalization/validation hooks**

Use canonical normalized values from Task 4 utilities; cross-project source links return not-found without disclosing foreign resource details.

- [ ] **Step 4: Build immutable subject snapshot**

Return canonically sorted JSON containing subject IDs/types/normalized values/active aliases/entityId/competitorId/sourceType.

- [ ] **Step 5: Verify GREEN**

```bash
npm test -- tests/integration/visibility.subjects.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/visibility tests/integration/visibility.subjects.test.ts
git commit -m "feat: add P6-B visibility subject registry"
```

---

## Task 4: Deterministic Text and Domain Normalization

**Files:**
- Create: `tests/unit/visibility.normalization.test.ts`
- Create: `src/modules/visibility/visibility-normalization.ts`

**Interfaces:**
- `normalizeVisibilityText(text)`
- `normalizeVisibilityName(value)`
- `normalizeVisibilityDomain(value)`
- `isCjkText(value)`
- `findDeterministicOccurrences(text, needle, mode)`

- [ ] **Step 1: Write RED tests**

Cover NFKC, Unicode whitespace, punctuation normalization, Latin case-folding/boundaries, CJK substring matching, host lowercasing, `www.` alias normalization, default ports, and rejection of URL paths as domain subject values.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/unit/visibility.normalization.test.ts
```

- [ ] **Step 3: Implement minimal deterministic functions**

No fuzzy matching/stemming/embeddings.

- [ ] **Step 4: Verify GREEN**

```bash
npm test -- tests/unit/visibility.normalization.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/visibility/visibility-normalization.ts tests/unit/visibility.normalization.test.ts
git commit -m "feat: add deterministic visibility normalization"
```

---

## Task 5: Mention Extractor

**Files:**
- Create: `tests/unit/visibility.mention-extractor.test.ts`
- Create: `src/modules/visibility/visibility-mention.extractor.ts`

**Interfaces:**

```ts
extractMentions(answerText, subjectSnapshot): {
  status: 'EXTRACTED' | 'KNOWN_EMPTY' | 'UNKNOWN' | 'NOT_ELIGIBLE';
  mentions: DerivedMention[];
}
```

- [ ] **Step 1: Write RED cases**

Cover exact canonical match, configured alias, domain prose mention, Chinese names without spaces, Latin boundary safety, duplicate occurrences, first position, ambiguous alias exclusion, eligible no-match => `KNOWN_EMPTY`, missing/corrupt answer => `UNKNOWN`, failed/refused/unsupported observation => `NOT_ELIGIBLE` in orchestration.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/unit/visibility.mention-extractor.test.ts
```

- [ ] **Step 3: Implement extractor**

Group occurrences deterministically by subject + matched value + mention type.

- [ ] **Step 4: Verify GREEN**

```bash
npm test -- tests/unit/visibility.mention-extractor.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/visibility/visibility-mention.extractor.ts tests/unit/visibility.mention-extractor.test.ts
git commit -m "feat: add deterministic visibility mention extractor"
```

---

## Task 6: Citation Extractor

**Files:**
- Create: `tests/unit/visibility.citation-extractor.test.ts`
- Create: `src/modules/visibility/visibility-citation.extractor.ts`

**Interfaces:**

```ts
extractCitations(observation, subjectSnapshot): {
  status: 'EXTRACTED' | 'KNOWN_EMPTY' | 'UNKNOWN' | 'NOT_ELIGIBLE';
  citations: DerivedCitation[];
}
```

- [ ] **Step 1: Write RED cases**

Prove:
- `KNOWN_PRESENT` + native sources => normalized CitationObservation facts;
- `KNOWN_EMPTY` => `KNOWN_EMPTY` and zero rows;
- `UNKNOWN` => `UNKNOWN` even when `citationsJson=[]`;
- `NOT_APPLICABLE` / unsupported => `NOT_ELIGIBLE`;
- prose URLs never create citations;
- owned/competitor mapping uses unique normalized domain identity only;
- duplicate normalized URL/source order folds occurrence count deterministically.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/unit/visibility.citation-extractor.test.ts
```

- [ ] **Step 3: Implement citation normalization**

Do not fetch URLs. Preserve original URL; derive normalized URL/domain and stable citation key.

- [ ] **Step 4: Verify GREEN**

```bash
npm test -- tests/unit/visibility.citation-extractor.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/visibility/visibility-citation.extractor.ts tests/unit/visibility.citation-extractor.test.ts
git commit -m "feat: add deterministic visibility citation extractor"
```

---

## Task 7: Immutable Extraction Materialization + Replay

**Files:**
- Create: `tests/integration/visibility.extraction-service.test.ts`
- Create: `src/modules/visibility/visibility-extraction.repository.ts`
- Create: `src/modules/visibility/visibility-extraction.service.ts`

**Interfaces:**
- `extractObservation(projectId, observationId)`
- `computeSubjectSetHash(snapshot)`

- [ ] **Step 1: Write RED integration tests**

Prove one extraction transaction creates `VisibilityExtraction` + mention/citation rows atomically; duplicate same `(observation, extractorVersion, subjectSetHash)` returns existing result; alias/subject change creates new hash/new extraction while old extraction remains unchanged.

Force a materialization exception and assert no partial Mention/Citation rows remain.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/integration/visibility.extraction-service.test.ts
```

- [ ] **Step 3: Implement snapshot/hash + eligibility orchestration**

Hash canonical JSON via SHA-256. Persist `subjectSnapshotJson` exactly as used by extraction.

- [ ] **Step 4: Implement atomic transaction**

Extraction lifecycle: `QUEUED/RUNNING -> COMPLETED` or `FAILED`; derived rows are written in the completion transaction.

- [ ] **Step 5: Verify GREEN**

```bash
npm test -- tests/integration/visibility.extraction-service.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/visibility tests/integration/visibility.extraction-service.test.ts
git commit -m "feat: materialize replayable P6-B extractions"
```

---

## Task 8: Zero-Network Extraction Queue, Worker, and Backfill

**Files:**
- Create: `tests/integration/visibility.extraction-worker.test.ts`
- Create: `src/modules/visibility/visibility-extraction.queue.ts`
- Create: `src/modules/visibility/visibility-extraction.worker.ts`
- Modify: `src/queue/queues.ts`
- Modify: `src/queue/worker-bootstrap.ts`

**Interfaces:**
- queue: `visibility-extraction`
- jobs: `extract-observation`, `backfill-project`
- stable observation job ID: `visibility-extract:<observationId>:<extractorVersion>:<subjectSetHash>`

- [ ] **Step 1: Write RED worker tests**

Inject a provider adapter spy that throws if touched; prove extraction worker never imports/calls provider registry or network transport.

Test dedup, backfill expansion, bounded pagination, failed deterministic retry, and project-scoped checks.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/integration/visibility.extraction-worker.test.ts
```

- [ ] **Step 3: Implement queue + worker**

Backfill only enqueues observation-level jobs and never processes unbounded project work inline.

- [ ] **Step 4: Activate worker bootstrap**

Use bounded concurrency and no live external dependency.

- [ ] **Step 5: Verify GREEN**

```bash
npm test -- tests/integration/visibility.extraction-worker.test.ts tests/unit/worker-bootstrap.test.ts
npm run typecheck
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/visibility src/queue tests
git commit -m "feat: add zero-network visibility extraction worker"
```

---

## Task 9: Project-Scoped REST API

**Files:**
- Create: `tests/integration/visibility-intelligence.api.test.ts`
- Create: `src/modules/visibility/visibility-intelligence.routes.ts`
- Modify: `src/app.ts`

**Interfaces:**
- `GET/POST /api/v1/projects/:projectId/visibility/subjects`
- `POST /api/v1/projects/:projectId/visibility/subjects/:subjectId/aliases`
- `POST /api/v1/projects/:projectId/visibility/subjects/bootstrap`
- `POST /api/v1/projects/:projectId/visibility/extractions/refresh`
- `POST /api/v1/projects/:projectId/visibility/extractions/backfill`
- `GET /api/v1/projects/:projectId/visibility/extractions`
- `GET /api/v1/projects/:projectId/visibility/mentions`
- `GET /api/v1/projects/:projectId/visibility/citations`

- [ ] **Step 1: Write RED API tests**

Prove Advanced/Enterprise access, Standard 403 before persistence/enqueue, cross-project subject/entity/competitor IDs return 404, refresh/backfill enqueue extraction only, pagination/filtering is bounded.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/integration/visibility-intelligence.api.test.ts
```

- [ ] **Step 3: Implement strict Zod routes**

Use `AI_VISIBILITY` for subject config and `CITATION_MONITOR` for extraction/read surfaces.

- [ ] **Step 4: Verify GREEN**

```bash
npm test -- tests/integration/visibility-intelligence.api.test.ts
npm run typecheck
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/visibility/visibility-intelligence.routes.ts src/app.ts tests/integration/visibility-intelligence.api.test.ts
git commit -m "feat: add P6-B visibility intelligence API"
```

---

## Task 10: Citation Monitor and Subject Configuration Web UI

**Files:**
- Create: `tests/integration/visibility-intelligence.web.test.ts`
- Create: `tests/e2e/citation-monitor.spec.ts`
- Create: `src/modules/visibility/visibility-intelligence.web.repository.ts`
- Create: `src/modules/visibility/visibility-intelligence.web.routes.ts`
- Create: `src/views/visibility/citations.ejs`
- Create: `src/views/visibility/subjects.ejs`
- Create: `src/views/visibility/extractions/show.ejs`
- Modify: `src/views/partials/sidebar.ejs`
- Modify: `src/app.ts`

**Interfaces:**
- `/projects/:id/visibility/citations`
- `/projects/:id/visibility/subjects`
- `/projects/:id/visibility/extractions/:extractionId`

- [ ] **Step 1: Write RED integration/E2E contracts**

UI must visibly separate:
- Mention facts;
- Citation facts;
- `KNOWN_EMPTY / UNKNOWN / NOT_ELIGIBLE` states;
- subject registry and alias ambiguity;
- extractor version + subjectSetHash/sample provenance.

Assert page does not display Mention Rate, Citation Rate, Share of Voice or any ranking claim.

- [ ] **Step 2: Run RED**

```bash
npm test -- tests/integration/visibility-intelligence.web.test.ts
npm run test:e2e -- tests/e2e/citation-monitor.spec.ts
```

- [ ] **Step 3: Implement bounded web repository/routes/views**

Activate `Citation 监控` sidebar; keep Share of Voice placeholder disabled for P6-C.

- [ ] **Step 4: Verify GREEN**

```bash
npm test -- tests/integration/visibility-intelligence.web.test.ts
npm run test:e2e -- tests/e2e/citation-monitor.spec.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/visibility src/views tests src/app.ts
git commit -m "feat: add P6-B Citation Monitor"
```

---

## Task 11: Observability, Operations Guide, and P6-B Release Gate

**Files:**
- Create: `tests/integration/visibility-intelligence.observability.test.ts`
- Create: `src/modules/visibility/visibility-intelligence.observability.ts`
- Create: `docs/development/p6b-citation-mention-intelligence.md`
- Modify: `README.md` only after final green gate.

**Interfaces:**

Allowed events:
- `visibility.extraction.queued`
- `visibility.extraction.started`
- `visibility.extraction.completed`
- `visibility.extraction.failed`
- `visibility.extraction.backfill_queued`
- `visibility.subject.created`
- `visibility.subject.archived`
- `visibility.subject.alias_added`
- `visibility.subject.alias_ambiguous`

- [ ] **Step 1: Write RED observability tests**

Allow only IDs, extractorVersion, subjectSetHash, statuses, counts, errorCode, duration. Explicitly forbid answer text, prompt text, aliases/canonical subject values in logs, provider bodies, API keys, cookies, reasoning.

- [ ] **Step 2: Implement safe event serialization and integrate services/worker**

No content bodies in events.

- [ ] **Step 3: Write operator guide**

Document deterministic authority, evidence-state semantics, zero-network extraction, replay/subject snapshots, queue/backfill behavior, project gates, and P6-C exclusions.

- [ ] **Step 4: Run full release gate**

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=high
```

Additional required evidence:
- provider network call count during extraction tests = 0;
- `UNKNOWN` does not become zero;
- old extraction remains immutable after subject config changes;
- citation prose URL is never promoted to citation;
- Standard cannot enqueue extraction;
- P1-P6-A regression suite remains green;
- no P6-C metric model/calculator was introduced.

- [ ] **Step 5: Update README only after green**

Mark:

```text
P6-B Citation & Mention Intelligence — complete
P6-C Visibility Metrics & Competitor Share of Voice — next
```

- [ ] **Step 6: Re-run fresh CI on README final head**

Require verify + production-audit + Chromium E2E success on the exact final head.

- [ ] **Step 7: Final scope review and merge**

Compare main..head and confirm no P6-C implementation, provider calls, consumer UI automation, or secret persistence.
