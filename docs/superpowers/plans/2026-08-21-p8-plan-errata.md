# P8 Implementation Plan Authoritative Clarifications

Date: 2026-08-21
Status: Authoritative clarification for P8 implementation

This file resolves two ambiguities found during the implementation-plan self-review. It does not change approved P8 product scope or architecture. When executing P8, these clarifications take precedence over conflicting wording in the child plan files.

## 1. P8-A Task 1 immutability migration

In `docs/superpowers/plans/2026-08-21-p8a-safe-primary-publishing.md`, the Locked File Map contains a sentence saying a later task may add a second forward migration for immutable triggers/index tightening.

**Authoritative rule:** do not defer or invent an unspecified migration. Task 1's migration:

```text
prisma/migrations/20260821160000_add_p8_publication_foundation/migration.sql
```

must include the Task 1 schema plus the required PostgreSQL immutability triggers defined by Task 1 Step 4 for:

- `PublicationPlan`
- `PublicationPreview`
- `PublicationApproval`
- `ContentDraftVersion`
- `PublicationExecutionEvent`

A later forward migration is created only when a later explicitly named task changes the schema and lists that migration in its Files section. Never create an ad-hoc migration merely because the Locked File Map used the word “may”.

## 2. P8-C migration order

The original P8-C plan gave the Task 24 entity-distribution base migration a timestamp that sorted before the Task 23 community-AI migration. That would make the file naming order diverge from implementation/apply order.

**Authoritative migration names/order:**

P8-B remains:

```text
20260821180000_add_p8_distribution
```

P8-C Task 23 must use:

```text
20260821190000_add_p8_community_ai_task
```

P8-C Task 24 entity-distribution persistence must use:

```text
20260821191000_add_p8_entity_distribution
```

P8-C Task 24 entity-suggestion AI task must use:

```text
20260821192000_add_p8_entity_suggestion_ai_task
```

Therefore, when following P8-C Task 23/24, replace every occurrence of:

```text
20260821191000_add_p8_community_ai_task
```

with:

```text
20260821190000_add_p8_community_ai_task
```

and replace every occurrence of:

```text
20260821190000_add_p8_entity_distribution
```

with:

```text
20260821191000_add_p8_entity_distribution
```

The `20260821192000_add_p8_entity_suggestion_ai_task` name remains unchanged.

## 3. Cross-plan AI task ownership

The self-review confirmed the intended ownership and it is locked here to prevent duplicate enum/task creation:

- P8-A Task 5 introduces `PUBLICATION_CONTENT_BRIEF`, `PUBLICATION_ARTICLE_DRAFT`, and `PUBLICATION_CONTENT_ADAPTATION`.
- P8-B Task 18 reuses `PUBLICATION_CONTENT_ADAPTATION`; it must not add a duplicate adaptation task type.
- P8-C Task 23 adds only `COMMUNITY_GEO_DRAFT`.
- P8-C Task 24 adds only `ENTITY_DISTRIBUTION_SUGGESTION`.

All of these continue through the existing P4 `ai` queue / `AiTaskService` / AI worker pipeline. No P8 task creates a second direct DeepSeek transport.

## 4. Queue ownership

The authoritative P8 queue additions are:

```text
site-mutation-execution
site-mutation-verification
distribution-preparation
```

AI content generation/adaptation continues to use the existing `ai` queue. Do not add a separate `content-generation` queue unless a later approved design explicitly changes this contract.

## 5. Execution reading order

Before implementation begins, read in this order:

1. `docs/superpowers/specs/2026-08-21-p8-safe-site-mutation-design.md`
2. `docs/superpowers/plans/2026-08-21-p8-program.md`
3. this clarification file
4. the active child plan (`p8a`, then `p8b`, then `p8c`)

The program remains Tasks 1–27, executed continuously P8-A → P8-B → P8-C → final release gate.
