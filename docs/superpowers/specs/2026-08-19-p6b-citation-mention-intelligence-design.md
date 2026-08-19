# P6-B Citation & Mention Intelligence — Design

Date: 2026-08-19
Status: Proposed design approved in chat; written-spec review pending
Repository: `liufaxing1978-droid/seogeo`
Depends on: P6-A Prompt Monitor & Sampling Core
Next phase: P6-C Visibility Metrics & Competitor Share of Voice

## 1. Goal

P6-B deterministically transforms persisted P6-A `PlatformObservation` records into auditable mention and citation facts.

P6-B answers two factual questions only:

1. Which explicitly configured owned or competitor subjects were mentioned in a saved provider answer?
2. Which provider-native citation/source records point to owned, competitor, or third-party domains?

P6-B does not calculate Mention Rate, Citation Rate, Share of Voice, visibility scores, trends, alerts, or weighted metrics. Those remain P6-C/P6-D responsibilities.

The extraction layer is deterministic and replayable. It does not use DeepSeek, another LLM, embeddings, fuzzy semantic inference, or live provider calls.

## 2. Core truth boundary

Authoritative P6-B facts may be derived only from already-persisted P6-A observations.

Mention authority:

- source: persisted `PlatformObservation.answerText`;
- matching: configured canonical subject values and configured aliases only;
- extraction: deterministic normalization + matching;
- no semantic guessing.

Citation authority order:

1. provider-native citation/source metadata normalized and persisted by P6-A;
2. provider-native search-result metadata explicitly associated with the answer and normalized by P6-A;
3. otherwise `UNKNOWN`.

A URL merely present in generated prose is not an authoritative provider citation.

P6-B must never make a new paid provider request while extracting, retrying, refreshing, syncing subjects, or backfilling facts.

## 3. Phase boundary

### P6-B delivers

- explicit visibility subject registry;
- owned brand/domain/entity subjects;
- selected competitor subjects;
- deterministic subject aliases;
- deterministic mention extraction;
- deterministic citation extraction;
- explicit extraction eligibility/status;
- immutable extraction snapshots and versioning;
- bounded backfill/refresh queue with zero provider calls;
- project-scoped mention/citation REST reads;
- subject/alias configuration APIs;
- Citation Monitor web surface;
- safe extraction observability;
- tests for normalization, UNKNOWN semantics, replay, isolation, atomicity and zero-network extraction.

### P6-B does not deliver

- Mention Rate;
- Citation Rate;
- Platform Coverage;
- Prompt Coverage;
- `VisibilitySnapshot`;
- competitor mention share;
- competitor citation share;
- Share of Voice;
- weighted visibility points;
- trends/alerts;
- report integration;
- consumer UI sampling;
- LLM review of ambiguous mentions.

## 4. Design decision: explicit subject registry

P6-B introduces `VisibilitySubject` instead of silently inferring every monitored subject from Project, P3 Entity, or P5 Competitor data.

This is necessary because not every P3 entity represents an owned identity and not every P5 competitor belongs in every future visibility comparison set.

The subject registry is the durable measurement contract used by the deterministic extractor.

### Subject types

- `OWNED_BRAND`
- `OWNED_DOMAIN`
- `OWNED_ENTITY`
- `COMPETITOR`

### Subject provenance

A subject may link to an existing source object:

- `Project.primaryDomain` for an owned-domain subject;
- P3 `Entity` for a selected owned-entity subject;
- P5 `Competitor` for a selected competitor subject;
- explicit project configuration for owned-brand subjects.

The provenance link does not make the source table mutable through P6-B. Extraction uses a snapshotted subject/alias set.

## 5. Safe bootstrap rules

When a project has no visibility subjects:

- bootstrap one `OWNED_DOMAIN` from normalized `Project.primaryDomain`;
- do not automatically treat all P3 entities as owned entities;
- do not automatically monitor all P5 competitors.

Explicit setup may then add:

- owned brand names;
- selected P3 entities;
- selected P5 competitors;
- explicit aliases.

## 6. Data model

### VisibilitySubject

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
- timestamps

