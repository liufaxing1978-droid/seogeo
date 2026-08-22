# P9-0H Third-party Skill Foundation Design

Date: 2026-08-22
Status: Approved in-chat design; written spec for review
Repository: `liufaxing1978-droid/seogeo`
Base: `main@dc44f665fb2b1233d5d599d2b76b5ab710af305a`

## 1. Purpose

P9-0H adds a controlled third-party SEO/GEO method library so later P9 planning can reuse mature external methods without transferring authority, credentials, or execution rights to third-party skills.

The chosen architecture is **Curated Vendored Method Snapshots**.

The core rule is:

> Borrow external methods, never external authority.

P9-0H is a supply-chain and advisory-method foundation. It is not a plugin runtime, agent host, remote skill installer, autonomous marketing system, or publication engine.

## 2. Hard boundaries

Third-party skills are advisory-only. They MUST NOT:

- own or read provider, Git, database, model, or deployment credentials;
- write to the database;
- enqueue jobs;
- call external networks at runtime;
- execute shell, Python, JavaScript, TypeScript, MCP, hooks, connectors, or upstream runtimes;
- alter P7 authoritative facts, Growth identities, deterministic scores, evidence quality, lifecycle, or UNKNOWN semantics;
- alter provider capability declarations;
- set or lower P8 risk classes;
- satisfy or waive approval requirements;
- create or replace a P8 `PublicationPlan`;
- execute Git mutation, merge, deployment, rollback, or real-site verification;
- mark any outcome VERIFIED;
- convert missing/unknown evidence to zero;
- treat model-generated or third-party-method output as authoritative observed evidence.

P9-0H itself does not call AI and does not connect to P7 or P8 runtime flows. Later P9-A may consume reviewed advisory projections only through the narrow public API defined here.

## 3. Upstream candidates and initial pins

The first reviewed upstream candidates are:

### 3.1 Corey Haines Marketing Skills

- repository: `coreyhaines31/marketingskills`
- candidate commit: `3df87f97621e18fbed7f6aa684edba54f49779a7`
- license observed at review: MIT
- initial selected methods:
  - `seo-audit`
  - `ai-seo`
  - `schema`
  - `programmatic-seo`
  - `site-architecture`
  - `content-strategy`
  - `analytics`
  - `ab-testing`

### 3.2 Aaron Marketing Skills

- repository: `aaron-he-zhu/aaron-marketing-skills`
- candidate commit: `17296c71d1ff822975efb1ea28de52668c9c9022`
- license observed at review: Apache-2.0
- the former `aaron-he-zhu/seo-geo-claude-skills` repository is a signpost and is not an active P9-0H source
- initial selected methods:
  - `seo-geo/tune/content-quality-auditor`
  - `seo-geo/evaluate/domain-authority-auditor`
  - `seo-geo/tune/technical-seo-checker`
  - `seo-geo/tune/on-page-seo-checker`
  - `seo-geo/evaluate/offsite-signal-analyzer`

The implementation MUST re-fetch and verify the exact pinned commits, selected paths, license text, and any upstream NOTICE file before vendoring. A missing path, changed license, or unavailable commit is a stop condition, not permission to silently switch to upstream `main`.

Volatile popularity metadata such as star count is review context only and MUST NOT become a runtime trust score or manifest field.

## 4. Repository layout

P9-0H introduces the following layout:

```text
vendor/third-party-skills/
  registry.json
  coreyhaines31-marketingskills/
    manifest.json
    LICENSE
    NOTICE                 # only when present/required upstream
    upstream/
      ... reviewed byte-for-byte upstream Markdown/JSON files ...
    projections/
      ... locally reviewed advisory method JSON ...
  aaron-marketing-skills/
    manifest.json
    LICENSE
    NOTICE                 # only when present/required upstream
    upstream/
      ... reviewed byte-for-byte upstream Markdown/JSON files ...
    projections/
      ... locally reviewed advisory method JSON ...

src/modules/advisory-skills/
  advisory-skill.types.ts
  advisory-skill.schemas.ts
  advisory-skill.policy.ts
  advisory-skill.loader.ts
  advisory-skill.registry.ts
```

There is no Prisma schema, migration, HTTP route, queue, worker, cron job, server boot hook, MCP registration, or runtime installer in P9-0H.

