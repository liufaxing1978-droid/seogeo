# P2 SEO Rule Engine and Audit Guide

## Purpose

P2 is the deterministic SEO interpretation layer built on P1 crawl facts. P1 owns factual collection; P2 reads those facts and creates versioned rule results, stable issue identities, audit occurrences, explainable scores and before/after comparisons.

P2 must not rewrite crawler history. A PageSnapshot, HTTP result, robots result or sitemap result remains a factual P1 observation even if an SEO issue is later ignored or resolved.

## Data flow

```text
Project
  → completed CrawlRun
  → PageSnapshot / HTTP / robots / sitemap facts
  → SeoAuditRun
  → versioned Rule Engine
  → SeoRuleResult
  → SeoIssue + SeoIssueOccurrence + SeoIssuePage
  → SeoScore + SeoScoreComponent
  → Audit Compare / SEO Audit UI
```

## Deterministic rule catalog

The initial P2 catalog contains page-level and crawl-level rules. Rules have a stable `ruleCode`; behavior, severity, weight and detection configuration belong to a versioned `SeoRuleVersion`.

Page rules currently include:

- HTTP 5xx / 4xx / redirect observations
- missing, short and long titles
- missing and overlong meta descriptions
- missing and multiple H1 headings
- missing canonical on indexable HTML pages
- thin content
- images missing alt text
- slow factual server response
- oversized HTML

Crawl-level rules currently include:

- robots.txt fetch failure
- robots.txt server error
- unavailable sitemap
- sitemap parse error
- empty sitemap URL set

Rule evaluation operates on stored P1 facts. Unknown facts stay unknown; the engine must not convert missing transport evidence into an invented HTTP condition.

## Rule versioning

A rule identity and a rule version are deliberately separate.

- `SeoRule.ruleCode` is the stable logical identity.
- `SeoRuleVersion.version` records a specific detection definition.
- Severity, weight, detection type/configuration, SEO impact and fix guidance are versioned.
- `SeoRuleResult` points to the exact rule version used by that audit.
- Historical results are therefore explainable even after a rule is changed later.

Changing a threshold or scoring weight should create a new rule version instead of silently mutating the meaning of historical audits.

## Audit eligibility and execution

An SEO audit requires a completed P1 crawl. The audit engine reads the crawl-linked factual snapshot set and synchronized built-in rule versions.

The execution order is:

1. validate the linked crawl is completed;
2. mark the audit running;
3. load audit input and synchronize rule definitions;
4. evaluate page rules and crawl-level rules;
5. replace raw rule results for the audit run;
6. synchronize stable issues and current occurrences;
7. calculate and persist SEO Score and components;
8. mark the audit completed.

A completed audit is treated as idempotently complete by the engine. BullMQ/API orchestration should use stable job/audit identifiers rather than creating duplicate business facts for retries.

## Raw results versus user-facing issues

`SeoRuleResult` is a low-level rule observation. It records PASS, FAIL or UNKNOWN for the exact audit/rule/page-or-crawl scope and stores structured evidence.

`SeoIssue` is the stable user-facing identity, keyed per project and rule (`rule:<ruleCode>` in P2). It survives across audits.

`SeoIssueOccurrence` records that a stable issue failed in a specific audit, with the rule version, severity, comparison state and affected-page count. `SeoIssuePage` links the occurrence to concrete Page identities and the underlying rule results.

This separation prevents repeated audits from creating unrelated duplicate issues while preserving per-audit history.

## Issue lifecycle

Comparison semantics are deterministic:

- `NEW` — detected now without an earlier occurrence that makes it a regression.
- `PERSISTENT` — present in the immediately previous completed audit and still present now.
- `REGRESSED` — previously existed, later disappeared/resolved, then appears again.
- `FIXED` — shown in comparison when an issue occurred in the previous audit but has no occurrence in the current audit.

Stable issue status supports operational workflow:

- `OPEN`
- `IN_PROGRESS`
- `PARTIALLY_FIXED`
- `RESOLVED`
- `IGNORED`
- `REGRESSED`

Manual actions may move an issue into workflow states such as `IN_PROGRESS`, `PARTIALLY_FIXED` or `IGNORED`. A user or AI explanation must not directly mark a technical problem `RESOLVED`. Resolution is verified by a later deterministic audit in which the issue no longer fails.