Constraints:

- all resources are project-scoped;
- linked Entity/Competitor must belong to the same project;
- domain values use deterministic host normalization;
- archived subjects remain queryable for historical facts.

Recommended uniqueness:

- `(projectId, subjectType, normalizedValue)`

### VisibilitySubjectAlias

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

Rules:

- duplicate normalized alias for one subject is rejected;
- aliases are bounded in length/count;
- arbitrary executable regex is never accepted;
- the same normalized alias cannot silently identify multiple active subjects.

If an alias conflicts across active subjects, the system surfaces `AMBIGUOUS_ALIAS`; that alias is excluded from authoritative matching until resolved.

### VisibilityExtraction

One extraction for one source observation under one exact subject-set snapshot.

Fields:

- `id` UUID
- `projectId` UUID
- `platformObservationId` UUID
- `extractorVersion` string
- `subjectSetHash` string
- `subjectSnapshotJson` JSON
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

`subjectSnapshotJson` is bounded, canonically sorted and contains exactly the active measurement inputs used for that extraction: subject IDs/types, normalized canonical values, active normalized aliases and provenance IDs. It contains no secrets and no unrelated P3/P5 payloads.

The hash proves identity; the snapshot makes the historical measurement set reconstructable.

### MentionObservation

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

`firstPosition` is a deterministic offset in the normalized answer representation. It is not a provider ranking.

### CitationObservation

Fields:

- `id` UUID
- `projectId` UUID
- `visibilityExtractionId` UUID
- `platformObservationId` UUID
- `citationKey` string
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

- `(visibilityExtractionId, citationKey)`

`citationKey` is deterministically derived from normalized URL + provider-supplied position when present + normalized source type. Position remains null when the provider does not expose a stable order.

## 7. Subject snapshot and replay semantics

For every extraction:

1. load active project subjects/aliases;
2. build a canonically sorted bounded `subjectSnapshotJson`;
3. hash that exact serialized snapshot into `subjectSetHash`;
4. persist both snapshot and hash with derived facts.

When subjects or aliases change:

- historical extraction rows remain immutable;
- a new refresh creates a new extraction with a new subject snapshot/hash;
- old Mention/Citation rows remain attached to the old extraction;
- P6-C later selects an extraction version according to explicit snapshot policy.

No historical extraction is silently rewritten.

## 8. Mention normalization

Initial extractor version: `VISIBILITY_MENTION_V1`.

Normalization steps:

1. Unicode NFKC normalization;
2. normalize Unicode whitespace;
3. collapse repeated whitespace;
4. normalize selected punctuation variants needed for deterministic boundary matching;
5. case-fold where language/script supports case;
6. retain source answer unchanged; matching uses a derived normalized representation;
7. normalize domain candidates separately from ordinary names.

The extractor must support Chinese and Latin text without requiring whitespace tokenization for CJK.

### Authoritative matches

Only these may create mention facts:

- subject canonical value;
- active explicit alias;
- selected P3 EntityAlias copied into `VisibilitySubjectAlias`.

Do not perform:

- Levenshtein/fuzzy matching;
- embeddings;
- semantic similarity;
- synonym expansion;
- identity-changing stemming;
- LLM semantic equivalence decisions.

### Boundary safety

- Latin aliases use deterministic lexical boundaries;
- CJK aliases use exact normalized substring matching;
- operationally ambiguous short aliases are rejected or conflict-marked instead of silently matched.

### Domain mentions

A normalized owned/competitor domain explicitly appearing in answer prose may create `MentionObservation(DOMAIN)`.

It does not become a CitationObservation unless provider-native citation evidence also identifies it as a source.

## 9. Citation evidence state — required P6-A compatibility enhancement

P6-B cannot safely infer citation absence from `citationsJson=[]`; an empty array may mean “known no citations” or “metadata unavailable.”

Add a durable enum field to `PlatformObservation`:

- `citationEvidenceState`: `KNOWN_PRESENT | KNOWN_EMPTY | UNKNOWN | NOT_APPLICABLE`

Rules:

- new P6-A adapters set this from the provider-native response contract without making an extra request;
- existing pre-migration observations default to `UNKNOWN` unless deterministic persisted evidence proves another state;
- `UNSUPPORTED_WEB_GROUNDING` maps to `NOT_APPLICABLE`;
- migrations never reinterpret ambiguous historical empty arrays as zero citations.

This compatibility field is implemented before the P6-B citation extractor.

## 10. Citation extraction

Initial extractor version: `VISIBILITY_CITATION_V1`.

Input is only normalized, persisted P6-A citation/search-source metadata plus `citationEvidenceState`.

### Authority rule

A CitationObservation may be created only when the P6-A adapter normalized a provider-native source/citation record.

P6-B never parses generated prose to fabricate citation relationships.

### URL normalization

Apply existing deterministic URL-normalization principles where safe:

- lowercase host;
- remove fragment;
- normalize default ports;
- use existing shared host-alias rules where defined;
- preserve path/query unless an existing deterministic normalization rule applies;
- retain original URL;
- derive normalized host/domain.

Do not fetch citation URLs during extraction.

### Owned/competitor classification

For each citation domain:

- compare against active OWNED_DOMAIN values/approved domain aliases;
- compare against active competitor subjects and linked P5 competitor domains;
- set owned/competitor linkage only when the domain mapping is deterministic and unique;
- otherwise leave the citation third-party/unclassified.

## 11. Eligibility and UNKNOWN semantics

Absence of usable evidence is not automatically zero.

### Mention status

`NOT_ELIGIBLE` for:

- `PENDING`;
- `RUNNING`;
- `BUDGET_SKIPPED`;
- `UNSUPPORTED`;
- `FAILED`;
- `REFUSED`.

`UNKNOWN` for:

- `INCOMPLETE`;
- completed observation with missing/corrupt authoritative answer evidence;
- deterministic extractor failure.

`KNOWN_EMPTY` only when an eligible completed answer exists, deterministic scanning succeeds, and zero configured subjects match.

`EXTRACTED` when one or more MentionObservation rows exist.

### Citation status

`NOT_ELIGIBLE` for:

- pending/running samples;
- budget-skipped samples;
- failed samples;
- explicit unsupported grounding;
- provider refusal.

`UNKNOWN` for:

- incomplete observation;
- `citationEvidenceState=UNKNOWN`;
- malformed/inconsistent citation metadata;
- deterministic extractor failure.

`KNOWN_EMPTY` only when `citationEvidenceState=KNOWN_EMPTY` on an otherwise eligible completed grounded observation.

`EXTRACTED` only when native citation records are materialized.

`KNOWN_PRESENT` with zero valid normalized source rows is inconsistent evidence and therefore becomes `UNKNOWN` with a stable error code, not zero.

## 12. P3 Entity integration

P3 entities are identity evidence, not automatically monitored visibility subjects.

When an Entity is explicitly selected as `OWNED_ENTITY`:

- snapshot its canonical name into VisibilitySubject;
- optionally import selected aliases into VisibilitySubjectAlias with provenance;
- later P3 alias changes do not rewrite historical P6-B extraction facts;
- explicit sync may update current subject configuration and schedule deterministic re-extraction.

P6-B never writes into P3 Entity/EntityAlias tables.

## 13. P5 Competitor integration

When a P5 Competitor is explicitly selected:

- create/link a COMPETITOR visibility subject;
- snapshot competitor name;
- snapshot normalized competitor domain as deterministic domain identity;
- retain `competitorId` provenance;
- later P5 edits require explicit sync/re-extraction.

P6-B never changes P5 crawl/comparison facts.

## 14. Extraction subsystem architecture

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

The deterministic extraction worker must not depend on provider adapters, provider keys, P4 AI Gateway, or network fetchers.

## 15. Queue and execution

Introduce dedicated queue:

- `visibility-extraction`

Job types:

- `extract-observation`
- `backfill-project`

Stable job ID:

`visibility-extract:<observationId>:<extractorVersion>:<subjectSetHash>`

Properties:

- zero network requests;
- zero provider/LLM calls;
- no provider secrets;
- deterministic bounded retry policy;
- active/waiting/delayed deduplication;
- project ownership validation before work;
- bounded backfill expansion to observation-level jobs.

Backfill must use a hard maximum and pagination/cursor semantics. One project must not become one unbounded worker job.

## 16. Atomic extraction transaction

For one observation:

1. load source observation and same-project active subject configuration;
2. build subject snapshot/hash;
3. detect already-completed identical extraction;
4. derive mention/citation statuses and rows in memory;
5. transactionally create VisibilityExtraction + MentionObservation + CitationObservation rows;
6. complete extraction;
7. emit safe observability.

A failure cannot leave partial derived rows.

The extraction transaction never mutates source answer/citation facts.

## 17. Subject configuration service

Validation:

- non-empty canonical values after normalization;
- domain subjects must parse as acceptable hosts/domains;
- linked Entity/Competitor belongs to same project;
- ambiguous aliases fail closed;
- archived subjects do not delete history;
- no arbitrary regex/programmatic match expressions from users.

Feature gates:

- subject configuration: `AI_VISIBILITY`;
- mention/citation reads and extraction refresh: `CITATION_MONITOR`.

`STANDARD` remains blocked and cannot enqueue extraction work.

## 18. REST API

Extend `/api/v1/projects/:projectId/visibility`.

### Subjects

- `GET /subjects`
- `POST /subjects`
- `PATCH /subjects/:subjectId`
- `POST /subjects/:subjectId/aliases`
- `PATCH /subjects/:subjectId/aliases/:aliasId`
- `POST /subjects/bootstrap`
- `POST /subjects/:subjectId/sync`

### Extraction

- `POST /extractions/refresh`
- `GET /extractions`
- `GET /extractions/:extractionId`

### Facts

- `GET /mentions`
- `GET /citations`

Filters may include observation/run, provider/model/channel, prompt/prompt-set, subject/type, competitor, domain, time range and extractor version.

All resource reads/writes bind both projectId and resource identity.

## 19. Web UI

Activate the existing `Citation 监控` navigation for Advanced/Enterprise.

### Citation Monitor

Display fact exploration only:

- extraction status counts (`EXTRACTED / KNOWN_EMPTY / UNKNOWN / NOT_ELIGIBLE`);
- provider-native citation rows;
- source URL/domain;
- owned-domain marker;
- competitor linkage;
- provider/model/channel;
- prompt;
- observed time;
- extractor version;
- links to source run/observation.

### Mention view/tab

Display:

- subject/type;
- matched canonical/alias/domain value;
- occurrence count;
- first normalized position;
- provider/model/channel;
- prompt;
- observed time.

### Subject setup

Allow:

- confirm owned primary domain;
- add owned brand;
- select P3 owned entities;
- select P5 competitors;
- manage aliases;
- resolve alias conflicts;
- trigger deterministic refresh/backfill.

Do not display Mention Rate, Citation Rate or Share of Voice in P6-B.

## 20. Observability

Allowed events:

- `visibility.extraction.queued`
- `visibility.extraction.started`
- `visibility.extraction.completed`
- `visibility.extraction.failed`
- `visibility.extraction.backfill_queued`
- `visibility.subject.created`
- `visibility.subject.updated`
- `visibility.subject.alias_conflict`

Safe fields:

- project/observation/extraction IDs;
- subject ID/type;
- extractor version;
- subjectSetHash;
- mention/citation status;
- derived counts;
- error code;
- duration.

Never log answerText, promptText, raw provider bodies, reasoning, secrets, auth headers, or unbounded citation/alias payloads.

## 21. Security and isolation

- all resources are project-scoped;
- cross-project Entity/Competitor links fail closed;
- no citation URL fetch occurs;
- extraction worker has no provider credential dependency;
- aliases/backfills are bounded;
- normalization code is version-controlled;
- no consumer credential storage;
- no arbitrary provider base URLs or executable user regex.

## 22. Version constants

Initial versions:

- `VISIBILITY_SUBJECT_SET_V1`
- `VISIBILITY_MENTION_V1`
- `VISIBILITY_CITATION_V1`
- `VISIBILITY_EXTRACTION_V1`

