# P11-01 Keyword Demand Capture Design

Status: **REVIEW**  
Date: **2026-08-28**  
Base: `main@2136087a5ae74b474b1b191b4ef957b4c7b61e96`

## 1. Purpose

P11-01 adds a first-class **Keyword Demand Capture / 关键词占位中心** to the SEO GEO platform.

The user outcome is simple: an operator can explicitly declare the search demand they want the site to capture — for example `符纸` — and the system can organize that demand into a controlled keyword tree, relate it to existing crawled content, identify coverage gaps, and prepare deterministic inputs for later content, SEO, GEO, ranking, and visibility workflows.

P11-01 is intentionally the foundation only. It does **not** attempt to deliver live SERP rank tracking, consumer ChatGPT/DeepSeek answer scraping, autonomous article publishing, or automatic business-strategy changes in the same increment.

## 2. Product Principle

The primary principle is:

> The operator decides what demand matters; the system helps structure, measure, and act on that demand.

The system may discover or suggest keywords, but operator-authored strategic keywords remain first-class persisted facts.

For example:

```text
符纸                      CORE
├── 符纸是什么             LONG_TAIL / INFORMATIONAL
├── 符纸有什么作用         LONG_TAIL / INFORMATIONAL
├── 符纸种类               LONG_TAIL / INFORMATIONAL
├── 六壬符纸               LONG_TAIL / SPECIALIST
├── 民间信仰符纸           LONG_TAIL / SPECIALIST
├── 香港符纸文化           LONG_TAIL / LOCAL
└── 符纸与符咒的区别       LONG_TAIL / COMPARISON
```

The tree is a planning structure, not a claim that every child term has proven search volume or ranking opportunity.

## 3. Scope

P11-01 includes:

1. manual keyword creation;
2. keyword editing, archive/restore, enable/disable, and strategic lock;
3. keyword classification and search-intent metadata;
4. parent/child keyword relationships;
5. project-scoped keyword groups/topics;
6. optional market/language targeting metadata;
7. advisory AI long-tail suggestions that require explicit human acceptance before entering the authoritative keyword library;
8. deterministic content-coverage analysis against persisted crawl/page facts;
9. a keyword-center UI showing library, tree, coverage status, and content gaps;
10. RBAC, CSRF, auditability, and fail-closed mutation behavior;
11. focused tests plus the existing exact-head full CI gates.

P11-01 does not include live rank tracking or downstream publishing automation.

## 4. Frozen Authority and Truth Boundaries

P11-01 must preserve the P0-P10 and Release-01 boundaries:

- AI remains advisory only.
- DeepSeek cannot silently add, delete, reclassify, archive, lock, unlock, publish, merge, deploy, or roll back authoritative records.
- Search Console remains read-only.
- Direct default-branch writes remain prohibited.
- `PR_CREATED != DEPLOYED != VERIFIED` remains true.
- Distribution continues to preserve VERIFIED/manual-handoff/provider boundaries.
- Optimization/autopilot gains no new merge, deploy, rollback, or publication authority.
- Existing crawler/page facts remain authoritative for what the platform actually observed on the site.
- Provider configuration presence must not be represented as live provider health.
- A generated long-tail suggestion is not a proven keyword opportunity until a user accepts it, and acceptance still does not prove search volume, ranking, or commercial value.
- P11-01 content coverage is an internal site-coverage fact, not a search-engine ranking fact.

## 5. Existing Repository Integration

P11-01 should integrate with existing boundaries rather than duplicate them:

- `src/modules/crawler` and persisted `Page` / `PageSnapshot` data provide observed site content facts.
- `src/modules/content` remains the content lifecycle domain; P11-01 may produce content-gap inputs but must not bypass content authority/lifecycle rules.
- `src/modules/growth` may later consume keyword opportunity facts, but P11-01 should not force Growth to infer strategic priorities from scratch.
- `src/modules/geo` and P6 visibility domains remain separate from keyword-library truth.
- existing project membership, RBAC, CSRF, audit, and last-owner protections should be reused rather than reimplemented.
- existing EJS/web layout patterns should be reused for the P11 keyword-center surface.