## 5. Raw upstream snapshot versus runtime projection

P9-0H stores two deliberately different representations.

### 5.1 Raw upstream snapshot

Selected upstream files under `upstream/` are byte-for-byte copies from the pinned commit. They exist for provenance, license compliance, human review, and future upgrade diffs.

Raw files MUST NOT be edited locally. If local explanation or policy is needed, it belongs in the projection or first-party documentation, never inside the copied upstream file.

Raw upstream content is **not part of the public runtime advisory API** and MUST NOT be concatenated directly into a model prompt by P9-A.

This prevents arbitrary third-party Markdown instructions such as tool calls, credential requests, mutation commands, connector setup, or prompt-like directives from becoming an unreviewed instruction channel.

For each selected skill, its reviewed upstream dependency closure contains the skill entrypoint plus only Markdown, JSON, or plain-text documentation that is necessary to understand the selected method. A reference from upstream Markdown to a script, connector, executable, MCP config, hook, binary, or unrelated skill does **not** authorize vendoring that referenced executable/runtime asset. Such a reference may remain visible in the byte-for-byte raw Markdown, but the referenced executable file is excluded.

### 5.2 Local advisory projection

Each selected skill has a locally reviewed JSON projection containing only the method information we explicitly choose to expose.

The V1 shape is conceptually:

```ts
interface AdvisoryMethodProjectionV1 {
  projectionVersion: 'ADVISORY_METHOD_PROJECTION_V1'
  skillId: string
  methodKey: AdvisoryMethodKey
  title: string
  purpose: string
  whenToUse: string[]
  requiredInputs: string[]
  steps: string[]
  checks: string[]
  outputs: string[]
  evidenceRules: string[]
  forbiddenInferences: string[]
  sourceRefs: Array<{
    upstreamPath: string
    upstreamSha256: string
  }>
}
```

The projection is first-party reviewed configuration derived from the vendored source. It may summarize or select upstream methods but MUST NOT introduce new claims of observed SEO/GEO facts.

The public loader returns projections, not raw upstream Markdown.

## 6. Registry and manifest contract

The top-level registry version is:

`THIRD_PARTY_ADVISORY_REGISTRY_V1`

It contains a deterministic list of source manifests:

```ts
interface AdvisoryRegistryV1 {
  version: 'THIRD_PARTY_ADVISORY_REGISTRY_V1'
  sources: Array<{
    sourceId: string
    manifestPath: string
    manifestSha256: string
  }>
}
```

Each source manifest records at least:

```ts
interface HashedLegalFile {
  path: string
  sha256: string
}

interface AdvisorySourceManifestV1 {
  manifestVersion: 'ADVISORY_SOURCE_MANIFEST_V1'
  sourceId: string
  sourceRepo: string
  upstreamCommit: string
  licenseSpdx: 'MIT' | 'Apache-2.0'
  licenseFile: HashedLegalFile
  noticeFile?: HashedLegalFile
  localVersion: string
  reviewedAt: string
  skills: Array<{
    skillId: string
    methodKey: AdvisoryMethodKey
    upstreamEntrypoint: string
    capabilities: AdvisoryCapability[]
    upstreamFiles: Array<{
      path: string
      sha256: string
      mediaType: 'text/markdown' | 'application/json' | 'text/plain'
    }>
    projectionPath: string
    projectionSha256: string
  }>
}
```

All SHA-256 values are lowercase hex digests of the exact committed bytes. No newline normalization or content rewriting occurs before hashing.

`upstreamCommit` MUST be a full 40-character Git commit SHA. Branch names, tags, shortened SHAs, or `latest` are invalid.

The legal files, every raw upstream file, and every projection are therefore all hash-bound. `manifest.json` itself is hash-bound by the top-level registry.

## 7. Stable local identity and deduplication

Every selected advisory method receives:

- a stable local `skillId`;
- a stable local `methodKey`;
- one or more advisory capability tags.

V1 enforces global uniqueness for both `skillId` and `methodKey` across the registry. This prevents two external sources from silently competing to own the same method slot.

Broad umbrella and narrow methods remain distinct. For example, `SEO_AUDIT` may coexist with `TECHNICAL_SEO_CHECK`, but two different sources cannot both register `TECHNICAL_SEO_CHECK` in V1.

