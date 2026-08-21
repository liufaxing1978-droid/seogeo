# P8 Safe Site Mutation, Content Publishing & GEO Distribution — Design

Date: 2026-08-21
Status: Approved design, implementation not started
Repository: `liufaxing1978-droid/seogeo`
Program: P8-A + P8-B + P8-C

## 1. Summary

P8 turns the existing SEO/GEO platform from a read/analyze system into a controlled execution system without crossing into autonomous site optimization.

P8 has three continuous milestones that are implemented in order but treated as one program:

- **P8-A — Git-backed Safe Site Mutation & Primary Publishing**: create, review, approve, apply, and verify bounded changes to a configured primary website through isolated Git branches and pull requests.
- **P8-B — Multi-channel Content Distribution**: prepare and, where a trustworthy adapter exists, publish or hand off canonical reposts, adapted articles, summaries, and secondary-site content.
- **P8-C — Community GEO & Entity/Knowledge Graph Support**: prepare community-native drafts and structured entity-edit suggestions while keeping sensitive or policy-governed platforms human-operated.

The first real primary publication target is `xingshantang.org`. P8 must support the existing publication sections as configurable channels:

- `/news`
- `/culture`
- `/archives`

These channel paths are configuration data, not hard-coded publication logic.

P8 preserves the platform's existing deterministic-authority boundary:

```text
P1-P6 persisted deterministic/observed facts
    -> P7 Growth Opportunity Intelligence
    -> P8 proposal/draft/plan/approval
    -> controlled execution
    -> real-site verification
    -> subsequent P7 measurement
```

DeepSeek remains advisory. It may generate content, variants, explanations, metadata, FAQs, and platform adaptations, but it may not approve, execute, merge, deploy, assert verification, mutate P7 deterministic facts, or perform autonomous optimization.

P8 intentionally stops before P9. Scheduling autonomous changes, score-triggered self-editing, self-merging, autonomous production rollback, and continuous self-optimization are P9 concerns and are out of scope.

---

## 2. Product goals

P8 must provide a complete controlled loop:

```text
P7 opportunity or manual intent
    -> content/change proposal
    -> draft and content brief
    -> SEO/GEO validation
    -> exact target selection
    -> immutable publication/change plan
    -> deterministic preview/diff
    -> hash-bound human approval
    -> safe Git execution
    -> pull request
    -> externally observed deployment
    -> deterministic verification
    -> distribution preparation
    -> future P7 measurement
```

The system must answer, for every change:

1. Why was this change proposed?
2. Which evidence or user request produced it?
3. What exact content/files/operations will change?
4. Which exact repository revision was reviewed?
5. Which exact plan was approved?
6. Who approved it and when?
7. What execution happened?
8. What external URL was observed afterward?
9. Did deterministic verification prove the expected result?
10. If not, what repair or rollback path is available?

---

## 3. Non-goals

P8 does not implement:

- direct writes to `main` or another configured default branch;
- force pushes;
- automatic PR merge;
- autonomous production deployment;
- unattended production rollback;
- page deletion in P8-A;
- bulk redirect campaigns in P8-A;
- automatic `noindex` application in P8-A;
- full-site AI rewrites;
- score-triggered continuous self-editing;
- autonomous Wikipedia publishing;
- fabricated or automated community discussion;
- automated Reddit/Quora/Zhihu participation that impersonates genuine human community activity;
- AI mutation of P7 scores, evidence, opportunity facts, or lifecycle truth;
- treating `PR_CREATED` or `DEPLOYED` as equivalent to `VERIFIED`.

---

## 4. Source-of-truth boundaries

### 4.1 `seogeo`

`seogeo` owns:

- P7 opportunity references;
- content briefs and drafts;
- draft version history;
- publication/change proposals;
- immutable plans and previews;
- approvals and execution records;
- distribution artifacts and statuses;
- verification results;
- rollback proposals;
- observability and audit events.

It is the workflow and control-plane source of truth.

### 4.2 Primary content website

The primary publication site's repository and deployed website own the final public content.

For the first production target this means:

```text
Public website: xingshantang.org
Primary content: website repository + deployed site
Control plane: seo.xingshantang.org / seogeo
```

The P8 database must not become the sole authoritative home of published page bodies. A published site must remain functional even if the SEO/GEO control plane is offline.

### 4.3 P7

P7 may supply:

- opportunity identity;
- opportunity type;
- score;
- priority;
- evidence references;
- Query/Page context;
- recommended action.

