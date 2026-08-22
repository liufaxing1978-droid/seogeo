# P9-0H — Third-party Skill Foundation

## Purpose

P9-0H adds a fail-closed, read-only foundation for using reviewed third-party SEO/GEO methods as **advisory data only**. It does not execute third-party code, call third-party networks at runtime, load plugins/MCP servers, use credentials, mutate sites, write Prisma data, enqueue work, change P7 scoring, or change P8 risk/approval/mutation/verification behavior.

The public contract is intentionally projection-only: callers receive first-party bounded method projections plus provenance, never the raw upstream Markdown body as executable instructions.

## Reviewed upstream sources

### Corey Haines marketing skills

- Repository: `coreyhaines31/marketingskills`
- Exact commit: `3df87f97621e18fbed7f6aa684edba54f49779a7`
- License: MIT
- Local source version: `1.0.0`
- Reviewed date: `2026-08-22`

Reviewed methods:

| Skill ID | Method key | Capability |
| --- | --- | --- |
| `corey.seo-audit` | `SEO_AUDIT` | `SEO_AUDIT_METHOD` |
| `corey.ai-seo` | `AI_SEO` | `AI_SEO_METHOD` |
| `corey.schema` | `SCHEMA` | `SCHEMA_METHOD` |
| `corey.programmatic-seo` | `PROGRAMMATIC_SEO` | `PROGRAMMATIC_SEO_METHOD` |
| `corey.site-architecture` | `SITE_ARCHITECTURE` | `SITE_ARCHITECTURE_METHOD` |
| `corey.content-strategy` | `CONTENT_STRATEGY` | `CONTENT_STRATEGY_METHOD` |
| `corey.analytics` | `ANALYTICS` | `ANALYTICS_METHOD` |
| `corey.ab-testing` | `EXPERIMENT_DESIGN` | `EXPERIMENT_METHOD` |

Only each reviewed `SKILL.md` entrypoint and the exact root MIT `LICENSE` are vendored. Referenced scripts, tools, connectors, hooks, packages, MCP configuration, and unrelated skills are not vendored.

### Aaron marketing skills

- Repository: `aaron-he-zhu/aaron-marketing-skills`
- Exact commit: `17296c71d1ff822975efb1ea28de52668c9c9022`
- License: Apache-2.0
- Root `NOTICE`: absent at the reviewed pin
- Local source version: `1.0.0`
- Reviewed date: `2026-08-22`

Reviewed methods:

| Skill ID | Method key | Capability |
| --- | --- | --- |
| `aaron.content-quality-auditor` | `CONTENT_QUALITY_AUDIT` | `CONTENT_QUALITY_METHOD` |
| `aaron.domain-authority-auditor` | `DOMAIN_TRUST_AUDIT` | `DOMAIN_TRUST_METHOD` |
| `aaron.technical-seo-checker` | `TECHNICAL_SEO_CHECK` | `TECHNICAL_SEO_METHOD` |
| `aaron.on-page-seo-checker` | `ON_PAGE_SEO_CHECK` | `ON_PAGE_SEO_METHOD` |
| `aaron.offsite-signal-analyzer` | `OFFSITE_SIGNAL_ANALYSIS` | `OFFSITE_SIGNAL_METHOD` |

Only the five reviewed `SKILL.md` entrypoints and exact root Apache-2.0 `LICENSE` are vendored. Python/Bash runtimes, scanners, connectors, hooks, registries, memory, commands, MCP configuration, and other mutation-capable tooling remain outside the trusted tree.

## Trust and integrity chain

The root is always supplied explicitly by first-party code. Environment variables cannot redirect it.

The integrity chain is:

1. `vendor/third-party-skills/registry.json` declares each approved source manifest and its SHA-256.
2. Each source `manifest.json` declares the exact upstream repository, exact 40-character commit pin, SPDX license, local version, reviewed date, legal-file hash, reviewed raw-file hashes, projection paths, and projection hashes.
3. Every raw upstream file is hashed over its exact committed bytes. No newline normalization is allowed.
4. Every bounded JSON projection is hashed over its exact committed bytes.
5. The source manifest itself is SHA-256 hashed and that value is stored in the top-level registry.
6. The loader verifies hashes, strict schemas, allowed paths/extensions, exact file census, source references, capabilities, identities, and duplicate constraints before exposing any method.

Any missing file, undeclared file, path escape, symlink, unsupported extension, malformed schema, license mismatch, identity mismatch, capability mismatch, duplicate identity, or SHA mismatch fails closed.

## Raw upstream vs bounded projection

Raw upstream Markdown is retained solely as reviewed provenance evidence. Runtime consumers do not receive it.

Each `ADVISORY_METHOD_PROJECTION_V1` contains only bounded first-party fields:

- purpose
- when-to-use conditions
- required inputs
- analysis/planning steps
- checks
- outputs
- evidence rules
- forbidden inferences
- exact source references

Every loaded method is stamped with `authority: ADVISORY_ONLY` by first-party code.

The projections retain these hard boundaries:

- observed evidence stays separate from recommendations and third-party guidance;
- missing observed data remains unknown and is never converted to zero, failure, or success;
- rankings, citations, traffic, conversions, backlinks, performance, and verification state may not be fabricated;
- advisory output cannot become P7 authoritative facts or deterministic scores;
- advisory output cannot become P8 risk, approval, mutation authority, or `VERIFIED` state;
- no credentials, commands, network calls, database mutation, publishing, deployment, merge, or other runtime actions are authorized.

Upstream CORE-EEAT/CITE or similar scoring/gating terminology is treated only as advisory method vocabulary. It never acquires first-party authority.

## Runtime non-execution boundary

First-party `src/modules/advisory-skills/*` is data-loading and validation code only. Boundary tests reject process execution, `eval`, runtime network clients, queue clients, Prisma access, environment-based vendor-root discovery, and plugin/MCP loaders.

The real vendor census rejects executable/script extensions. Command-like text that exists inside exact raw Markdown remains inert because raw Markdown is neither executed nor surfaced as an instruction API.

P7 scoring and P8 risk/approval/mutation/verification modules must remain independent from `advisory-skills` imports.

## Upgrade procedure

An upstream upgrade is a new supply-chain review, not an automatic update.

1. Choose a full exact upstream commit SHA; never use `main`, a branch, a tag, or a short SHA.
2. Re-review the exact license and `NOTICE` boundary.
3. Re-review only the intended raw entrypoints and stop if paths or legal terms changed unexpectedly.
4. Re-copy exact bytes without newline normalization.
5. Re-review bounded projections; do not inherit new upstream execution, credential, connector, mutation, scoring-authority, or verification instructions.
6. Recompute raw/legal/projection/manifest SHA-256 values.
7. Run focused schema/loader/registry/vendor/boundary tests, Typecheck, full Vitest, and Build.
8. Require exact-head `verify`, `production-audit`, and `e2e` success before release review.

There is intentionally no runtime network updater.

## P9-A handoff

P9-A may consume only the validated advisory registry contract and provenance. Packaging or later orchestration must preserve `ADVISORY_ONLY`, exact provenance, projection-only exposure, explicit-root loading, and the non-execution boundary. It must not reinterpret upstream method language as score, approval, verification, or mutation authority.

## Rollback

P9-0H has no Prisma schema change and no database migration. Rollback is additive and code-only: revert the P9-0H pull request and remove its vendored advisory assets/modules/tests/docs. No database rollback is required.

Merge, deployment, and rollback remain separate human-authorized actions; CI success alone does not authorize them.
