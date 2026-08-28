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
符纸                      CORE / INFORMATIONAL
├── 符纸是什么             QUESTION / INFORMATIONAL
├── 符纸有什么作用         QUESTION / INFORMATIONAL
├── 符纸种类               LONG_TAIL / INFORMATIONAL
├── 六壬符纸               LONG_TAIL / INFORMATIONAL
├── 民间信仰符纸           LONG_TAIL / INFORMATIONAL
├── 香港符纸文化           LOCAL / LOCAL
└── 符纸与符咒的区别       LONG_TAIL / INFORMATIONAL
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

P11-01 should introduce a focused new module under `src/modules/keywords`, with a clear repository/service boundary.

## 6. Keyword Taxonomy

### 6.1 Keyword type

Initial keyword types:

- `CORE` — primary strategic demand, e.g. `符纸`;
- `LONG_TAIL` — narrower query derived from or related to a core topic;
- `BRAND` — brand/entity demand;
- `QUESTION` — explicit question-form demand;
- `LOCAL` — geographic/localized demand;
- `COMMERCIAL` — commercial or conversion-oriented demand.

A keyword has one primary type in P11-01. More complex multi-label classification is deferred.

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

- AI workflows can never rename, archive, re-parent, delete, change priority, change type, change intent, lock, or unlock an authoritative keyword;
- a locked keyword's destructive/strategic fields may change only through an explicit authenticated human mutation that acknowledges the lock;
- bulk mutations must apply the same lock rule per keyword;
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
- `source KeywordSource` (`MANUAL`, `AI_ACCEPTED` initially)
- `language String?`
- `targetCountry String?`
- `notes String?`
- `createdByUserId UUID?` where compatible with the existing user model
- `createdAt`
- `updatedAt`

Identity rule:

- unique `(projectId, normalizedText)` across all statuses;
- archiving does **not** free the normalized keyword for recreation;
- reusing an archived term restores/reactivates the existing logical keyword through an explicit restore path rather than creating a second identity.

Normalization must be deterministic and conservative: trim surrounding whitespace, normalize repeated spaces, and apply Unicode normalization. It must not silently convert semantically distinct Chinese terms into one keyword.

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
- a child has at most one canonical `PARENT_CHILD` parent in P11-01;
- archiving a parent must not silently archive/delete its children; children become root/orphaned for display until explicitly re-parented.

Related-but-not-parent relationships are deferred.

### 7.3 `KeywordGroup`

A lightweight project-scoped grouping entity supports topics such as `符纸专题`, `六壬文化`, or `民间信仰`.

Suggested fields:

- `id UUID`
- `projectId UUID`
- `name`
- `description?`
- `createdAt`
- `updatedAt`

A join table may associate keywords with groups. A keyword may belong to more than one group, but group membership does not replace the canonical parent/child tree.

### 7.4 `KeywordSuggestion`

AI output remains non-authoritative until accepted.

Suggested fields:

- `id UUID`
- `projectId UUID`
- `seedKeywordId UUID`
- `suggestedText String`
- `suggestedType KeywordType?`
- `suggestedIntent KeywordIntent?`
- `rationale String?`
- `status` (`PENDING`, `ACCEPTED`, `REJECTED`, `EXPIRED`)
- model/provider metadata sufficient for traceability without secrets
- `createdAt`
- `decidedAt?`
- `decidedByUserId?`

Acceptance creates or links an authoritative `Keyword` through the normal keyword service. The suggestion row itself never becomes authoritative simply because the model emitted it.

### 7.5 Coverage persistence

P11-01 should avoid prematurely persisting a large mutable coverage graph if the result can be derived cheaply and deterministically from current `Page` / `PageSnapshot` facts.

Recommended initial design:

- compute coverage through a focused `KeywordCoverageService`;
- return page matches with evidence and a coverage classification;
- do not persist a new historical coverage schema in P11-01A unless repository inspection during implementation proves a current snapshot pattern requires it.