P8 may reference these facts but must not mutate them.

A P7 opportunity may create a P8 proposal. It may never create an approval or invoke an executor directly.

---

## 5. Architecture overview

P8 is decomposed into isolated units:

1. **Content Intelligence Workspace** — brief, drafts, versioning, source references, SEO/GEO review.
2. **Proposal Service** — why the change exists and which evidence/user intent produced it.
3. **Plan Builder** — exact target repo/revision/files/operations/expected outcomes.
4. **Preview & Validation Service** — deterministic diff plus content/SEO/GEO/safety checks.
5. **Approval Service** — hash-bound human authorization of one exact plan against one exact base revision.
6. **Mutation Executor** — applies only approved plans through configured adapters.
7. **Deployment Observer** — observes whether the public target appears deployed; it does not deploy in P8 V1.
8. **Verification Service** — re-crawls and validates the real public target.
9. **Rollback Planner** — generates reviewable repair/revert plans.
10. **Distribution Service** — produces independent per-platform distribution artifacts.
11. **Community GEO Service** — prepares community-native drafts with manual handoff.
12. **Entity Suggestion Service** — prepares structured entity/knowledge-graph suggestions with sources.

All external write capability is adapter-based and capability-declared.

---

## 6. Core data model

The exact Prisma naming may follow repository conventions, but the domain boundaries below are mandatory.

### 6.1 `ContentDraft`

Mutable drafting aggregate with append-only version history.

Required concepts:

- projectId
- sourceProposalId nullable
- title
- slug candidate
- body
- excerpt
- metaTitle
- metaDescription
- canonical candidate
- schema JSON candidate
- author/language
- currentVersion
- currentContentHash
- draft status

Every material edit creates a new immutable `ContentDraftVersion` or equivalent version row. AI edits and human edits must remain distinguishable.

Suggested provenance values:

- `HUMAN`
- `DEEPSEEK`
- `DETERMINISTIC_GENERATOR`

AI-generated content is always draft content until a human approves a plan containing it.

### 6.2 `ContentSourceReference`

Structured source references used while drafting.

Fields include bounded forms of:

- title
- author
- publisher
- source URL
- date
- source type
- access date
- user-provided/internal reference marker

The AI may use provided references and may suggest source gaps. It must not silently invent a source record and present it as verified.

### 6.3 `PublicationProposal`

Represents why a publication or change is being considered.

Source types:

- `P7_GROWTH_OPPORTUNITY`
- `MANUAL`
- `SEO_ISSUE`
- `GEO_GAP`
- `CONTENT_REFRESH`

A proposal may reference P7 evidence/snapshot IDs but must not duplicate private/raw evidence into unsafe metadata.

### 6.4 `PublicationSite`

Configuration for a writable or export-only primary/secondary site.

Required concepts:

- projectId
- display name
- domain
- repository identity where applicable
- base branch
- adapter type
- enabled flag
- allowed path configuration
- write capability

First target:

```text
name: 兴善堂
host: xingshantang.org
adapter: GITHUB_GIT
base branch: configured site default/main branch
```

The repository must be explicitly configured and permission-checked before writes. The design does not assume a repository is currently connected merely because a domain exists.

### 6.5 `PublicationChannel`

Configurable destination section within a site.

Initial first-site channels:

```text
最新消息 -> /news
六壬文化 -> /culture
民宗文献 -> /archives
```

Each channel may configure:

- slug/path prefix
- repository content path mapping
- template/content type
- default schema types
- allowed operation classes
- enabled flag

No core executor behavior may branch on hard-coded `/news`, `/culture`, or `/archives` strings.

### 6.6 `PublicationPlan`

Immutable, versioned execution contract.

A plan binds:

- projectId
- proposalId
- draft/content version
- publication site
- publication channel
- target public URL
- target repository and base branch
- exact `baseSha`
- target-file blob hashes where existing files are touched
- typed operations
- deterministic preview/diff hash
- expected post-deployment outcomes
- validator set/version
- risk class
- rollback strategy
- `planHash`

A plan is never edited in place after preview. Any material change creates a new version and a new hash.

### 6.7 `SiteChangeOperation`

P8-A V1 supports a bounded allowlist. The underlying implementation may map these to file-level mutations according to the site adapter/template.

Allowed low/medium operations include:

- `CREATE_CONTENT_PAGE`
- `SET_TITLE`
- `SET_META_DESCRIPTION`
- `SET_CANONICAL`
- `SET_META_ROBOTS` only when policy allows and risk is not HIGH
- `UPSERT_JSON_LD`
- `SET_H1`
- `REPLACE_BOUNDED_CONTENT_BLOCK`
- `ADD_INTERNAL_LINK`
- controlled `ROBOTS_RULE_CHANGE` only when explicitly configured and not HIGH
- controlled sitemap/config entry updates only when the target site's structure is known

P8-A rejects high-risk classes such as page deletion, bulk redirects, template-wide mass rewrites, mass `noindex`, production deployment commands, or cross-repository unbounded mutations.

### 6.8 `PublicationApproval`

Append-only human authorization.

Approval is not `approved=true`. It binds one exact reviewed state:

- planId
- planVersion
- planHash
- contentHash
- previewHash
- baseSha
- approver actor
- timestamp
- optional expiration
- approved risk scope

If any bound value changes, the approval becomes stale.

### 6.9 `PublicationExecution`

One logical execution per exact plan hash + target identity + base SHA.

Suggested deterministic key:

```text
sha256(planHash + repositoryIdentity + baseSha)
```

Execution records mutable lifecycle state; immutable events are stored separately.

### 6.10 `PublicationVerification`

Stores deterministic post-deployment checks, such as:

- observed URL
- observedAt
- HTTP result
- title match
- description match
- canonical match
- H1 match
- indexability
- Schema validity
- expected-content fingerprint/match result where applicable
- relevant P2/P3/P5 validation result references
- regression findings
- final verification status/reason

### 6.11 `DistributionTarget`

Independent target attached to one verified primary publication.

Examples:

- `MEDIUM`
- `LINKEDIN`
- `SUBSTACK`
- `WORDPRESS`
- `BLOGGER`
- `REDDIT`
- `QUORA`
- `ZHIHU`
- `WIKIDATA`
- `WIKIPEDIA`
- `BAIDU_BAIKE`
- future configured platforms

Each target has a declared mode and adapter capability.

### 6.12 `DistributionArtifact`

Immutable versioned platform adaptation.

Binds:

- primary publication ID
- source content version
- platform
- mode
- adaptation/prompt version
- artifact version
- artifact hash
- adapted title/body/summary where applicable
- original URL
- canonical URL where applicable
- generatedBy

When the source publication changes, old artifacts are marked `OUTDATED`; they are not silently rewritten.

---

## 7. Stable hashes and identity

All approval-sensitive hashes use canonical serialization with an explicit version.

Required hashes:

- `contentHash`
- `previewHash`
- `planHash`
- `approvalHash` or equivalent immutable approval fingerprint
- deterministic execution key

Canonical hashing must be independent of incidental database ordering and must normalize operation ordering, target identity, and file lists deterministically.

Hash-version changes require explicit migration/versioning; never reinterpret an old hash using a new algorithm.

---

## 8. Risk model

### LOW

Examples:

- create one new content article through a known template;
- title/meta description updates;
- bounded H1 or FAQ updates;
- valid JSON-LD additions/corrections;
- ordinary internal links.

### MEDIUM

Examples:

- editing existing body content;
- canonical changes;
- meta robots changes that remain indexable/safe;
- larger structural article edits;
- material primary-entity JSON-LD changes;
- controlled robots/sitemap configuration changes.

MEDIUM requires explicit review and visible warning in preview.

### HIGH

Examples:

- page deletion;
- mass redirects;
- mass noindex;
- template/global navigation mutation;
- broad robots blocking;
- bulk page operations;
- production deployment/merge operations.

P8-A rejects HIGH operations. A future phase may design them separately; they are not implicitly enabled by Enterprise licensing.

---

## 9. Approval and stale-protection contract

Approval is valid only when all of these still match:

- exact plan version/hash;
- exact content version/hash;
- exact preview hash;
- exact base repository SHA;
- expected current blob hashes for existing touched files;
- target repository and branch;
- allowed operation/risk policy.

Execution must re-read the target immediately before mutation.

If the branch or touched file revision no longer matches the reviewed state, execution fails closed with `TARGET_REVISION_CHANGED` or `APPROVAL_STALE` and moves to `STALE_REVIEW_REQUIRED`.

No fuzzy patch application is allowed after approval. The user receives a new preview and must approve the regenerated exact plan.

---

## 10. Git mutation adapter

P8-A introduces a `MutationAdapter` contract conceptually equivalent to:

```text
readTargetSnapshot()
preview(plan)
apply(plan)
readExecutionState()
rollback(execution)
```

The first implementation is GitHub-backed Git mutation for an explicitly configured site repository.

Execution sequence:

1. load approved plan;
2. verify plan/approval hashes;
3. verify project/feature permission before repository reads/writes that are restricted;
4. fetch configured target branch and exact base state;
5. verify stale protection and path/operation allowlists;
6. create a unique mutation branch;
7. apply only the approved exact operations;
8. create commit(s) scoped to the plan;
9. open a Draft PR;
10. persist branch, commit, PR, and execution identifiers;
11. stop.

P8-A never merges the PR.

Suggested mutation branch format:

```text
seogeo/p8/<publication-or-change-id>-<short-hash>
```

The adapter must never force push and must never update the configured default branch directly.

### Export-only adapter

P8-A also supports an export/patch-only capability for Standard or unconnected sites. It may produce the exact diff/artifact without any remote write.

---

## 11. Primary content workflow

### 11.1 Opportunity intake

The Content Opportunity view consumes persisted P7 facts and can create a P8 proposal.

A manual proposal is also allowed.

### 11.2 Content brief

Before long-form generation, the system builds an editable brief containing:

- primary topic/query;
- search intent;
- target audience;
- recommended title;
- recommended publication channel;
- article/content type;
- outline;
- relevant entities;
- FAQ ideas;
- internal-link suggestions;
- source requirements;
- GEO citation/answerability guidance.

DeepSeek may produce the initial advisory brief.

### 11.3 Content editor

The editor maintains version history and exposes separate AI actions such as:

- generate article;
- rewrite selected section;
- expand selected section;
- reduce generic/AI-like prose;
- generate FAQ;
- generate SEO title/meta description;
- improve entity coverage;
- prepare another language version.

Every material AI change creates a version rather than silently replacing an approved draft.

### 11.4 Pre-publication review

The deterministic quality gate produces `BLOCKING`, `WARNING`, and `INFO` findings.

Checks include, where applicable:

SEO:
- title/meta/H1;
- canonical;
- indexability;
- slug/URL;
- internal links;
- duplicate/conflict checks;
- Schema validity.

GEO:
- clear subject/entity identification;
- source-backed factual claims where required;
- structured FAQ/definition/answerability;
- citation-friendly structure;
- schema/entity consistency.

Content:
- empty fields;
- duplicate blocks;
- broken links;
- placeholder text;
- accidental AI instructions/prompt remnants;
- malformed Markdown/HTML.

Safety:
- prohibited scripts/unsafe HTML;
- target path escape;
- operation not on allowlist;
- forbidden file mutation;
- risk-class rejection.

`BLOCKING` prevents approval.

### 11.5 Channel selection

For the first site the UI allows explicit human selection of configured channels initially corresponding to:

- `/news`
- `/culture`
- `/archives`

The system may recommend a channel, but recommendation is advisory and cannot decide final approval.

### 11.6 URL conflict

If the target URL already exists, the system must not silently overwrite it.

It returns `URL_CONFLICT` and requires either:

- a different slug/new-publication plan, or
- an explicit update-existing-content proposal/plan.

### 11.7 Preview and approval

Preview shows:

- final public URL;
- target repo/branch/base SHA;
- files created/modified;
- exact diff;
- operation list;
- risk class;
- validation findings;
- expected post-deployment outcomes.

The user approves that exact preview.

---

## 12. Publication lifecycle

Primary publication lifecycle:

```text
DRAFT
SEO_REVIEW
PREVIEW_READY
APPROVED
QUEUED
EXECUTING
PR_CREATED
DEPLOYED
VERIFYING
VERIFIED
```

Exceptional/terminal-or-recovery states:

```text
APPROVAL_REQUIRED
APPROVAL_STALE
STALE_REVIEW_REQUIRED
TARGET_REVISION_CHANGED
URL_CONFLICT
VALIDATION_FAILED
EXECUTION_FAILED
VERIFICATION_FAILED
ROLLBACK_REQUIRED
ROLLED_BACK
```

Lifecycle rules:

- `PR_CREATED` does not mean public content is live;
- `DEPLOYED` means deployment was externally observed or reliably supplied by an approved deployment-status integration;
- `VERIFIED` requires deterministic real-target verification;
- verification regressions prevent `VERIFIED`;
- rollback is a new controlled proposal/plan, not an unreviewed side effect.

Append-only lifecycle/audit events are required.

---