Ignored issues remain intentionally ignored across issue synchronization unless product policy changes explicitly in a future version.

## SEO Score

P2 uses an explainable deductive score with baseline 100.

For each failing score component:

```text
penalty = weight × severityMultiplier × pageImpactFactor × importanceFactor
```

Current severity multipliers:

```text
CRITICAL = 4.0
HIGH     = 2.5
MEDIUM   = 1.5
LOW      = 0.5
```

`pageImpactFactor` is the affected/eligible ratio clamped to 0–1. P2 uses `importanceFactor = 1` by default. The total score is `100 - totalPenalty`, clamped to 0–100.

Only deterministic PASS/FAIL eligible observations participate in the relevant component denominator. UNKNOWN facts do not become artificial penalties.

Every persisted score stores its component breakdown and rule-version reference so the score can be explained later. Historical scores are not overwritten by a new audit.

## Audit comparison

REST and web comparison both take explicit current and previous audit IDs belonging to the same project.

The comparison view groups issues into:

- New
- Persistent
- Regressed
- Fixed

The UI derives these groups from persisted issue occurrences and stable issue history. It does not compare rendered HTML strings, call an AI model, or infer changes from text descriptions.

## APIs and web UI

P2 API capabilities include:

- create a project SEO audit;
- fetch project SEO summary;
- list audit history;
- fetch one audit;
- list project issues;
- fetch one issue;
- update permitted issue workflow status;
- compare two audits.

P2 web capabilities include:

- SEO Audit dashboard;
- Issue Center;
- Issue Detail with affected pages/evidence and workflow actions;
- Audit Compare with NEW / PERSISTENT / REGRESSED / FIXED groups.

## Queue execution

SEO audits run through the `seo-audit` BullMQ queue for asynchronous production execution. Queue retries must remain idempotent at the business layer: retrying a job must not create a second stable issue identity for the same project/rule or duplicate per-audit occurrences.

The queue transports work; PostgreSQL remains the source of truth for audit state and results.

## Structured audit events

P2 emits structured lifecycle summaries:

- `seo.audit.started`
- `seo.rule.evaluated.summary`
- `seo.issues.synced`
- `seo.score.calculated`
- `seo.audit.completed`
- `seo.audit.failed`

Events contain identifiers and aggregate counts only. Do not log page bodies, raw HTML, meta descriptions, headings, rule evidence payloads, cookies, authorization material or query-string secrets.

## P1 / P2 ownership boundary

P1 owns:

- CrawlRun lifecycle and network collection
- Page and PageSnapshot factual history
- HTTP/redirect observations
- robots.txt observations
- sitemap observations
- deterministic HTML parsing facts
- browser-render observations

P2 owns:

- SEO audit lifecycle
- rule catalog and versions
- raw SEO rule results
- stable SEO issues and occurrences
- severity/issue lifecycle
- SEO Score and components
- audit comparison and SEO audit UI

P2 may read P1 data but must not mutate P1 historical observations to change an audit result.

## AI boundary

DeepSeek is not part of P2 factual decision-making. It cannot decide:

- whether a rule passed or failed;
- the factual HTTP status;
- affected-page counts;
- issue severity;
- SEO Score;
- NEW/PERSISTENT/REGRESSED/FIXED state;
- whether a technical fix is verified.

When DeepSeek is introduced later through the AI Gateway, it may explain a deterministic issue, summarize impact or propose remediation based on source-referenced facts.

## Release verification

The P2 release gate is the repository CI suite:

```bash
npx prisma validate
npx prisma generate
npx prisma migrate deploy
npm run typecheck
npm test
npm run build
npm run test:e2e
```

CI also audits the deployable production dependency tree separately from development tooling. Chromium E2E runs against deterministic application/database fixtures; CI does not need to crawl a live public production site.

## P3 handoff

P3 GEO Engine may consume selected P1/P2 facts, but GEO readiness remains a separate domain from SEO severity and from actual AI Visibility sampling.

P3 must preserve the same source-of-truth principle: deterministic technical/entity/citability observations first, derived scoring second, AI explanation later.