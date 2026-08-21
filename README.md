# 兴善堂 SEO GEO

Independent SEO / GEO platform for `seo.xingshantang.org`.

Current milestone: **P0 - P8-A complete**. P8-A adds the controlled Safe Site Mutation + Primary Site Publication workspace; release completion still requires exact-head CI to pass before merge.

## Architecture

- Node.js 22
- TypeScript
- Express 5
- EJS
- PostgreSQL / Prisma
- Redis / BullMQ
- Zod
- Vitest / Supertest / Playwright
- DeepSeek through a provider-neutral advisory AI Gateway
- Official-provider adapters through the separate P6 visibility sampling pipeline
- Google Search Console through read-only OAuth and immutable daily source snapshots

## Core boundary

Deterministic crawler, SEO, GEO, content, competitor, reporting and Growth facts remain authoritative. AI may explain, summarize, prioritize and recommend, but it does not determine crawl/HTTP facts, SEO/GEO issue state, readiness scores, competitor metrics, verified-fix state or deterministic Growth scores/opportunity state.

P6 external visibility observations are authoritative only when the system actually performs a supported official-provider API sample and persists the normalized result. API sampling is never labeled as a consumer-product web/app ranking.

P7-A Search Console ingestion is read-only. Growth materialization consumes persisted GSC + P2/P3/P5/P6 facts and makes zero Google, P6-provider or DeepSeek calls.

P8-A consumes persisted proposal/draft/plan/preview/approval/execution/verification facts and keeps DeepSeek advisory-only. Git mutation never writes the default branch directly; Standard stays export-only, and Advanced/Enterprise Git execution is constrained to reviewed Draft PR flows.

Provider reasoning is never persisted, logged or rendered.

## P4 DeepSeek AI Gateway

P4 provides the project-scoped AI Analysis Center and durable advisory AI task execution.

Environment:

```text
DEEPSEEK_API_KEY=
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_FAST_MODEL=deepseek-v4-flash
DEEPSEEK_REASONING_MODEL=deepseek-v4-pro
DEEPSEEK_TIMEOUT_MS=180000
AI_MAX_INPUT_CHARS=200000
AI_MAX_OUTPUT_TOKENS=8192
```

The application starts without `DEEPSEEK_API_KEY`; only an actual advisory AI request fails safely when no key is configured.

Model routes:

- FAST → `deepseek-v4-flash`
- REASONING → `deepseek-v4-pro`

The routes are configurable through environment variables.

Operational details: `docs/development/p4-ai-gateway.md`.

## P5 Content Intelligence

P5-A materializes versioned content facts from persisted P1 snapshots, evaluates deterministic content signals/opportunities and exposes project-scoped Content Center pages and APIs.

Explicit failed/non-HTML snapshots preserve content facts as UNKNOWN rather than creating false thin-content/title/H1 failures. Schema evidence remains UNKNOWN unless a deterministic source supplies it.

Optional Content Brief and Content Optimization tasks use the existing P4 AI Gateway. A successful provider call is persisted with aggregate usage before the validated AI result, ContentBrief materialization and final COMPLETED state are committed atomically.

Operational details: `docs/development/p5a-content-intelligence.md`.

## P5 Competitor Intelligence

P5-B persists competitor facts separately from owned-site facts, uses bounded same-domain crawling with P1 safety/parser primitives and creates `COMPETITOR_COMPARISON_V1` deterministic gap snapshots.

Owned metrics that P5 does not deterministically possess—such as HTTP success share, structured-data presence share and indexability share—remain UNKNOWN rather than being fabricated from missing data.

Optional `COMPETITOR_GAP_ANALYSIS` uses the P4 AI Gateway only to explain saved gaps. It cannot invent rankings, traffic, citations, AI Visibility or Share of Voice.

Operational details: `docs/development/p5b-competitor-intelligence.md`.

## P5 Reporting

P5-C creates immutable `PROJECT_REPORT_V1` snapshots from persisted SEO, GEO, Content and Competitor data. Deterministic facts and AI advisory summaries are stored and displayed separately.

Report generation itself is database-only; it does not crawl or call DeepSeek. Optional Executive Summary uses the P4 AI task pipeline.

Operational details: `docs/development/p5c-reporting.md`.

## P6-A Prompt Monitor & Sampling Core

P6-A provides the Advanced/Enterprise foundation for externally sampled AI Visibility observations.

Delivered capabilities:

- project-level visibility settings and budget ceilings;
- API-only provider configurations without persisted secrets;
- immutable versioned Prompt Sets / Prompts;
- bounded manual sampling runs and stable sampling-unit idempotency;
- dedicated `visibility` BullMQ worker with paid attempts set to 1;
- preflight daily/run budget enforcement;
- normalized official API adapters for OpenAI, Gemini, Perplexity and Anthropic;
- explicit zero-network `UNSUPPORTED_WEB_GROUNDING` behavior for DeepSeek;
- project-scoped REST API;
- AI Visibility and Prompt Monitor web UI with explicit `API 采样` labeling;
- safe lifecycle observability with an allowlist that excludes prompt/answer bodies, secrets and provider reasoning.