Capabilities are discovery tags, not execution permissions. A capability match MUST NOT automatically cause every matching skill to run. Later P9-A policy will request explicit method keys or a bounded ordered set.

The initial 13 identities are fixed as follows:

| Upstream method | `skillId` | `methodKey` |
| --- | --- | --- |
| Corey `seo-audit` | `corey.seo-audit` | `SEO_AUDIT` |
| Corey `ai-seo` | `corey.ai-seo` | `AI_SEO` |
| Corey `schema` | `corey.schema` | `SCHEMA` |
| Corey `programmatic-seo` | `corey.programmatic-seo` | `PROGRAMMATIC_SEO` |
| Corey `site-architecture` | `corey.site-architecture` | `SITE_ARCHITECTURE` |
| Corey `content-strategy` | `corey.content-strategy` | `CONTENT_STRATEGY` |
| Corey `analytics` | `corey.analytics` | `ANALYTICS` |
| Corey `ab-testing` | `corey.ab-testing` | `EXPERIMENT_DESIGN` |
| Aaron `content-quality-auditor` | `aaron.content-quality-auditor` | `CONTENT_QUALITY_AUDIT` |
| Aaron `domain-authority-auditor` | `aaron.domain-authority-auditor` | `DOMAIN_TRUST_AUDIT` |
| Aaron `technical-seo-checker` | `aaron.technical-seo-checker` | `TECHNICAL_SEO_CHECK` |
| Aaron `on-page-seo-checker` | `aaron.on-page-seo-checker` | `ON_PAGE_SEO_CHECK` |
| Aaron `offsite-signal-analyzer` | `aaron.offsite-signal-analyzer` | `OFFSITE_SIGNAL_ANALYSIS` |

These method keys are local advisory identities, not upstream-defined authority labels.

## 8. Capability policy

V1 uses an explicit allowlist. The initial capability vocabulary is limited to advisory areas needed by the selected methods:

- `SEO_AUDIT_METHOD`
- `AI_SEO_METHOD`
- `SCHEMA_METHOD`
- `PROGRAMMATIC_SEO_METHOD`
- `SITE_ARCHITECTURE_METHOD`
- `CONTENT_STRATEGY_METHOD`
- `ANALYTICS_METHOD`
- `EXPERIMENT_METHOD`
- `CONTENT_QUALITY_METHOD`
- `DOMAIN_TRUST_METHOD`
- `TECHNICAL_SEO_METHOD`
- `ON_PAGE_SEO_METHOD`
- `OFFSITE_SIGNAL_METHOD`

Unknown capabilities fail validation. Adding a new capability is a first-party code review event, not something a third-party manifest can self-authorize.

All loaded methods are stamped by first-party code with:

`authority: 'ADVISORY_ONLY'`

The authority value is not read from the third-party manifest or projection.

## 9. Loader contract

The loader is an explicit-root, read-only library. It does not discover its root through environment variables and does not run at server startup.

Conceptually:

```ts
createAdvisorySkillRegistry({ rootDir })
```

The caller supplies the repository/runtime asset root explicitly.

The public result contains only reviewed data:

```ts
interface LoadedAdvisoryMethod {
  skillId: string
  methodKey: AdvisoryMethodKey
  authority: 'ADVISORY_ONLY'
  capabilities: AdvisoryCapability[]
  projection: AdvisoryMethodProjectionV1
  provenance: {
    sourceRepo: string
    upstreamCommit: string
    localVersion: string
    projectionSha256: string
    sourceFileHashes: string[]
  }
}
```

The loader MUST NOT expose a function that returns raw upstream file contents to normal P9 consumers.

## 10. Filesystem and integrity validation

Loading is fail-closed.

Before returning any method, the registry/loader validates:

1. top-level registry schema;
2. source manifest schema;
3. registry `manifestSha256` against exact manifest bytes;
4. source directory remains inside the configured vendor root;
5. every manifest path remains inside its source directory after normalization/realpath checks;
6. symlinks are rejected;
7. unsupported file types are rejected;
8. license SPDX is allowlisted;
9. required `licenseFile` exists and matches its SHA-256;
10. declared `noticeFile`, when present, exists and matches its SHA-256;
11. upstream commit is a full 40-character SHA;
12. every upstream file exists and matches SHA-256;
13. every projection exists and matches SHA-256;
14. each projection validates against `ADVISORY_METHOD_PROJECTION_V1`;
15. projection `skillId` and `methodKey` match the manifest;
16. every projection `sourceRef` is a non-empty subset of that skill's declared `upstreamFiles`, and every referenced path/hash pair matches exactly;
17. duplicate source IDs, skill IDs, or method keys fail;
18. unknown capabilities fail;
19. regular files under a source directory that are not declared as `licenseFile`, `noticeFile`, `upstreamFiles`, or `projectionPath`, excluding `manifest.json` itself, fail the file census;
20. top-level unexpected files/directories under `vendor/third-party-skills/` fail the registry census.