## 13. Deployment observation and verification

P8 V1 does not deploy production automatically.

After the PR is merged/deployed through the site's existing human/CI process, the system observes the target and enters verification.

Verification must query the real configured public URL and may reuse existing deterministic crawler/audit components where appropriate.

Core checks:

- HTTP success and expected final URL;
- expected title/meta/H1;
- canonical match;
- indexability / no unexpected `noindex`;
- Schema parse/validation;
- expected content fingerprint or key semantic markers;
- no newly introduced critical deterministic SEO/GEO regressions;
- relevant P2/P3/P5 checks for the affected page.

Verification reason codes are bounded and observable without logging whole page bodies.

Only post-deployment evidence can produce `VERIFIED`.

---

## 14. Rollback and repair

Verification failure does not trigger autonomous production rollback.

The UI can generate:

- a repair proposal;
- a rollback/revert proposal;
- a re-verification request.

A rollback proposal uses known prior Git/plan/execution state and generates an exact reviewable diff/revert operation. It passes through Preview -> Approval -> Executor just like any other mutation.

Application rollback is preferred over destructive history rewriting. Git history remains auditable.

---

## 15. P8-B multi-channel distribution

External distribution is subordinate to the primary source.

Default rule:

```text
Primary publication must be VERIFIED before normal external distribution is unlocked.
```

Each external target is independent. One platform failure must not change the verified status of the primary site or other targets.

### 15.1 Distribution modes

Supported conceptual modes:

- `ORIGINAL`
- `CANONICAL_REPOST`
- `ADAPTED_ARTICLE`
- `SUMMARY`
- `NEWSLETTER`
- `SECONDARY_SITE_PUBLICATION`
- `COMMUNITY_DRAFT`
- `ENTITY_SUGGESTION`

The primary site uses `ORIGINAL`.

### 15.2 Adapter capability declaration

A `DistributionAdapter` conceptually declares capabilities such as:

```text
prepare()
preview()
publish() optional
verify() optional
```

Capability values include:

- `AUTOMATED_PUBLISH_SUPPORTED`
- `MANUAL_HANDOFF`
- `PREPARE_ONLY`

The application must never pretend a platform supports safe automated publishing when it does not.

### 15.3 Initial distribution targets

P8-B should support the following target types in the data/UI model:

- Medium — canonical repost/manual handoff unless a trustworthy supported integration is configured;
- LinkedIn — adapted article/newsletter draft/manual or supported integration;
- Substack — summary/newsletter/manual or supported integration;
- WordPress — secondary-site adapter where a configured authenticated REST integration is available;
- Blogger — secondary publication where a configured supported API integration is available.

A platform may ship as `MANUAL_HANDOFF` even if its model exists. The model must not require unsafe unofficial automation.

### 15.4 Source-version drift

Every distribution artifact binds to a primary source content version.

If the primary content changes after artifact preparation, the artifact becomes `OUTDATED` and must be regenerated/reviewed rather than silently replaced or published as current.

---

## 16. P8-C Community GEO

Community channels are not treated as article mirrors.

Target types include:

- Reddit
- Quora
- Zhihu
- Jianshu where relevant
- Tieba where relevant
- PTT
- Dcard
- Mobile01
- X / Threads / other real-time social channels as future configured targets

P8-C may:

- identify a relevant question/topic supplied by the user or an approved discovery source;
- generate a community-native response draft;
- adapt tone/language;
- summarize primary research;
- provide source references;
- flag promotional language;
- optionally include or omit the brand/source link;
- track human-published URL/status after manual action.

Default community capability is `MANUAL_HANDOFF` / `PREPARE_ONLY`.

P8-C must not:

- fabricate third-party endorsement;
- create fake discussion;
- mass-post promotional answers;
- bypass community/platform policy;
- claim a user independently said something that the user did not say;
- treat brand-link insertion as mandatory.

The product should favor useful, source-backed answers over marketing copy.

---

## 17. P8-C Entity & Knowledge Graph support

Entity targets include:

- Wikidata
- Wikipedia
- Baidu Baike

These targets use `ENTITY_SUGGESTION`, not generic article publishing.

The service can prepare:

- entity identity summary;
- candidate labels/descriptions;
- factual attributes;
- SameAs/external identifier suggestions;
- relationship candidates;
- supporting reliable-source list;
- missing-data report;
- conflict-of-interest/policy reminder where appropriate;
- human edit checklist.