P6-A does **not** calculate Mention Rate, Citation Rate or Share of Voice. P6-B adds deterministic, replayable Mention and Citation facts over persisted P6-A observations. P6-C materializes the deterministic rate and Share-of-Voice layer over those persisted facts, and P6-D consumes those immutable facts for history, comparisons, alerts and reporting.

Provider secrets remain server-side environment variables:

```text
OPENAI_API_KEY=
GEMINI_API_KEY=
PERPLEXITY_API_KEY=
ANTHROPIC_API_KEY=
```

Operational details:

- `docs/development/p6a-visibility-sampling.md`
- `docs/development/p6a-release-verification.md`

## P6-B Citation & Mention Intelligence

P6-B materializes deterministic, replayable Mention and Citation facts from persisted P6-A observations without live provider calls, external citation fetching, LLM extraction, embeddings or fuzzy semantic inference.

Evidence states preserve the distinction between `KNOWN_EMPTY`, `UNKNOWN` and `NOT_ELIGIBLE`; prose URLs never become Citations unless provider-native citation/search metadata supports them. Historical extractions are immutable across subject configuration changes, and subject snapshots are versioned by `subjectSetHash`.

Advanced/Enterprise Citation Monitor surfaces expose project-scoped subject configuration, extraction refresh/backfill, Mention facts, Citation facts, evidence state and provenance. Standard projects are blocked before restricted reads or side effects. P6-B itself does not calculate Mention Rate, Citation Rate or Share of Voice; those are materialized separately by P6-C.

Operational details: `docs/development/p6b-citation-mention-intelligence.md`.

## P6-C Visibility Metrics & Competitor Share of Voice

P6-C materializes immutable, deterministic metric snapshots over persisted P6-A/P6-B evidence. Authoritative calculation is database-only and makes zero provider/external network calls.

Delivered capabilities:

- `VISIBILITY_METRICS_V1` Mention Rate and Citation Rate;
- presence-based Mention Share of Voice with owned-subject rollup and per-competitor actors;
- explicit `CALCULATED`, `NO_SIGNAL`, `UNKNOWN`, `NOT_ELIGIBLE` and `NO_DATA` states;
- `KNOWN_EMPTY` denominator semantics and legitimate calculated 0% distinct from UNKNOWN;
- immutable snapshots frozen by extractor version, subject-set hash, window, cutoff and canonical scope;
- Overall, Provider and Prompt Set dimensions;
- dedicated `visibility-metrics` BullMQ queue/worker with deterministic bounded job identity and attempts=2;
- Advanced/Enterprise project-scoped REST API;
- dedicated `Visibility 指标` web UI with competitor SOV, coverage and provenance;
- safe allowlisted `queued / started / completed / failed` observability;
- hard bounds for 31-day windows, 20 Prompt Set filters, 20,000 candidates and 500-row DB batches.

P6-C remains the authoritative metric layer. It does not mutate historical facts to provide trends. P6-D now provides the separate immutable comparison, history, alert and report-integration layer over completed P6-C snapshots.

Operational details: `docs/development/p6c-visibility-metrics-sov.md`.

## P6-D History, Dashboard, Alerts & Report Integration

P6-D completes the AI Visibility product loop without changing P6-A/P6-B/P6-C fact semantics. Authoritative history, comparisons, alerts, dashboards and report generation consume persisted database facts only and make zero provider/external network calls.

Delivered capabilities:

- immutable `VISIBILITY_COMPARISON_V1` period comparisons over compatible completed P6-C snapshots;
- exact current/previous window provenance and explicit gap duration;
- absolute percentage-point deltas stored as basis points;
- `UNKNOWN`, `NO_DATA`, `NOT_ELIGIBLE` and `NO_SIGNAL` preserved as non-numeric states rather than coerced to zero;
- deterministic in-app alert rules and immutable trigger evidence with `OPEN -> ACKNOWLEDGED -> RESOLVED` lifecycle;
- bounded `visibility-monitoring` reconciliation for missed database-only handoffs;
- real AI Visibility history, alert, project-overview and portfolio dashboard surfaces;
- `PROJECT_REPORT_V2` with frozen safe P6 facts, bounded competitor SOV, latest compatible comparison and alert counts while preserving `PROJECT_REPORT_V1` compatibility;
- optional `VISIBILITY_TREND_ANALYSIS` through the existing P4 DeepSeek gateway using bounded persisted facts only;
- strict P6-D observability allowlists covering comparison, alert, reconciliation and Report V2 lifecycle events;
- operator guidance for retention, comparison semantics, UNKNOWN handling, rollout, incident triage and rollback.

