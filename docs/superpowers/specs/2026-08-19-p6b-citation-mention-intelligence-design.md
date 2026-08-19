# P6-B Citation & Mention Intelligence — Design

Date: 2026-08-19
Status: Proposed design approved in chat; written-spec review pending
Repository: `liufaxing1978-droid/seogeo`
Depends on: P6-A Prompt Monitor & Sampling Core
Next phase: P6-C Visibility Metrics & Competitor Share of Voice

## 1. Goal

P6-B deterministically transforms persisted P6-A `PlatformObservation` records into auditable mention and citation facts.

P6-B answers two factual questions only:

1. Which configured owned or competitor subjects were explicitly mentioned in a saved provider answer?
2. Which provider-native citation/source records point to owned, competitor, or other domains?

P6-B does not calculate Mention Rate, Citation Rate, Share of Voice, visibility scores, trends, alerts, or weighted metrics. Those remain P6-C/P6-D responsibilities.

The extraction layer is deterministic and replayable. It does not use DeepSeek, another LLM, embeddings, fuzzy semantic inference, or live provider calls.

## 2. Core truth boundary

Authoritative P6-B facts may be derived only from already-persisted P6-A observations.

Mention authority:

- source: persisted `PlatformObservation.answerText`;
- matching: configured subject values and configured aliases only;
- extraction: deterministic normalization + matching;
- no semantic guessing.

Citation authority order:

1. provider-native citation/source metadata persisted by P6-A;
2. provider-native search result metadata explicitly associated with the answer and persisted by P6-A;
3. otherwise `UNKNOWN`.

A URL that merely appears in generated prose is not an authoritative provider citation.

P6-B must never make a new paid provider request while extracting, retrying, refreshing, or backfilling facts.

## 3. Phase boundary

### P6-B delivers

- versioned visibility subject registry;
- owned brand/domain/entity subjects;
- competitor subjects;
- deterministic subject aliases;
- deterministic mention extraction;
- deterministic citation extraction;
- explicit extraction eligibility/status;
- historical/replayable extraction versions;
- backfill/refresh queue that never calls providers;
- project-scoped mention/citation REST reads;
- subject/alias configuration APIs;
- Citation Monitor web surface;
- extraction observability;
- tests for normalization, UNKNOWN semantics, project isolation, replay and zero-network extraction.

### P6-B does not deliver

- Mention Rate;
- Citation Rate;
- Platform Coverage;
- Prompt Coverage;
- VisibilitySnapshot;
- competitor mention share;
- competitor citation share;
- Share of Voice;
- weighted visibility points;
- trend calculations;
- alerts;
- report integration;
- consumer UI sampling;
- LLM review of ambiguous mentions.

## 4. Design decision: explicit subject registry

P6-B introduces an explicit `VisibilitySubject` registry rather than silently inferring all monitored subjects from existing project, P3 entity, or P5 competitor records.

This is required because not every P3 entity is an owned identity and not every competitor necessarily belongs in every future visibility comparison set.

The registry creates a durable measurement contract that can be snapshotted and replayed.

### Subject types

- `OWNED_BRAND`
- `OWNED_DOMAIN`
- `OWNED_ENTITY`
- `COMPETITOR`

### Subject sources

A subject may optionally link to an existing source object:

- `Project.primaryDomain` for an owned-domain subject;
- P3 `Entity` for an owned-entity subject;
- P5 `Competitor` for a competitor subject;
- explicit project configuration for an owned-brand subject.

The link supplies identity provenance. Extraction still uses the subject's own snapshotted value/aliases.

## 5. Subject bootstrap rules

P6-B may bootstrap safe defaults but must not over-infer ownership.

### Automatic bootstrap

When the project has no visibility subjects yet:

- create one `OWNED_DOMAIN` from normalized `Project.primaryDomain`;
- do not automatically convert every P3 `Entity` into `OWNED_ENTITY`;
- do not automatically convert every P5 `Competitor` into a monitored competitor subject unless explicitly requested by the P6-B setup flow.

### Explicit setup actions

The project may add:

- owned brand names;
- selected P3 entities as owned entities;
- selected P5 competitors as competitor subjects;
- explicit aliases for any subject.

## 6. Data model

### VisibilitySubject

A project-scoped monitored identity.

Fields:

- `id` UUID
- `projectId` UUID
- `subjectType`: `OWNED_BRAND | OWNED_DOMAIN | OWNED_ENTITY | COMPETITOR`
- `canonicalValue` string
- `normalizedValue` string
- `status`: `ACTIVE | ARCHIVED`
- `entityId?` UUID
- `competitorId?` UUID
- `sourceType`: `PROJECT_CONFIG | PRIMARY_DOMAIN | P3_ENTITY | P5_COMPETITOR`
- `createdAt`
- `updatedAt`

Constraints:

- project-scoped resource ownership;
- `OWNED_ENTITY` may reference only an Entity in the same project;
- `COMPETITOR` may reference only a Competitor in the same project;
- domain subjects store a normalized registrable host form used by the extractor;
- archived subjects remain available to historical extractions.

Recommended uniqueness:

- `(projectId, subjectType, normalizedValue)`

### VisibilitySubjectAlias

Explicit deterministic aliases.

Fields:

- `id` UUID
- `projectId` UUID
- `subjectId` UUID
- `alias` string
- `normalizedAlias` string
- `aliasType`: `NAME | DOMAIN | ENTITY_ALIAS`
- `sourceType`: `PROJECT_CONFIG | P3_ENTITY_ALIAS | PRIMARY_DOMAIN | P5_COMPETITOR`
- `status`: `ACTIVE | ARCHIVED`
- timestamps

Constraints:

- alias belongs to same-project subject;
- duplicate normalized alias for the same subject is rejected;
- ambiguous same normalized alias across multiple active subjects is not silently accepted into authoritative extraction.

If one normalized alias maps to multiple active subjects, setup/refresh must surface `AMBIGUOUS_ALIAS` and the alias must be excluded from authoritative matching until resolved.

### VisibilityExtraction

One deterministic extraction version for one `PlatformObservation` and one subject-set snapshot.

Fields:

- `id` UUID
- `projectId` UUID
- `platformObservationId` UUID
- `extractorVersion` string
- `subjectSetHash` string
- `answerHash?` string
- `mentionStatus`: `EXTRACTED | KNOWN_EMPTY | UNKNOWN | NOT_ELIGIBLE`
- `citationStatus`: `EXTRACTED | KNOWN_EMPTY | UNKNOWN | NOT_ELIGIBLE`
- `mentionCount` Int
- `citationCount` Int
- `errorCode?` string
- `startedAt?`
- `completedAt?`
- timestamps

Uniqueness:

- `(platformObservationId, extractorVersion, subjectSetHash)`

This prevents duplicate deterministic work while allowing re-extraction after subject/alias configuration changes.

### MentionObservation

One subject-level deterministic mention fact inside an extraction.

Fields:

- `id` UUID
- `projectId` UUID
- `visibilityExtractionId` UUID
- `platformObservationId` UUID
- `subjectId` UUID
- `subjectType`
- `subjectValue` string snapshot
- `matchedValue` string snapshot
- `mentionType`: `EXACT | NORMALIZED_ALIAS | DOMAIN`
- `occurrenceCount` Int
- `firstPosition?` Int
- `extractorVersion` string
- timestamps

Recommended uniqueness:

- `(visibilityExtractionId, subjectId, matchedValue, mentionType)`

`firstPosition` is a deterministic character/token offset in the normalized answer representation. It is not a provider rank.

### CitationObservation

One normalized provider-native citation fact inside an extraction.

Fields:

- `id` UUID
- `projectId` UUID
- `visibilityExtractionId` UUID
- `platformObservationId` UUID
- `url` string
- `normalizedUrl` string
- `domain` string
- `position?` Int
- `title?` string
- `sourceType?` string
- `occurrenceCount` Int
- `isOwnedDomain` Boolean
- `ownedSubjectId?` UUID
- `competitorId?` UUID
- `competitorSubjectId?` UUID
- `extractorVersion` string
- timestamps

Recommended uniqueness:

- `(visibilityExtractionId, normalizedUrl, position)` where practical;
- otherwise a deterministic citation key generated from normalized URL + provider position + source type.

Position is stored only when P6-A normalized provider metadata has a stable citation/source order. Missing position remains null.

## 7. Subject snapshot and replay semantics

Extraction results must be reproducible.

For every extraction, compute a deterministic `subjectSetHash` from the active measurement inputs:

