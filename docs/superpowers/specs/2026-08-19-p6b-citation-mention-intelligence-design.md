# P6-B Citation & Mention Intelligence — Design

Date: 2026-08-19
Status: Approved
Repository: `liufaxing1978-droid/seogeo`
Depends on: P6-A Prompt Monitor & Sampling Core
Next phase: P6-C Visibility Metrics & Competitor Share of Voice

This approved design defines the P6-B deterministic Citation & Mention Intelligence boundary. The complete design content and decisions are implemented by the accompanying plan at `docs/superpowers/plans/2026-08-19-p6b-citation-mention-intelligence.md` and PR #77 history. Core invariants are preserved: explicit monitored-subject registry, deterministic exact/alias/domain matching only, provider-native citation authority, explicit `citationEvidenceState`, immutable `subjectSnapshotJson` + `subjectSetHash`, replayable extraction versions, zero provider/LLM/network calls during extraction, strict UNKNOWN/KNOWN_EMPTY semantics, project-scoped Advanced/Enterprise gating, and no P6-C metrics/Share of Voice in P6-B.

## Approved architecture summary

- Subjects: `OWNED_BRAND`, `OWNED_DOMAIN`, `OWNED_ENTITY`, `COMPETITOR`.
- Safe bootstrap: only `Project.primaryDomain` becomes an automatic owned-domain subject; P3 entities and P5 competitors require explicit selection.
- Aliases: explicit deterministic aliases only; ambiguous active aliases fail closed.
- Extraction: immutable `VisibilityExtraction` with lifecycle `QUEUED | RUNNING | COMPLETED | FAILED`, exact subject snapshot, hash, mention/citation evidence statuses, counts, and stable error code.
- Mentions: canonical/alias/domain matching using deterministic normalization; no fuzzy matching, embeddings, stemming, synonym expansion or LLM equivalence.
- Citations: only provider-native citation/source metadata normalized by P6-A; prose URLs never become citations automatically.
- Citation evidence: `KNOWN_PRESENT | KNOWN_EMPTY | UNKNOWN | NOT_APPLICABLE`; historical ambiguous empty arrays remain `UNKNOWN`.
- Queue: dedicated `visibility-extraction` queue with bounded observation-level jobs and zero external network/provider dependencies.
- Materialization: Mention/Citation rows are written atomically with extraction completion; failures leave no partial derived rows.
- REST/Web: subject/alias configuration, extraction refresh/backfill, mention/citation reads, Citation Monitor and extraction detail.
- Observability: IDs/versions/hashes/status/counts only; no prompt/answer bodies, aliases/canonical values, provider bodies, secrets or reasoning.
- Explicit P6-B exclusions: Mention Rate, Citation Rate, Platform/Prompt Coverage, VisibilitySnapshot, competitor share, Share of Voice, weighted visibility, trends, alerts, report integration and consumer UI sampling.

## Acceptance criteria

P6-B is complete only when the implementation plan's Task 1–11 release gate is satisfied on the exact final head: Prisma validate/generate/migrate, Typecheck, full tests, Build, Chromium E2E and production audit all green; extraction proves zero provider/network calls; UNKNOWN never becomes zero; historical extractions remain immutable across subject changes; prose URLs are not promoted to citations; Standard cannot enqueue extraction; and no P6-C metric implementation is present.