Historical keyword coverage runs are deferred to a later increment.

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

The implementation plan must inspect current persisted content fields before deciding exact scoring thresholds. Rendering the keyword center must not trigger a fresh crawl or provider request.

### 8.2 Coverage classes

Initial coverage classes:

- `STRONG` — clear dedicated/relevant page evidence;
- `PARTIAL` — related content exists but the keyword is weakly or indirectly covered;
- `NONE` — no meaningful observed coverage despite sufficient crawl evidence;
- `UNKNOWN` — insufficient crawl/content evidence to make a deterministic statement.

`UNKNOWN` is required. Missing crawl data must never be mislabeled as `NONE`.

### 8.3 Gap semantics

A content gap is generated only when:

- keyword status is active;
- coverage is `NONE` or a defined weak `PARTIAL` state;
- sufficient crawl evidence exists;
- the system returns the evidence used.

A content gap is a recommendation input, not an instruction to auto-publish.

## 9. AI Long-Tail Suggestion Flow

DeepSeek may assist with expansion, but the flow is explicitly two-phase.

### Phase A — advisory generation

Input may include:

- selected seed keyword;
- operator-selected market/language;
- existing accepted child keywords to reduce duplicates;
- project industry/topic context already allowed to be exposed to the advisory model.

Output is parsed into structured suggestions and persisted only as advisory `KeywordSuggestion` records.

### Phase B — human decision

The UI shows candidate terms with suggested type/intent and rationale.

The operator may:

- accept individually;
- accept selected suggestions in bulk;
- reject;
- edit proposed text before acceptance.

Only accepted candidates enter the authoritative keyword library.

The AI provider must never mutate authoritative keyword records directly from model output.

## 10. Authorization Contract

P11-01 reuses the existing capability model and does **not** add a new project role or broad authorization concept.

- keyword-center reads require `PROJECT_READ`;
- manual create/edit/status/parent/group/lock mutations require `CONTENT_WRITE`;
- AI suggestion generation requires both `AI_RUN` and project read access;
- accepting/editing an AI suggestion into the authoritative library requires `CONTENT_WRITE` in addition to the AI suggestion being visible to the user;
- rejecting a suggestion requires `CONTENT_WRITE` because it mutates project-owned workflow state;
- web mutations require CSRF;
- server-side capability checks are authoritative regardless of UI visibility.

This means existing `VIEWER` users can read the keyword center, while roles that already possess `CONTENT_WRITE` can manage the keyword library. No P10 membership semantics change is required.

## 11. Manual Keyword Mutation Contract

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

- require authenticated project membership and the capability from Section 10;
- validate project ownership of all referenced parent/group IDs;
- normalize keyword text before uniqueness checks;
- use database constraints plus service validation for concurrency safety;
- reject cycles;
- reject cross-project relationships;
- fail closed on locked-keyword destructive mutations unless the human request explicitly acknowledges the lock;
- record audit events using the existing audit pattern.

## 12. Error Contract

The implementation plan should define stable application error codes following current repository conventions, covering at least:

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

HTTP responses must not leak existence of resources across unauthorized projects.

## 13. UI Design

P11-01 adds a project-scoped **关键词中心** page using the existing P10 visual shell.

Primary page regions:

1. summary cards;
2. keyword library table;
3. keyword tree/topic view;
4. coverage/gap view;
5. add/edit keyword controls;
6. AI expansion panel.

### 13.1 Summary cards

Show deterministic counts such as:

- active keywords;
- locked strategic keywords;
- strong coverage;
- partial coverage;
- uncovered keywords;
- unknown due to insufficient crawl data.

Do not show fabricated search volume or rank.

### 13.2 Library table

Columns should include keyword, type, intent, priority, parent/topic, coverage, lock state, status, and actions.

Filters include text search, type, priority, coverage, status, and locked/unlocked.