- subject IDs;
- subject types;
- canonical normalized values;
- active normalized aliases;
- linked competitor/entity provenance identifiers where present.

Sort inputs canonically before hashing.

If subject configuration changes:

- old `VisibilityExtraction` rows remain immutable;
- a refresh creates a new extraction with a new `subjectSetHash`;
- old Mention/Citation rows remain attached to the old extraction;
- P6-C later chooses the correct extraction version according to its snapshot policy.

No historical extraction is silently rewritten.

## 8. Mention normalization

Initial extractor version: `VISIBILITY_MENTION_V1`.

Normalization steps:

1. Unicode normalize to NFKC;
2. normalize Unicode whitespace to ordinary spaces;
3. collapse repeated whitespace;
4. normalize punctuation variants needed for boundary matching;
5. case-fold scripts where case is meaningful;
6. preserve original text separately; extraction uses a derived normalized representation;
7. normalize domain values separately from ordinary names.

The extractor must support Chinese and Latin text without requiring word-space tokenization.

### Name/alias matching

Authoritative matches are only:

- configured canonical value;
- configured active alias;
- selected P3 EntityAlias copied/snapshotted into `VisibilitySubjectAlias`.

Do not perform:

- Levenshtein/fuzzy matching;
- embeddings;
- synonym expansion;
- stemming that changes identity meaning;
- LLM semantic equivalence decisions.

### Boundary safety

Latin aliases must use deterministic lexical boundaries so a short alias does not match inside unrelated words.

CJK aliases may use exact normalized substring matching because whitespace word boundaries are not reliable.

Short aliases that are operationally ambiguous should be blocked by configuration validation or marked ambiguous instead of entering authoritative metrics.

### Domain mention matching

Domain mentions are detected from normalized answer text when an owned/competitor domain is explicitly present as a host/domain string.

Domain mention extraction is independent from citation extraction. A prose domain mention may produce a `MentionObservation(DOMAIN)` but does not become a `CitationObservation` unless provider-native citation metadata supports it.

## 9. Citation extraction

Initial extractor version: `VISIBILITY_CITATION_V1`.

Input is the already normalized P6-A citation/search metadata in `PlatformObservation.citationsJson` and safe associated search metadata.

### Citation authority

A citation is authoritative only if the P6-A adapter normalized it from provider-native source/citation metadata.

P6-B never reparses generated prose to invent citation relationships.

### URL normalization

Apply deterministic URL normalization consistent with existing crawler principles where safe:

- lowercase host;
- remove URL fragment;
- normalize default ports;
- normalize host aliases where existing shared URL utilities already define the rule;
- preserve path/query unless a proven shared canonicalization rule applies;
- retain original URL separately;
- derive normalized host/domain deterministically.

Do not fetch citation URLs during extraction.

### Owned/competitor classification

For each normalized citation domain:

- compare against active `OWNED_DOMAIN` subjects and their domain aliases;
- compare against active competitor subjects linked to P5 Competitor domains;
- set `isOwnedDomain` only from deterministic domain equality/approved alias rules;
- set competitor linkage only when deterministic domain mapping is unique.

A citation may remain neither owned nor competitor.

## 10. Eligibility and UNKNOWN semantics

P6-B uses explicit status semantics because an absence of usable evidence is not automatically a zero.

### Mention extraction

`NOT_ELIGIBLE` when:

- observation status is `PENDING` or `RUNNING`;
- observation was `BUDGET_SKIPPED`;
- observation status is `UNSUPPORTED`;
- observation status is `FAILED`;
- observation was provider refusal and contains no authoritative answer text suitable for mention extraction.

`UNKNOWN` when:

- observation claims completion but answer evidence is missing/corrupt;
- bounded persisted answer was unavailable in a way that prevents authoritative extraction;
- extractor encounters an internal deterministic parse failure.

`KNOWN_EMPTY` when:

- observation is eligible;
- authoritative answer text exists;
- deterministic scan completes successfully;
- zero configured subjects are matched.

`EXTRACTED` when one or more MentionObservation rows are created.

### Citation extraction

`NOT_ELIGIBLE` when:

- provider grounding is explicitly unsupported;
- sample was budget-skipped, failed, pending, running, or otherwise did not produce an eligible completed grounded observation.