Any bug fix/change that can alter authoritative derived facts increments the relevant extractor version and creates new extraction rows rather than silently rewriting history.

## 23. Migration and compatibility

P6-B adds:

- subject enums/models;
- alias model;
- extraction model;
- MentionObservation;
- CitationObservation;
- `citationEvidenceState` on PlatformObservation.

Existing P6-A observations remain authoritative source records.

Backfill rules:

- old citation state defaults to UNKNOWN unless deterministic persisted evidence proves otherwise;
- eligible saved answer text may be mention-extracted;
- citation extraction uses explicit evidence state;
- historical cost/provider-response facts remain unchanged;
- no migration makes provider requests.

## 24. Testing strategy

### Normalization unit tests

Cover Chinese exact matching, explicit simplified/traditional aliases, Latin case folding, Unicode full/half width, punctuation/whitespace normalization, lexical boundary safety, domain normalization, alias conflicts and absence of fuzzy matching.

### Mention extractor tests

Cover exact owned brand, configured alias, prose domain mention, competitor mention, repeated occurrences, multiple subjects, KNOWN_EMPTY, NOT_ELIGIBLE states, UNKNOWN/incomplete state and extraction version replay.

### Citation extractor tests

Cover owned native citation, competitor citation, third-party citation, duplicate URL occurrences, stable/missing position, prose URL without native citation, explicit native zero citations, ambiguous empty metadata, malformed metadata and no network access.

### Integration tests

Cover schema/migrations, project isolation, subject bootstrap, P3/P5 link validation, transaction atomicity, stable snapshot/hash, duplicate extraction idempotency, re-extraction after alias change, historical snapshot preservation, archive semantics, backfill bounds, feature gates and REST filters.

### Web/E2E tests

Cover Advanced Citation Monitor, Standard blocking, subject/alias setup, deterministic refresh without provider sampling, fact inspection, and absence of Mention Rate/Citation Rate/SOV labels.

CI must make zero live provider calls.

## 25. Implementation order

1. schema foundation: subject/alias/extraction/mention/citation plus `citationEvidenceState`;
2. P6-A adapter compatibility: populate explicit citation evidence state with fixture tests and zero extra network calls;
3. subject normalization + registry service + snapshot/hash;
4. deterministic mention extractor;
5. deterministic citation extractor;
6. atomic extraction repository/service;
7. dedicated `visibility-extraction` queue/worker + bounded backfill;
8. REST subject/extraction/mention/citation APIs;
9. Citation Monitor + subject setup UI;
10. safe observability + operator documentation;
11. P6-B integrated release gate.

Each implementation task follows RED -> GREEN and gets its own reviewable PR/merge boundary unless a schema/compatibility substep is inseparable for compilation.

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

Additional evidence:

- deterministic mention extraction only;
- native citation authority proven;
- prose URLs do not become citations;
- UNKNOWN vs KNOWN_EMPTY semantics proven;
- old empty citation arrays do not silently become zero;
- subjectSnapshotJson + subjectSetHash replay proven;
- ambiguous aliases fail closed;
- extraction/backfill makes zero provider calls;
- project isolation proven;
- P6-C metrics/SOV absent;
- P1-P6-A regression suite green.

## 27. Acceptance criteria

P6-B is complete when an Advanced/Enterprise project can:

1. explicitly configure owned brand/domain/entity and selected competitor subjects;
2. manage deterministic aliases without ambiguous silent matching;
3. derive mentions from eligible saved provider answers;
4. derive citations only from provider-native citation/search metadata;
5. distinguish EXTRACTED, KNOWN_EMPTY, UNKNOWN and NOT_ELIGIBLE;
6. inspect owned, competitor and third-party citation domains;
7. re-extract after subject changes without rewriting historical measurement sets;
8. backfill eligible P6-A observations without new paid provider calls;
9. inspect facts through project-scoped API/Web views;
10. verify that P6-B exposes no rate/SOV metric before P6-C;
11. pass the full release gate with zero live provider calls in CI.