The system does not auto-submit promotional Wikipedia edits. Human review and platform rules govern final editing.

---

## 18. Distribution lifecycle

Per-target distribution lifecycle:

```text
NOT_PREPARED
DRAFT_READY
APPROVED
PUBLISHED
VERIFIED
```

Additional states:

```text
OUTDATED
MANUAL_ACTION_REQUIRED
FAILED
```

For prepare-only/manual channels, `DRAFT_READY` or `MANUAL_ACTION_REQUIRED` may be the intended system terminal state until the user records the external action.

---

## 19. Queues

P8 introduces bounded queues aligned to existing BullMQ patterns:

- `content-generation`
- `site-mutation-execution`
- `site-mutation-verification`
- `distribution-preparation`

A separate external-publish queue is not mandatory because platform capabilities vary. A future supported adapter may add a specifically bounded queue after design review.

Queue invariants:

- deterministic job identity where the semantic operation is idempotent;
- no duplicate execution for the same execution key;
- bounded attempts/backoff;
- GET/render requests never enqueue mutation/publish work;
- feature/plan gates occur before restricted side effects;
- queue payloads contain IDs and bounded operational data, not credentials or full content when a database reference is sufficient.

---

## 20. Bounds and fail-closed behavior

Initial hard bounds:

- maximum files touched per plan: 20;
- maximum typed operations per plan: 50;
- one primary target URL per ordinary new-article publication plan;
- no HIGH-risk operations in P8-A;
- no direct default-branch writes;
- no force push;
- no automatic merge;
- no automatic production deployment;
- no automatic production rollback.

Implementation may choose stricter limits. Raising approved ceilings requires design/release review.

When a limit or invariant is violated, fail closed rather than truncating a mutation in a way that changes meaning.

---

## 21. Error reason codes

Core bounded reason codes:

```text
MUTATION_NOT_CONFIGURED
TARGET_NOT_FOUND
TARGET_REVISION_CHANGED
PATH_NOT_ALLOWED
OPERATION_NOT_ALLOWED
APPROVAL_REQUIRED
APPROVAL_STALE
PREVIEW_MISMATCH
URL_CONFLICT
CONTENT_VALIDATION_FAILED
SEO_VALIDATION_FAILED
GEO_VALIDATION_FAILED
WRITE_PERMISSION_DENIED
PROVIDER_RATE_LIMITED
PROVIDER_TRANSIENT_ERROR
EXECUTION_ALREADY_EXISTS
EXECUTION_FAILED
DEPLOYMENT_NOT_OBSERVED
VERIFICATION_FAILED
CONTENT_MISMATCH
CANONICAL_MISMATCH
NOINDEX_DETECTED
SCHEMA_INVALID
ROLLBACK_FAILED
DISTRIBUTION_NOT_SUPPORTED
DISTRIBUTION_MANUAL_ONLY
DISTRIBUTION_FAILED
```

Reason codes may be extended only through explicit contract/version review.

Provider error bodies, credentials, entire page bodies, full prompts/responses, or arbitrary exception objects must not be persisted as observability metadata.

---

## 22. Observability and audit

Suggested event catalog:

```text
mutation.proposal.created
mutation.plan.previewed
mutation.approval.granted
mutation.approval.invalidated
mutation.execution.queued
mutation.execution.started
mutation.execution.pr_created
mutation.execution.failed
mutation.deployment.observed
mutation.verification.started
mutation.verification.completed
mutation.verification.failed
mutation.rollback.proposed
mutation.rollback.completed
distribution.artifact.prepared
distribution.artifact.outdated
distribution.publish.completed
distribution.publish.failed
community.draft.prepared
entity.suggestion.prepared
```

Observability uses a strict allowlist of bounded scalar metadata such as:

- project/site/publication IDs;
- internal target/platform IDs;
- safe status/reason codes;
- safe counts;
- duration;
- branch/PR identifiers where non-sensitive;
- safe hashes/versions;
- safe dates.

Never log:

- OAuth/Git/provider credentials;
- authorization headers;
- full article bodies;
- raw source-evidence bodies;
- raw AI prompts/responses;
- provider raw bodies;
- private repository content not needed for safe operational telemetry.

---

## 23. Product access boundaries

P8 extends the existing Standard / Advanced / Enterprise model.

### Standard

- view eligible P7 content opportunities;
- create/edit drafts;
- deterministic SEO/GEO review;
- prepare preview/export patch/artifact;
- no external Git write by default.

### Advanced

Adds:

- configured Git-backed primary-site PR execution;
- `/news`, `/culture`, `/archives` style configured channels;
- publication verification;
- content versioning/workflow;
- Medium/LinkedIn/Substack distribution preparation and manual handoff;
- supported low/medium risk publication workflow.

### Enterprise

Adds, subject to explicit configuration:

- multiple publication sites;
- WordPress/other approved CMS adapters;
- portfolio publication controls;
- multi-user approval policies;
- advanced audit/governance;
- broader distribution management;
- entity/knowledge-graph management.

Enterprise does not bypass safety invariants. P8 still does not auto-merge production PRs or perform autonomous optimization.

Feature/plan gates must fail before restricted repository reads/writes or provider side effects.

---

## 24. Web/UI information architecture

P8 adds a top-level **Content & Publishing** area with at least:

1. **Content Opportunities** — P7-backed intake.
2. **Drafts / Editor** — brief, draft versions, source references, AI-assisted editing.
3. **Publication Preview** — URL, files, exact diff, risk, validation, approval.
4. **Publication Center** — current executions/PR/deployment/verification status.
5. **Verification Detail** — deterministic real-site checks and regressions.
6. **Distribution** — per-platform artifact preparation and state.
7. **Publication History** — audit/event history.

P8-A must deliver the first six core screens needed for the full safe path. Calendar and richer collaboration can follow within later P8 milestones if still within approved scope and plan.

The editor should visually separate:

- content body/editing;
- deterministic SEO checks;
- deterministic GEO checks;
- source references;
- visibly advisory AI actions.

No UI label may imply AI output is deterministic authority.

---

## 25. API design principles

P8 endpoints are project-scoped and bounded.

Principles:

- GET endpoints read persisted state only and trigger no provider/write work;
- mutation endpoints require explicit user actions;
- approval endpoints bind exact hashes/versions;
- execution endpoint cannot accept arbitrary file patches from the client as authoritative; it executes persisted reviewed plans;
- list endpoints are paginated/bounded;
- external credentials are server-side only;
- raw provider payloads are not returned by default;
- lifecycle transitions are validated server-side.

Exact route naming follows current repository conventions during implementation planning.

---

## 26. DeepSeek boundary

DeepSeek is allowed to:

- draft briefs/articles;
- rewrite bounded content;
- generate title/meta/FAQ suggestions;
- suggest channel fit;
- produce platform adaptations;
- produce community-response drafts;
- summarize entity/source material;
- explain why a deterministic recommendation may be useful.

DeepSeek is not allowed to:

- create approval;
- call MutationAdapter directly;
- select the final publication destination without human confirmation;
- merge a PR;
- deploy production;
- assert that a site change is verified;
- mutate P7 deterministic facts;
- create fabricated citations or endorsements;
- autonomously post community/knowledge-platform content.

AI work continues to use the existing P4 provider-neutral advisory pipeline where applicable.

---

## 27. Testing strategy

P8 is developed test-first and preserves the repository's current exact-head release discipline.

### 27.1 Unit tests

Lock contracts for:

- canonical serialization/hash stability;
- plan identity/versioning;
- preview hash;
- approval invalidation;
- risk classification;
- operation/path allowlists;
- URL/channel routing;
- lifecycle transitions;
- execution-key idempotency;
- adapter capability declarations;
- source-version `OUTDATED` behavior;
- reason-code mapping.

### 27.2 Integration tests

Use real Prisma/PostgreSQL test patterns where repository conventions allow and fake external transports.

Cover:

- immutable plans/previews/approvals/events;
- one logical execution per deterministic key;
- stale base SHA rejection;
- stale touched-file blob rejection;
- feature gate before repository/provider side effect;
- execution lifecycle persistence;
- verification persistence;
- rollback proposal persistence;
- independent distribution-target failure isolation;
- source-version drift;
- no credential/body leakage in observability.

### 27.3 Git adapter tests

CI uses a fake/in-memory transport or fixture repository contract to test:

```text
read base
create branch
write exact files
commit
open Draft PR
```

Normal CI must not write to the real `xingshantang` production repository.

### 27.4 E2E

Chromium flow includes at minimum:

```text
P7 opportunity
 -> create draft
 -> edit
 -> review SEO/GEO findings
 -> select /culture-equivalent configured channel
 -> preview exact change
 -> approve exact version
 -> fake/fixture PR_CREATED
 -> observe fixture deployment
 -> verify
 -> VERIFIED
 -> prepare Medium-style distribution artifact
```