`UNKNOWN` when:

- provider adapter/result did not supply enough information to distinguish “no citation” from “citation metadata unavailable”;
- citation/search metadata is malformed or incomplete;
- the observation's grounding state is not deterministically known.

`KNOWN_EMPTY` only when:

- the provider adapter contract can positively establish that the eligible grounded response completed with zero native citations/sources.

`EXTRACTED` when one or more CitationObservation rows are created.

An empty JSON array alone is insufficient proof of `KNOWN_EMPTY` unless P6-A persists/derives an explicit citation evidence state from the provider contract.

## 11. Required P6-A compatibility enhancement

P6-B needs a deterministic citation evidence state. P6-A currently persists normalized citation arrays but an empty array can be ambiguous.

P6-B implementation should introduce a backwards-compatible field/state on `PlatformObservation` or its normalized search metadata, for example:

- `citationEvidenceState`: `KNOWN_PRESENT | KNOWN_EMPTY | UNKNOWN | NOT_APPLICABLE`

The preferred durable schema field is an enum column rather than an untyped JSON convention.

Existing observations created before this field exists default to `UNKNOWN` unless migration evidence can deterministically prove another state.

Provider adapters should set the state according to their native response contract without creating new requests.

## 12. Extraction service architecture

P6-B adds a deterministic extraction subsystem separate from the paid P6-A worker.

Suggested modules:

- `visibility-subject.repository.ts`
- `visibility-subject.service.ts`
- `visibility-normalization.ts`
- `visibility-mention.extractor.ts`
- `visibility-citation.extractor.ts`
- `visibility-extraction.repository.ts`
- `visibility-extraction.service.ts`
- `visibility-extraction.queue.ts`
- `visibility-extraction.worker.ts`
- `visibility-intelligence.routes.ts`
- `visibility-intelligence.web.routes.ts`

Provider adapters are not dependencies of the extraction worker.

## 13. Queue and execution

Introduce a dedicated deterministic queue, recommended name:

- `visibility-extraction`

Do not reuse the paid provider-call execution path.

Job types:

- `extract-observation`
- `backfill-project`

Stable job ID for one extraction unit:

`visibility-extract:<observationId>:<extractorVersion>:<subjectSetHash>`

Execution properties:

- no network requests;
- no provider secrets;
- no LLM calls;
- safe to retry deterministic failures under bounded retry policy;
- active/waiting/delayed deduplication;
- project-scoped resource checks before materialization.

Backfill expands to observation-level jobs rather than processing an unbounded project in one job.

## 14. Extraction transaction model

For one observation extraction:

1. load observation and same-project subject snapshot;
2. compute `subjectSetHash`;
3. check for an already completed extraction with the same `(observation, extractorVersion, subjectSetHash)`;
4. derive mention/citation statuses and rows in memory;
5. transactionally create the `VisibilityExtraction` and all derived Mention/Citation rows;
6. mark extraction completed;
7. emit safe observability event.

A transaction failure must not leave partial Mention/Citation rows.

No extraction transaction updates or deletes the source `PlatformObservation` answer/citation facts except the separately planned backward-compatible citation evidence-state migration/adapter normalization required by Section 11.

## 15. Subject configuration service

Subject writes are project-scoped and Advanced/Enterprise gated.

Validation:

- canonical values must be non-empty after normalization;
- domain subject values must parse as acceptable host/domain values;
- linked Entity/Competitor must belong to the same project;
- aliases containing secret-like configuration are irrelevant and not accepted as arbitrary JSON;
- ambiguous aliases across active subjects are surfaced explicitly;
- archiving a subject does not delete historical extraction facts.

Recommended feature gates:

- subject configuration under `AI_VISIBILITY`;
- citation/mention reads and refresh under `CITATION_MONITOR`.

`STANDARD` remains blocked and must not enqueue extraction work.

## 16. P3 Entity integration

P3 entities are identity evidence, not automatically monitored visibility subjects.

When a user selects a P3 entity as `OWNED_ENTITY`:

- snapshot `Entity.canonicalName` into the subject canonical value;
- optionally import selected active aliases from `EntityAlias` into `VisibilitySubjectAlias` with `sourceType=P3_ENTITY_ALIAS`;
- future P3 alias changes do not silently rewrite historical subject aliases/extractions;
- an explicit sync action may add/update current subject aliases and then schedule re-extraction.