P6-D V1 alerts are **in-app only**; it does not claim email, Slack, SMS, WeChat or other external delivery. `VISIBILITY_TREND_ANALYSIS` is **explicitly user-triggered only** and never runs automatically. Its output is advisory `AiAnalysisResult` data and cannot mutate deterministic P6 snapshots, rows, comparisons or alert evidence.

Operational details: `docs/development/p6d-history-dashboard-alerts-report.md`.

## P7-A Growth Opportunity Intelligence

P7-A connects read-only Google Search Console data to a deterministic, auditable Growth Opportunity layer while preserving the platform rule that AI is advisory rather than authoritative.

Delivered capabilities:

- AES-256-GCM encrypted Search Console OAuth credential records with hashed, expiring, single-use state;
- exact read-only Search Console scope and authorized property binding;
- immutable/versioned daily Query+Page snapshots through the `search-console-sync` BullMQ queue;
- stable 28-day current + 28-day previous windows excluding the most recent 3 calendar days;
- Query+Page aggregation and project-relative CTR curve;
- immutable Growth identities, opportunity snapshots, score breakdowns, evidence and Topic snapshots;
- persisted P2/P3/P5/P6 evidence adapters with deterministic provenance and root-cause dedupe;
- `GROWTH_SCORE_V1` with explicit evidence coverage, COMPLETE/PARTIAL/UNKNOWN quality and `UNKNOWN != 0` semantics;
- deterministic Ranking Upside, CTR Underperformance, SEO/GEO/Content/AI Visibility Gap, Declining Performance, Keyword Cannibalization and New Content detectors;
- database-only `growth-materialization` queue/worker with stable job identity;
- mutable audited lifecycle separated from immutable snapshots, including deterministic resolve/reopen behavior;
- bounded project APIs, Growth Opportunity Center UI, project dashboards and Enterprise portfolio rows;
- optional user-triggered `GROWTH_AI_EXPLANATION` through the existing P4 DeepSeek pipeline, unable to mutate deterministic Growth facts;
- strict Search Console/Growth observability event catalogs and safe scalar metadata allowlists;
- operator guidance for OAuth, key rotation, source coverage, stable windows, queues, bounds, lifecycle, incident triage and rollback.

Search Console source incompleteness or failure is never represented as zero traffic. Growth ranking requires sufficient known evidence; low-coverage opportunities remain diagnostic/UNKNOWN rather than receiving fabricated authoritative scores.

Operational details: `docs/development/p7a-growth-opportunity-intelligence.md`.

## P8-A Safe Site Mutation & Primary Publication

P8-A closes the deterministic Growth-to-publication execution loop without allowing AI or the browser GET layer to bypass review controls.

Delivered capabilities:

- persisted `PublicationSite` / `PublicationChannel` configuration with explicit `EXPORT_ONLY` vs `GIT_DRAFT_PR` capabilities;
- traceable P7/manual publication proposals and versioned content drafts;
- immutable/versioned publication plans, previews and hash-bound approvals;
- deterministic preview validation with blocking/warning/info semantics;
- stale review protection across plan/content/preview/base-SHA/target-blob contracts;
- allowlisted Git mutation execution that creates branches/commits/Draft PRs instead of directly writing the default branch;
- execution idempotency and append-only lifecycle evidence;
- real-site verification where `PR_CREATED != DEPLOYED` and `DEPLOYED != VERIFIED`;
- reviewable rollback proposals rather than force-reset behavior;
- project-scoped REST APIs and the `内容与发布` workspace covering opportunities, drafts/editor, exact preview/diff, execution and verification;
- Standard projects remain export-only and do not expose Git Draft PR execution controls;
- DeepSeek drafting/adaptation remains advisory: **AI 推荐，人来决定**.

P8-A GET rendering reads persisted facts only. It does not enqueue publication work, invoke DeepSeek, or perform Git/provider writes. Verification is deterministic and based on observed public-site facts rather than deployment claims.

Design: `docs/superpowers/specs/2026-08-21-p8-safe-site-mutation-design.md`.
Implementation plan: `docs/superpowers/plans/2026-08-21-p8-safe-site-mutation.md`.

## Feature gates

Base project features available to Standard / Advanced / Enterprise include:

- SEO Audit
- GEO Audit
- Content Intelligence
- Competitor Intelligence
- Reporting
- AI Analysis

P6 Advanced / Enterprise monitoring gates remain separate:

- AI Visibility
- Prompt Monitor
- Citation Monitor
- Competitor Share of Voice