Negative E2E includes:

- base SHA changed -> stale review required;
- URL conflict -> blocked;
- canonical mismatch -> verification failure;
- blocking validation -> approval unavailable;
- Standard plan -> external Git side effect rejected before adapter write.

### 27.5 Production audit

Existing production audit expectations remain intact. No live Google, DeepSeek, Git write, or distribution credentials are required by CI.

---

## 28. Release gate

Every P8 milestone must preserve the exact CI release jobs:

- `verify`
- Chromium `e2e`
- `production-audit`

A milestone is complete only when the exact final head SHA has all three successful.

Do not mark a release complete from an earlier green SHA if the completion/documentation commit has not itself passed the required exact-head gate.

P8 final completion requires P8-A, P8-B, and P8-C to be integrated and a final exact-head release gate to pass.

---

## 29. Program decomposition and sequencing

The user has approved completing P8-A, P8-B, and P8-C as one continuous program. Implementation still proceeds sequentially because each later milestone relies on safety contracts proven earlier.

### P8-A — Git-backed primary publishing

Must deliver:

- schema/persistence for drafts/proposals/plans/approvals/executions/verifications/events;
- content brief/editor core;
- deterministic SEO/GEO quality gate;
- configurable PublicationSite/Channel;
- immutable preview/plan/hashes;
- approval stale protection;
- GitHub Git mutation adapter and export-only fallback;
- Draft PR creation only;
- deployment observation/verification;
- repair/rollback proposal path;
- primary P8 UI/API;
- first-site support for `/news`, `/culture`, `/archives`-mapped channels once the target repository is explicitly connected/configured.

Entry to P8-B requires an exact-head green P8-A gate.

### P8-B — Multi-channel distribution

Must deliver:

- DistributionTarget/Artifact persistence;
- source-version drift and `OUTDATED` semantics;
- adapter capability model;
- Medium/LinkedIn/Substack preparation/manual handoff;
- WordPress/Blogger adapters only where supported integration contracts and credentials are explicitly configured;
- distribution UI/API;
- platform failure isolation;
- primary `VERIFIED` dependency.

Entry to P8-C requires an exact-head green P8-B gate.

### P8-C — Community GEO & entity support

Must deliver:

- community-native draft model/workflow;
- manual handoff default for Reddit/Quora/Zhihu and similar community platforms;
- source-backed response preparation;
- entity suggestion model/workflow for Wikidata/Wikipedia/Baidu Baike;
- human-review/policy boundary;
- safe status/audit UI;
- no automated fake engagement or promotional knowledge-base publishing.

### P8 Final Release Gate

Must deliver:

- operator documentation;
- observability review;
- permissions/security review;
- full regression suite;
- exact-head `verify`, Chromium `e2e`, and `production-audit` success;
- final README/roadmap marker only on a head that is subsequently re-verified.

---

## 30. Completion criteria

P8 is complete only when all of the following are true:

1. P7 opportunities can produce controlled P8 proposals without mutating P7 facts.
2. Users can create/edit versioned drafts with advisory DeepSeek assistance.
3. Primary publication channels are configurable and include the first-site `/news`, `/culture`, `/archives` mappings.
4. A primary publication can be previewed as an exact deterministic change.
5. Approval is bound to exact plan/content/preview/base hashes.
6. Stale target revision invalidates execution and forces re-review.
7. Approved low/medium changes can create an isolated Git branch, commit, and Draft PR without touching the default branch directly.
8. Production deployment is not assumed from PR creation.
9. Real-site deterministic verification is required for `VERIFIED`.
10. Verification failures can produce controlled repair/rollback proposals.
11. Verified primary content can produce independent distribution artifacts.
12. Manual-handoff platforms are not falsely advertised as automated.
13. Community GEO is human-reviewed and does not fabricate organic discussion.
14. Entity/knowledge-graph support produces sourced suggestions rather than autonomous promotional edits.
15. DeepSeek cannot approve, execute, merge, deploy, verify, or rewrite deterministic P7 facts.
16. All P8-A/B/C functionality is covered by bounded unit/integration/E2E contracts.
17. Final exact-head CI has `verify`, Chromium `e2e`, and `production-audit` all successful.

At that point the platform has the closed operational loop:

```text
Analyze -> Prioritize -> Draft -> Review -> Approve -> Execute -> Verify -> Distribute -> Measure
```

Autonomous orchestration remains explicitly deferred to P9.