P6-B must not write back into P3 Entity or EntityAlias tables.

## 17. P5 Competitor integration

When a user selects a P5 Competitor:

- create/link a `COMPETITOR` visibility subject;
- snapshot competitor name as canonical subject value;
- add normalized competitor domain as a DOMAIN alias or deterministic competitor-domain field;
- store the `competitorId` provenance link;
- future competitor edits require explicit sync/re-extraction rather than rewriting historical extraction facts.

P6-B does not alter P5 competitor crawl/comparison facts.

## 18. REST API

P6-B extends `/api/v1/projects/:projectId/visibility`.

### Subjects

- `GET /subjects`
- `POST /subjects`
- `PATCH /subjects/:subjectId`
- `POST /subjects/:subjectId/aliases`
- `PATCH /subjects/:subjectId/aliases/:aliasId`
- `POST /subjects/bootstrap`
- `POST /subjects/:subjectId/sync` for explicit P3/P5 source synchronization where supported

### Extraction

- `POST /extractions/refresh`
  - supports bounded project backfill filters;
  - no provider calls;
- `GET /extractions`
- `GET /extractions/:extractionId`

### Facts

- `GET /mentions`
- `GET /citations`

Read filters may include:

- observation/run;
- provider/model/channel;
- prompt/prompt set;
- subject/subject type;
- competitor;
- domain;
- observed-at range;
- extraction version.

All reads remain project-scoped.

## 19. Web UI

### Citation Monitor

Activate the existing sidebar placeholder.

Display deterministic fact exploration, not P6-C rates.

Sections:

- subject configuration summary;
- citation evidence-state counts (`EXTRACTED / KNOWN_EMPTY / UNKNOWN / NOT_ELIGIBLE`);
- citation-source table;
- source domain;
- owned-domain marker;
- linked competitor marker;
- provider/model/channel;
- prompt;
- observed time;
- extraction version;
- link to source run/observation.

### Mention facts

Citation Monitor may include a “提及” tab or companion view showing:

- subject;
- subject type;
- matched alias/value;
- occurrence count;
- first normalized position;
- provider/model/channel;
- prompt;
- observed time.

Do not show Mention Rate or Citation Rate in P6-B.

### Subject setup

Provide an Advanced/Enterprise project-scoped configuration view to:

- confirm owned primary domain;
- add owned brand names;
- select P3 entities;
- select P5 competitors;
- manage aliases;
- surface ambiguous alias conflicts;
- trigger deterministic refresh/backfill.

## 20. Observability

Allowed new safe events:

- `visibility.extraction.queued`
- `visibility.extraction.started`
- `visibility.extraction.completed`
- `visibility.extraction.failed`
- `visibility.extraction.backfill_queued`
- `visibility.subject.created`
- `visibility.subject.updated`
- `visibility.subject.alias_conflict`

Safe fields:

- project ID;
- observation/extraction IDs;
- subject ID/type;
- extractor version;
- subjectSetHash;
- mention/citation status;
- derived row counts;
- error code;
- duration.

Never log:

- answerText;
- promptText;
- provider raw response body;
- provider reasoning;
- secrets/auth headers;
- unbounded aliases or citation titles/URLs in lifecycle events.

## 21. Security and isolation

- every subject/alias/extraction/fact query binds `projectId`;
- cross-project Entity/Competitor links return not-found/fail closed;
- no arbitrary URL fetching occurs during citation extraction;
- no provider credentials are needed by P6-B worker;
- input aliases are bounded in size/count;
- backfill requests have hard maximum observation counts and pagination/cursor rules;
- P6-B does not accept arbitrary executable regex from project users;
- normalization rules are code/version controlled.

## 22. Versioning

Initial version constants:

- `VISIBILITY_SUBJECT_SET_V1`
- `VISIBILITY_MENTION_V1`
- `VISIBILITY_CITATION_V1`
- `VISIBILITY_EXTRACTION_V1`

Version changes are required when authoritative matching/normalization behavior changes.

A bug fix that can change derived facts must increment the relevant extractor version and produce new extraction rows rather than silently rewriting history.

## 23. Migration strategy

P6-B migration adds:

- subject enums/models;
- alias model;
- extraction model;
- MentionObservation;
- CitationObservation;
- citation evidence-state support on PlatformObservation.