P6-A activates AI Visibility and Prompt Monitor. P6-B activates Citation Monitor. P6-C activates Competitor Share of Voice / Visibility Metrics. P6-D extends those gated P6 capabilities with history, comparisons, in-app alerts, Report V2 visibility facts and explicit user-triggered trend analysis. Standard projects are rejected before restricted P6 reads, writes or queue side effects.

P7-A adds Search Console and Growth surfaces according to its explicit Standard / Advanced / Enterprise matrix. Restricted advanced Growth reads and side effects fail before repository access. Enterprise portfolio Growth rows remain bounded and deterministic.

P8-A exposes controlled publication review to all plans, but Standard remains `EXPORT_ONLY`. Git-backed Draft PR execution is available only where the configured site and plan explicitly permit it; no P8-A path auto-merges or directly writes the default branch.

`ADVANCED_REPORTS` remains reserved for future advanced scheduling/bundling/distribution rather than the base project report snapshot feature.

## Development

```bash
npm ci
npx prisma generate
npm run typecheck
npm test
npm run build
npm run test:e2e
```

## Release verification

Release gates use:

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

P6-A additionally requires proof that duplicate delivery cannot duplicate a paid adapter call, budget-skipped observations make zero provider calls, Standard projects cannot enqueue visibility sampling, DeepSeek unsupported grounding makes zero network calls, provider secrets are not persisted, API sampling is not mislabeled as consumer-product ranking, and CI uses fixture transports instead of live provider APIs.

P6-B additionally requires proof that extraction makes zero provider/network calls, `UNKNOWN` is never coerced to zero, historical extractions remain immutable after subject changes, prose URLs are never promoted to Citations, Standard cannot enqueue or read restricted Citation Monitor intelligence, prior P1–P6-A regression coverage remains green, and no P6-C metric model/calculator is introduced.

P6-C release evidence requires proof that authoritative metric materialization makes zero provider/external network calls; `UNKNOWN` never enters a denominator or becomes zero; `KNOWN_EMPTY` enters the correct denominator; legitimate zero stays `CALCULATED`; owned/competitor presence is deduplicated per observation; calculated SOV actor numerators sum exactly to the shared denominator; extractor/hash contracts never mix; old completed snapshots stay immutable after later P6-B backfill; Standard cannot generate/read P6-C; safe lifecycle logs exclude private content and secrets; prior P1–P6-B regression tests, build, Chromium smoke tests and runtime dependency audit all pass.

P6-D release evidence requires proof that comparisons only use compatible immutable P6-C snapshots; no-comparison/UNKNOWN states are never fabricated as numeric zero; trigger evidence remains immutable through acknowledge/resolve; reconciliation is bounded and zero-network; dashboards and `PROJECT_REPORT_V2` read persisted facts only; optional DeepSeek trend analysis is explicit user-triggered advisory work and cannot mutate deterministic P6 facts; P6-D lifecycle observability excludes prompt/answer/provider bodies, secrets, private aliases, citation URLs, reasoning and full report payloads; full Vitest, build, Chromium smoke tests and runtime dependency audit all pass.

P7-A release evidence requires proof that OAuth state replay is rejected before token exchange; Search Console daily synchronization is immutable/versioned/idempotent; missing/FAILED GSC days never become zero; 56-day stable-window coverage is enforced; deterministic score, evidence dedupe, detector identities and lifecycle transitions remain stable; Standard/Advanced/Enterprise gates fail before restricted reads/side effects; Growth materialization and GET rendering make zero Google/P6-provider/DeepSeek calls; observability drops Query/evidence/credential/AI/provider payloads; and exact-head CI passes `verify`, Chromium `e2e` and `production-audit` without live Google credentials.

P8-A release evidence requires proof that immutable plans/previews/approvals remain hash-bound; stale approval or changed base/target state blocks execution; Standard stays export-only; Git execution never writes the default branch directly or auto-merges; duplicate delivery cannot create duplicate valid executions/PRs; deterministic validation blockers cannot be overridden by DeepSeek output; GET publication workspace rendering makes zero AI/Git/queue side effects; real-site verification is required for `VERIFIED`; rollback stays reviewable; and exact-head CI passes `verify`, Chromium `e2e` and `production-audit`.

## Roadmap

- P0 Platform foundation — complete
- P1 Crawler + Technical SEO ingestion — complete
- P2 SEO Rule Engine + Audit UI — complete
- P3 GEO Engine + Citability + Entity — complete
- P4 DeepSeek AI Gateway + Intelligence — complete
- P5 Content, competitor analysis, reports — complete
- P6-A Prompt Monitor & Sampling Core — complete
- P6-B Citation & Mention Intelligence — complete
- P6-C Visibility Metrics & Competitor Share of Voice — complete
- P6-D History, Dashboard, Alerts & Report Integration — complete
- P7-A Search Console + Growth Opportunity Intelligence — complete
- P8-A Safe Site Mutation + Primary Site Publication — complete