P11-01 should introduce a focused new module under `src/modules/keywords` (or the repository's closest established naming convention), with a clear service boundary.

## 6. Keyword Taxonomy

### 6.1 Keyword type

Initial keyword types:

- `CORE` — primary strategic demand, e.g. `符纸`;
- `LONG_TAIL` — narrower query derived from or related to a core topic;
- `BRAND` — brand/entity demand;
- `QUESTION` — explicit question-form demand;
- `LOCAL` — geographic/localized demand;
- `COMMERCIAL` — commercial or conversion-oriented demand.

A keyword has one primary type in P11-01. More complex multi-label classification is deferred unless implementation evidence proves it necessary.

### 6.2 Search intent

Optional intent values:

- `INFORMATIONAL`
- `NAVIGATIONAL`
- `COMMERCIAL_INVESTIGATION`
- `TRANSACTIONAL`
- `LOCAL`
- `UNKNOWN`

Intent may be manually selected or AI-suggested, but AI suggestions require explicit acceptance before replacing an operator-set value.

### 6.3 Priority

Priority values:

- `HIGH`
- `MEDIUM`
- `LOW`

Priority is an operator strategy field, not an AI score.

### 6.4 Strategic lock

A keyword may be `locked=true`.

Lock semantics:

- a locked keyword remains editable only through an explicit operator mutation that acknowledges the lock;
- AI workflows cannot delete, archive, re-parent, rename, change priority, or change type/intent on a locked keyword;
- bulk mutation paths must preserve lock semantics;
- locking does not prevent read-only coverage analysis.

This protects keywords such as `符纸` when the operator has explicitly declared them strategic even if AI later considers them difficult or low-confidence.

## 7. Proposed Data Model

The implementation plan should use the smallest schema that preserves normalized relationships and auditability.

### 7.1 `Keyword`

Suggested fields:

- `id UUID`
- `projectId UUID`
- `text String`
- `normalizedText String`
- `type KeywordType`
- `intent KeywordIntent?`
- `priority KeywordPriority`
- `status KeywordStatus` (`ACTIVE`, `DISABLED`, `ARCHIVED`)
- `locked Boolean default false`
- `source KeywordSource` (`MANUAL`, `AI_ACCEPTED`, future provider/import sources)
- `language String?`
- `targetCountry String?`
- `notes String?`
- `createdByUserId UUID?` where compatible with the existing user model
- `createdAt`
- `updatedAt`

Required uniqueness:

- unique `(projectId, normalizedText)` for active logical identity unless an existing normalization convention requires a different key.

Normalization must be deterministic and conservative: trim surrounding whitespace, normalize repeated spaces, and apply Unicode normalization. It must not silently convert distinct Chinese terms into a single semantic keyword.

### 7.2 `KeywordRelation`

Suggested fields:

- `id UUID`
- `projectId UUID`
- `parentKeywordId UUID`
- `childKeywordId UUID`
- `relationType` initially `PARENT_CHILD`
- `createdAt`

Rules:

- parent and child must belong to the same project;
- a keyword cannot parent itself;
- cycles are forbidden;
- duplicate edges are forbidden;
- deleting/archiving a parent must not silently delete child keywords.

P11-01 should support one canonical parent per keyword for the UI tree unless current product evidence requires DAG semantics. Related-but-not-parent relationships can be deferred.

### 7.3 `KeywordGroup`

A lightweight project-scoped grouping entity supports topics such as `符纸专题`, `六壬文化`, or `民间信仰`.

Suggested fields:

- `id UUID`
- `projectId UUID`
- `name`
- `description?`
- `createdAt`
- `updatedAt`

A join table may associate keywords with groups. A keyword may belong to more than one group if useful, but group membership must not replace the canonical parent/child tree.

### 7.4 `KeywordSuggestion`

AI output must remain non-authoritative until accepted.

Suggested fields:

- `id UUID`
- `projectId UUID`
- `seedKeywordId UUID`
- `suggestedText String`
- `suggestedType KeywordType?`
- `suggestedIntent KeywordIntent?`
- `rationale String?`
- `status` (`PENDING`, `ACCEPTED`, `REJECTED`, `EXPIRED`)
- `model/provider metadata` sufficient for traceability without secrets
- `createdAt`
- `decidedAt?`
- `decidedByUserId?`

Acceptance creates or links an authoritative `Keyword` through the normal keyword service. The suggestion row itself never becomes authoritative simply because the model emitted it.

### 7.5 Coverage persistence

P11-01 should avoid prematurely persisting a large mutable coverage graph if the result can be derived cheaply and deterministically from current `Page` / `PageSnapshot` facts.

Recommended initial design:

- compute coverage through a focused `KeywordCoverageService`;
- return page matches with evidence and a coverage classification;
- persist only when existing report/snapshot patterns require a durable run artifact.

If persistence is needed for historical comparison, introduce a small immutable `KeywordCoverageRun` + result model in the implementation plan rather than adding ad hoc columns to `Keyword`.

## 8. Content Coverage Semantics

Coverage answers one question:

> Based on the platform's latest persisted crawl/content facts, how well is this site's observed content covering this keyword?

P11-01 must not use a naive single substring match as the only signal.

### 8.1 Evidence sources

Deterministic evidence may include latest persisted:

- page title;
- H1;
- meta description;
- normalized URL/path;
- available extracted text/content representation already persisted by the current content/crawl pipeline;
- relevant existing entity/topic facts where stable and already authoritative.

The implementation plan must inspect current persisted content fields before deciding the exact matcher. It must not trigger an uncontrolled fresh crawl merely to render the keyword page.

### 8.2 Coverage classes

Initial coverage classes:

- `STRONG` — clear dedicated/relevant page evidence;
- `PARTIAL` — related content exists but the keyword is weakly or indirectly covered;
- `NONE` — no meaningful observed coverage;
- `UNKNOWN` — insufficient crawl/content evidence to make a deterministic statement.

`UNKNOWN` is required. Missing crawl data must never be mislabeled as `NONE`.

### 8.3 Gap semantics

A content gap is generated only when:

- keyword status is active;
- coverage is `NONE` or a defined weak `PARTIAL` state;
- sufficient crawl evidence exists;
- the system records the evidence used.

A content gap is a recommendation input, not an instruction to auto-publish.

## 9. AI Long-Tail Suggestion Flow

DeepSeek may assist with expansion, but the flow is explicitly two-phase.

### Phase A — advisory generation

Input may include:

- selected seed keyword;
- operator-selected market/language;
- existing accepted child keywords to reduce duplicates;
- project industry/topic context that is already allowed to be exposed to the advisory model.

Output is parsed into structured suggestions.

### Phase B — human decision

The UI shows candidate terms with suggested type/intent and rationale.

The operator may:

- accept individually;
- accept selected suggestions in bulk;
- reject;
- edit the proposed text before acceptance.

Only accepted candidates enter the authoritative keyword library.

The AI provider must never mutate the database directly from model output.

## 10. Manual Keyword Mutation Contract

Manual creation is the primary path.

Create request supports at minimum:

- keyword text;
- type;
- optional parent keyword;
- priority;
- optional intent;
- optional group;
- optional target market/language;
- optional notes;
- optional strategic lock.

Mutation service rules:

- require authenticated project membership;
- require the existing appropriate project-write capability;
- require CSRF for web mutations;
- validate project ownership of all referenced parent/group IDs;
- normalize keyword text before uniqueness checks;
- use database constraints plus service validation for concurrency safety;
- reject cycles;
- reject cross-project relationships;
- fail closed on locked-keyword destructive mutations;
- record audit events using the existing audit pattern where available.

## 11. Error Contract

The implementation plan should define stable application error codes, including equivalents of:

- `KEYWORD_DUPLICATE`
- `KEYWORD_NOT_FOUND`
- `KEYWORD_LOCKED`
- `KEYWORD_PARENT_SELF`
- `KEYWORD_RELATION_CYCLE`
- `KEYWORD_CROSS_PROJECT_REFERENCE`
- `KEYWORD_GROUP_NOT_FOUND`
- `KEYWORD_SUGGESTION_NOT_FOUND`
- `KEYWORD_SUGGESTION_ALREADY_DECIDED`
- `KEYWORD_COVERAGE_INSUFFICIENT_DATA`

Exact naming should follow current repository error conventions after inspection. HTTP responses must not leak existence of resources across unauthorized projects.

## 12. UI Design

P11-01 adds a project-scoped **关键词中心** page using the existing P10 visual shell.

Primary page regions:

1. summary cards;
2. keyword library table;
3. keyword tree/topic view;
4. coverage/gap view;
5. add/edit keyword controls;
6. AI expansion panel.

### 12.1 Summary cards

Show deterministic counts such as:

- active keywords;
- locked strategic keywords;
- strong coverage;
- partial coverage;
- uncovered keywords;
- unknown due to insufficient crawl data.

Do not show fabricated search volume or rank.

### 12.2 Library table

Columns should include:

- keyword;
- type;
- intent;
- priority;
- parent/topic;
- coverage;
- lock state;
- status;
- actions.

Filters:

- text search;
- type;
- priority;
- coverage;
- status;
- locked/unlocked.

### 12.3 Keyword detail

Selecting `符纸` should show:

```text
符纸
Type: CORE
Priority: HIGH
Locked: Yes
Coverage: PARTIAL

Children
- 符纸是什么
- 六壬符纸
- 符纸种类

Matched pages
- /article/...
- /culture/...

Gap recommendation
- Dedicated core topic page is weak/missing
```

The UI must visually distinguish facts from suggestions.

### 12.4 AI suggestion panel

The AI panel must label candidates as **建议 / Advisory** and require selection + acceptance.

No one-click flow may both generate and silently persist all model output without a review step.

## 13. Search Demand Example

For an operator-created core keyword `符纸`, a normal P11-01 flow is:

```text
Operator adds 符纸
        ↓
Authoritative Keyword record
        ↓
Optional lock = true
        ↓
Coverage service evaluates persisted site facts
        ↓
PARTIAL / NONE / STRONG / UNKNOWN
        ↓
Operator requests AI expansion
        ↓
Advisory candidates only
        ↓
Operator accepts selected long-tail terms
        ↓
Authoritative child keywords
        ↓
Coverage evaluated per accepted keyword
        ↓
Content gaps become inputs for later content workflows
```

This is the foundation for the later business goal: when customers search for relevant terms, the platform helps the operator systematically build the content coverage needed to compete for that demand.

P11-01 does not promise that adding a keyword causes Google/Baidu/AI systems to rank or cite the site.

## 14. Ranking and GEO Truth Boundaries

The UI may reserve future fields or navigation for:

- Google ranking;
- Baidu ranking;
- Bing ranking;
- Search Console query evidence;
- official-provider AI visibility observations;
- future consumer answer-surface observations where legally/technically supported.

However, P11-01 must display those as unavailable/not sampled unless real provider-backed evidence exists.

Specifically:

- internal keyword coverage != Google rank;
- Search Console impressions/position != deterministic SERP rank for every user;
- official AI provider observations != consumer ChatGPT/DeepSeek app ranking;
- configuration != health;
- suggestion != demand proof.

## 15. Security and Authorization

P11-01 must reuse existing application security boundaries:

- authentication required;
- project membership required;
- existing server-side RBAC capability checks;
- CSRF required for browser mutations;
- no authorization decisions based solely on hidden UI controls;
- cross-project IDs rejected/fail closed;
- audit events for keyword mutations and suggestion decisions;
- no provider/API secrets rendered in keyword views;
- AI prompts must not include secrets or unrelated private configuration.

Bulk operations must apply the same authorization and lock checks as single-item mutations.

## 16. Concurrency and Idempotency

P11-01 must behave predictably under duplicate clicks and concurrent requests.

Requirements:

- unique project+normalized-keyword identity enforced by the database;
- accepting the same AI suggestion twice cannot create duplicate keywords;
- relation creation must be idempotent or reject duplicates deterministically;
- cycle detection must be protected against race conditions as far as practical with transaction boundaries;
- locked destructive mutations must re-check the current database state inside the mutation transaction rather than trusting stale UI state.

## 17. Observability

Minimum logs/metrics should support diagnosing:

- keyword created/updated/archived;
- lock/unlock events;
- relation creation/removal;
- coverage evaluation failures;
- AI suggestion generation failures;
- suggestion acceptance/rejection;
- authorization failures at normal existing application granularity.

Logs must not contain secrets or full provider credentials.

## 18. Test Strategy

Implementation follows **RED → minimal GREEN → exact-head full CI**.

Required test areas:

### 18.1 Schema/repository

- normalized uniqueness per project;
- same text allowed in different projects;
- relation same-project constraint;
- duplicate relation prevention.

### 18.2 Service

- manual create/edit/archive/restore;
- lock semantics;
- explicit unlock/destructive behavior;
- parent self rejection;
- cycle rejection;
- cross-project reference rejection;
- group assignment;
- AI suggestion acceptance idempotency;
- rejected suggestion cannot silently become authoritative.

### 18.3 Coverage

- strong dedicated-page match;
- partial match;
- no match with sufficient crawl evidence;
- unknown when crawl evidence is insufficient;
- archived/disabled pages handled according to existing active-page semantics;
- no fresh-provider/crawl invention during a read-only page render.

### 18.4 Web/API authorization

- anonymous rejected;
- non-member does not learn project/resource existence;
- read-only role cannot mutate;
- authorized role can mutate;
- CSRF enforced;
- locked keyword mutation blocked server-side.

### 18.5 UI / E2E

- add `符纸` manually;
- see it in the library;
- lock it;
- add/accept one child keyword;
- tree renders correctly;
- coverage state renders with fact/suggestion distinction;
- responsive layout remains usable.

### 18.6 Full regression

Exact-head gates must preserve the repository's existing `verify`, `production-audit`, `e2e`, and any required deployment-artifact/runtime gates.

## 19. Implementation Decomposition

P11 should not be implemented as one giant branch. The recommended sequence is:

### P11-01A — Keyword domain foundation

- schema/migration;
- enums/types;
- repository/service;
- manual CRUD/status/lock;
- parent/child relation safety;
- focused authorization tests.

### P11-01B — Coverage engine

- deterministic coverage resolver against current persisted page facts;
- evidence model;
- STRONG/PARTIAL/NONE/UNKNOWN;
- gap derivation;
- tests.

### P11-01C — Keyword center UI

- navigation;
- summary/library/tree/detail surfaces;
- manual add/edit/lock flows;
- coverage display;
- E2E.

### P11-01D — AI long-tail advisory

- DeepSeek prompt/structured parser;
- suggestion persistence;
- review/accept/reject UI;
- idempotent acceptance;
- advisory labeling;
- full regression.

Each subtask should obtain its own exact-head evidence before integration.

## 20. Future P11 Increments

Explicit future work, not part of P11-01:

- P11-02 live ranking/provider evidence where supported;
- P11-03 Search Console keyword-performance linkage;
- P11-04 content brief/article workflow from accepted gaps;
- P11-05 keyword-to-GEO visibility linkage;
- P11-06 opportunity scoring using real evidence such as impressions, competition, coverage, conversion signals, or approved provider data;
- imports/exports and bulk keyword ingestion;
- scheduled monitoring and alerts.

These future increments must consume the authoritative P11-01 keyword library rather than create a second keyword truth source.

## 21. Explicitly Out of Scope

P11-01 does not include:

- guaranteed first-page ranking;
- fabricated search volume;
- scraping search engines without an explicitly approved compliant provider path;
- consumer ChatGPT/DeepSeek UI scraping;
- autonomous content publication;
- autonomous keyword deletion or strategic reprioritization;
- automatic merge/deploy/rollback;
- changes to P10 membership semantics;
- replacement of existing Content, Growth, GEO, or Visibility domains;
- production deployment.

## 22. Completion Definition

P11-01 is complete when an authorized operator can manually create and control strategic keywords such as `符纸`, organize accepted child/long-tail keywords, lock strategic terms against advisory mutation, evaluate deterministic site-content coverage with evidence, review/accept AI suggestions without granting AI authority, and use the keyword-center UI under the existing project security model.

Completion requires exact-head CI evidence and no regression of existing P0-P10/Release-01 truth, authority, runtime, or security boundaries.