Existing P6-A observations remain valid.

Backfill policy:

- pre-P6-B observations default citation evidence to `UNKNOWN` unless deterministic migration evidence proves a native state;
- mention extraction may run on eligible persisted answer text;
- citation extraction runs only under the new explicit evidence-state semantics;
- no historical cost/provider sampling facts are changed.

## 24. Testing strategy

### Normalization unit tests

Cover:

- Chinese exact names;
- simplified/traditional values only when explicitly configured as aliases;
- Latin case folding;
- punctuation/whitespace variants;
- full-width/half-width Unicode normalization;
- lexical boundary safety;
- domain normalization;
- ambiguous alias rejection;
- no fuzzy semantic matching.

### Mention extractor tests

Fixtures:

- owned brand exact mention;
- configured alias mention;
- owned domain prose mention;
- competitor mention;
- repeated mentions and count;
- multiple subjects;
- no mention -> KNOWN_EMPTY;
- failed/refused/unsupported/budget-skipped -> NOT_ELIGIBLE/UNKNOWN according to contract;
- extraction version replay.

### Citation extractor tests

Fixtures:

- native owned citation;
- native competitor citation;
- third-party citation;
- duplicate source URL occurrence;
- provider position present/absent;
- prose URL with no native citation -> no CitationObservation;
- explicit native zero citations -> KNOWN_EMPTY;
- ambiguous empty metadata -> UNKNOWN;
- malformed metadata -> UNKNOWN;
- no network access.

### Integration tests

Cover:

- schema/migrations;
- project isolation;
- subject bootstrap;
- P3/P5 source validation;
- transaction atomicity;
- stable subjectSetHash;
- duplicate extraction idempotency;
- re-extraction after alias change;
- archive semantics;
- backfill bounds;
- feature gates;
- REST filtering.

### Web/E2E tests

Cover:

- Advanced Citation Monitor loads;
- Standard is blocked;
- configure owned brand/competitor/alias;
- refresh extraction without starting a provider run;
- inspect deterministic citation/mention facts;
- no Mention Rate/Citation Rate/SOV labels appear in P6-B view.

CI must make zero live provider calls.

## 25. Implementation order

1. schema: subject/alias/extraction/mention/citation + citation evidence state;
2. subject normalization and registry service;
3. deterministic mention extractor;
4. deterministic citation extractor;
5. atomic extraction repository/service;
6. dedicated `visibility-extraction` queue + worker + backfill bounds;
7. P6-A adapter compatibility for explicit citation evidence state;
8. REST subject/extraction/mention/citation APIs;
9. Citation Monitor + subject setup Web UI;
10. observability + operator documentation;
11. P6-B release gate.

Each implementation task follows RED -> GREEN and gets its own reviewable PR/merge boundary unless a tightly coupled migration requires two adjacent substeps in one PR.

## 26. Release gate

P6-B cannot be marked complete until the final integrated head passes:

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

Additional P6-B release evidence:

- deterministic mention extraction only;
- native citation authority proven;
- prose URLs do not become citations;
- UNKNOWN vs KNOWN_EMPTY semantics proven;
- pre-P6-B empty citation arrays do not silently become zero;
- subjectSetHash/replay versioning proven;
- ambiguous aliases fail closed;
- no P6-B extraction triggers provider network requests;
- project isolation proven;
- P6-C metrics/SOV absent;
- P1-P6-A regression suite green.

## 27. Acceptance criteria

P6-B is complete when an Advanced/Enterprise project can:

1. explicitly configure owned brand/domain/entity and competitor subjects;
2. manage deterministic aliases without ambiguous silent matching;
3. derive mentions from eligible saved provider answers;
4. derive citations only from provider-native citation/search metadata;
5. distinguish `EXTRACTED`, `KNOWN_EMPTY`, `UNKNOWN`, and `NOT_ELIGIBLE`;
6. inspect owned, competitor, and third-party citation domains;
7. re-run extraction after subject configuration changes without rewriting history;
8. backfill existing eligible P6-A observations without new paid provider calls;
9. inspect mention/citation facts through project-scoped API/Web views;
10. verify that P6-B exposes no rate/SOV metric before P6-C;
11. pass the full P6-B release gate with zero live provider calls in CI.