The purpose of the file census is to prevent an unnoticed `.sh`, `.py`, `.js`, executable payload, connector, or extra prompt file from being added beside reviewed assets.

## 11. Runtime sandbox and non-execution policy

The advisory module may use first-party Node filesystem/path/crypto primitives and Zod validation. It MUST NOT import or invoke:

- child-process APIs;
- shell runtimes;
- Python runtimes;
- dynamic JavaScript/TypeScript module loading from vendor paths;
- MCP/plugin loaders;
- connector frameworks;
- HTTP clients for upstream retrieval;
- Git clients;
- queue clients;
- Prisma/database clients;
- credential stores.

Vendored files are always data.

A string in an upstream file or projection that looks like a command, URL, API call, connector instruction, environment variable, or mutation request does not grant any capability.

P9-0H performs no network access at runtime. Upstream retrieval happens only during the reviewed development/vendor upgrade workflow.

## 12. License policy

The V1 runtime allowlist contains only the licenses reviewed for the initial sources:

- MIT
- Apache-2.0

The exact upstream `LICENSE` file is vendored and hash-bound. If Apache or another future source includes a required NOTICE file, it is preserved verbatim, declared in the manifest, and hash-bound.

A future license addition requires an explicit code/spec review. The system MUST NOT treat an unknown or missing license as permissive.

License metadata is provenance, not a quality score.

## 13. Upgrade workflow

Runtime updates are forbidden. The system MUST NOT use `git pull`, `npx skills add`, submodule auto-update, package-manager latest resolution, or GitHub/network fetches to refresh advisory skills.

Every upgrade is an ordinary reviewed repository change:

```text
select exact upstream commit
→ verify source + license/NOTICE
→ diff old pin against new pin
→ review selected method changes
→ update byte-for-byte raw snapshots
→ update/review local projections
→ recompute SHA-256 values
→ bump localVersion
→ run integrity/safety tests
→ open PR
→ exact-head verify / production-audit / e2e
→ human merge
```

If a newer upstream commit contains unrelated runtime, connector, hook, or automation changes, those changes are not vendored unless they are reviewed Markdown/JSON/plain-text documentation dependencies required for a selected advisory method. Executable upstream runtime remains excluded even when referenced by selected Markdown.

## 14. Relationship to P9-A

P9-0H does not implement the Optimization Planner.

Later P9-A may use the registry through a bounded read interface such as:

```ts
registry.getByMethodKeys([...])
registry.listByCapabilities([...])
```

P9-A will combine:

- authoritative P7 opportunities and score references;
- unified provider evidence and provenance;
- first-party deterministic eligibility/risk policy;
- selected advisory projections;
- optional bounded AI explanation/ordering.

Advisory methods can explain or suggest optimization techniques. They cannot supply authoritative observations or override deterministic policy.

When an `OptimizationPlan` uses an advisory method, the plan should later persist at least:

- `skillId`;
- `methodKey`;
- `sourceRepo`;
- `upstreamCommit`;
- `localVersion`;
- `projectionSha256`.

That P9-A provenance is outside P9-0H implementation scope.

## 15. Build and deployment boundary

The current application build is TypeScript compilation. P9-0H MUST NOT change the build command merely to activate advisory methods.

The loader therefore requires an explicit `rootDir` and has no automatic server boot integration.

P9-A production integration MUST NOT be enabled until the deployment artifact is proven to include the reviewed `vendor/third-party-skills/` tree and the exact registry hashes. That packaging check belongs to the integration phase where the runtime consumer is introduced.

This keeps P9-0H usable in tests and development without creating a hidden deployment-path assumption.

## 16. Error handling

Integrity or policy violations use stable first-party error codes. V1 error codes are:

- `ADVISORY_REGISTRY_INVALID`
- `ADVISORY_MANIFEST_INVALID`
- `ADVISORY_PATH_ESCAPE`
- `ADVISORY_SYMLINK_REJECTED`
- `ADVISORY_FILE_UNDECLARED`
- `ADVISORY_FILE_TYPE_REJECTED`
- `ADVISORY_HASH_MISMATCH`
- `ADVISORY_LICENSE_REJECTED`
- `ADVISORY_DUPLICATE_ID`
- `ADVISORY_DUPLICATE_METHOD_KEY`
- `ADVISORY_CAPABILITY_REJECTED`
- `ADVISORY_PROJECTION_INVALID`

Errors are deterministic and contain local identifiers/paths useful for diagnosis but MUST NOT contain credentials or unrelated environment data.

There is no fallback to unverified content and no runtime upstream fetch on failure.

## 17. Testing strategy

P9-0H uses TDD and must cover positive and negative supply-chain behavior.

### Registry/schema

- valid registry loads deterministically;
- unknown registry/manifest/projection versions fail;
- duplicate source ID fails;
- duplicate skill ID fails;
- duplicate method key fails;
- unknown capability fails;
- invalid/non-40-character upstream SHA fails.

### Integrity/filesystem

- valid hashes load;
- changed Markdown fails hash validation;
- changed projection fails hash validation;
- changed manifest fails top-level registry hash validation;
- changed LICENSE/NOTICE fails hash validation;
- path traversal fails;
- symlink fails;
- missing declared file fails;
- undeclared extra file fails;
- executable/script extension fails;
- unknown/missing license fails.

### Advisory boundary

- public API returns reviewed projection but not raw upstream Markdown;
- loaded authority is always first-party `ADVISORY_ONLY`;
- manifest/projection cannot self-elevate authority;
- projection missing required evidence rules or forbidden-inference fields fails schema validation;
- projection source refs must resolve to declared matching raw hashes;
- capabilities are tags only and do not invoke work;
- loader does not mutate P7/P8 state;
- loader has no Prisma, queue, Git, MCP, child-process, or HTTP dependency;
- changing environment variables does not change registry resolution because `rootDir` is explicit.

### Regression

- existing Growth score/evidence tests remain unchanged and green;
- existing P8 risk/approval/mutation/verification tests remain unchanged and green;
- full project test suite remains green.

### Final exact-head CI

The final PR head must pass:

- `verify`
- `production-audit`
- `e2e`

before Ready-for-review status. P9 merge still requires separate explicit human authorization.

## 18. Data model impact

P9-0H adds no Prisma entities and no migrations.

Git-tracked manifests, raw snapshots, projections, hashes, and commit history are the authoritative supply-chain audit trail for this foundation.

Runtime use provenance will be persisted later by P9-A on the OptimizationPlan or equivalent planning record.

## 19. Non-goals

P9-0H does not:

- install all skills from either upstream repository;
- import marketing disciplines unrelated to SEO/GEO;
- run upstream commands, hooks, bots, connectors, registries, memory systems, or automation frameworks;
- fetch skills dynamically;
- score upstream repositories by stars;
- create an admin marketplace UI;
- add project-level skill enable/disable persistence;
- execute SEO changes;
- change P7 scoring;
- change P8 safety policy;
- implement P9-A planning.

## 20. Acceptance criteria

P9-0H is complete when:

1. the two approved upstream sources are pinned to exact reviewed commits;
2. only the approved initial SEO/GEO method set and required non-executable documentation dependencies are vendored;
3. exact licenses/NOTICE obligations are preserved and hash-bound;
4. raw upstream snapshots are hash-bound and never exposed through the normal runtime advisory API;
5. locally reviewed advisory projections are hash-bound, schema-valid, and `ADVISORY_ONLY`;
6. registry and source manifests fail closed on tampering, path escape, symlinks, undeclared files, unsupported file types, unknown licenses, unknown capabilities, or duplicates;
7. no runtime network, credential, database, queue, Git, MCP, or process-execution path exists in the advisory module;
8. no Prisma migration or P7/P8 authority change is introduced;
9. all focused tests and the full repository test suite pass;
10. exact final head passes `verify`, `production-audit`, and `e2e`;
11. the PR remains unmerged until separate explicit human authorization.