### 13.3 Keyword detail

Selecting `符纸` should show:

```text
符纸
Type: CORE
Intent: INFORMATIONAL
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

The UI must visually distinguish persisted facts from AI recommendations.

### 13.4 AI suggestion panel

The AI panel must label candidates as **建议 / Advisory** and require selection + acceptance.

No one-click flow may both generate and silently persist all model output into the authoritative keyword library without a review step.

## 14. Search Demand Example

For an operator-created core keyword `符纸`, a normal P11-01 flow is:

```text
Operator adds 符纸
        ↓
Authoritative Keyword record
        ↓
Optional strategic lock
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

## 15. Ranking and GEO Truth Boundaries

The UI may reserve future navigation for Google, Baidu, Bing, Search Console, and AI visibility evidence, but P11-01 must show those as unavailable/not sampled unless real provider-backed evidence exists.

Specifically:

- internal keyword coverage != Google rank;
- Search Console impressions/position != deterministic SERP rank for every user;
- official AI provider observations != consumer ChatGPT/DeepSeek app ranking;
- configuration != health;
- suggestion != demand proof.

## 16. Security and Concurrency

P11-01 must reuse existing authentication, project membership, RBAC, CSRF, and audit boundaries.

Additional requirements:

- cross-project IDs are rejected/fail closed;
- no provider/API secrets are rendered in keyword views or prompts;
- bulk operations apply authorization and lock checks per item;
- unique project+normalized-keyword identity is database-enforced;
- accepting the same suggestion twice cannot create duplicate keywords;
- relation creation is idempotent or rejects duplicates deterministically;
- cycle validation and locked mutation checks re-read current state inside the mutation transaction rather than trusting stale UI state.

## 17. Observability

Minimum operational signals should support diagnosing:

- keyword created/updated/archived/restored;
- lock/unlock events;
- relation creation/removal;
- coverage evaluation failures;
- AI suggestion generation failures;
- suggestion acceptance/rejection;
- authorization failures at normal existing application granularity.

Logs must not contain secrets or provider credentials.

## 18. Test Strategy

Implementation follows **RED → minimal GREEN → exact-head full CI**.

### 18.1 Schema/repository

- normalized uniqueness per project across all statuses;
- same keyword allowed in different projects;
- archived duplicate creation rejected in favor of restore;
- relation same-project constraint;
- one canonical parent per child;
- duplicate relation prevention.

### 18.2 Service

- manual create/edit/archive/restore;
- lock semantics and explicit human lock acknowledgement;
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
- inactive pages handled according to existing active-page semantics;
- keyword-center reads trigger no fresh crawl/provider request.

### 18.4 Web/API authorization

- anonymous rejected;
- non-member does not learn project/resource existence;
- `VIEWER` can read but cannot mutate;
- role with `CONTENT_WRITE` can mutate;
- AI generation requires `AI_RUN`;
- CSRF enforced;
- locked keyword mutation blocked server-side without explicit acknowledgement.

### 18.5 UI / E2E

- add `符纸` manually;
- see it in the library;
- lock it;
- add/accept one child keyword;
- tree renders correctly;
- coverage renders with fact/suggestion distinction;
- responsive layout remains usable.

### 18.6 Full regression

Exact-head gates must preserve existing `verify`, `production-audit`, `e2e`, and required deployment-artifact/runtime gates.

## 19. Implementation Decomposition

P11-01 should not be implemented as one giant branch.

### P11-01A — Keyword domain foundation

- schema/migration;
- enums/types;
- repository/service;
- manual create/edit/status/lock/restore;
- parent/child relation safety;
- authorization/audit tests.

### P11-01B — Coverage engine

- deterministic coverage resolver against current persisted page facts;
- evidence model;
- `STRONG/PARTIAL/NONE/UNKNOWN`;
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

Each subtask obtains its own exact-head evidence before integration.

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
