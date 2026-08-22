# P9-0H Third-party Skill Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed, read-only advisory-skill supply-chain foundation that vendors 13 reviewed SEO/GEO methods at exact upstream commits and exposes only first-party reviewed projections, never executable third-party runtime or authoritative SEO/GEO facts.

**Architecture:** Git-tracked vendored snapshots live under `vendor/third-party-skills/`. A small TypeScript module validates registry/manifests, paths, legal files, file census, SHA-256 integrity, capabilities, projections, and stable IDs before exposing `ADVISORY_ONLY` projections through an explicit-root registry API. Raw upstream Markdown remains auditable data but is never returned by the public API; P9-0H has no Prisma, queue, network, Git, MCP, process-execution, server-boot, or AI integration.

**Tech Stack:** Node.js 22, TypeScript 5.9, Zod 3, Node `fs/promises` / `path` / `crypto`, Vitest 3, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-22-p9-0h-third-party-skill-foundation-design.md`

## Global Constraints

- Base branch is `main`; implementation branch is `feat/p9-0h-third-party-skill-foundation`.
- Do not write directly to `main`.
- Third-party content is advisory-only and cannot own credentials, facts, scores, risk, approvals, P8 plans, mutation, merge, deploy, rollback, or VERIFIED semantics.
- No Prisma schema or migration in P9-0H.
- No HTTP route, queue, worker, cron, server boot hook, MCP registration, dynamic plugin loader, runtime updater, or AI call.
- Runtime loader performs no network access and accepts an explicit `rootDir`; it never resolves vendor roots from environment variables.
- Vendored raw files are data only. Never import, execute, spawn, source, eval, dynamically load, or expose them through the normal public API.
- Only `MIT` and `Apache-2.0` are valid V1 licenses.
- Upstream commits must be full 40-character SHAs.
- Corey pin: `coreyhaines31/marketingskills@3df87f97621e18fbed7f6aa684edba54f49779a7`.
- Aaron pin: `aaron-he-zhu/aaron-marketing-skills@17296c71d1ff822975efb1ea28de52668c9c9022`.
- Corey legal file: exact pinned `LICENSE`, SPDX `MIT`.
- Aaron legal file: exact pinned `LICENSE`, SPDX `Apache-2.0`; the pinned repository has no root `NOTICE`, so V1 manifest omits `noticeFile`.
- Raw SHA-256 values are lowercase hex over exact committed bytes with no newline normalization.
- Final exact PR head must pass `verify`, `production-audit`, and `e2e`; do not merge without a separate explicit human `合并` instruction.

## File Structure

Create these first-party code files:

- `src/modules/advisory-skills/advisory-skill.types.ts` — stable V1 type vocabulary and public result types.
- `src/modules/advisory-skills/advisory-skill.schemas.ts` — strict Zod schemas for registry, source manifest, and projection.
- `src/modules/advisory-skills/advisory-skill.policy.ts` — first-party allowlists, stable method identities/capabilities, and deterministic error type/codes.
- `src/modules/advisory-skills/advisory-skill.loader.ts` — filesystem/path/hash/legal/census validation and source loading.
- `src/modules/advisory-skills/advisory-skill.registry.ts` — explicit-root public read API returning only reviewed projections.

Create focused tests:

- `tests/unit/advisory-skill.schemas.test.ts`
- `tests/unit/advisory-skill.loader.test.ts`
- `tests/unit/advisory-skill.registry.test.ts`
- `tests/unit/advisory-skill.boundary.test.ts`
- `tests/integration/advisory-skill.vendor.test.ts`

Create vendored assets:

- `vendor/third-party-skills/registry.json`
- `vendor/third-party-skills/coreyhaines31-marketingskills/manifest.json`
- `vendor/third-party-skills/coreyhaines31-marketingskills/LICENSE`
- `vendor/third-party-skills/coreyhaines31-marketingskills/upstream/skills/<selected>/SKILL.md`
- `vendor/third-party-skills/coreyhaines31-marketingskills/projections/<methodKey>.json`
- `vendor/third-party-skills/aaron-marketing-skills/manifest.json`
- `vendor/third-party-skills/aaron-marketing-skills/LICENSE`
- `vendor/third-party-skills/aaron-marketing-skills/upstream/seo-geo/.../SKILL.md`
- `vendor/third-party-skills/aaron-marketing-skills/projections/<methodKey>.json`

No other executable or runtime files are allowed under `vendor/third-party-skills/`.

---

### Task 1: Lock the V1 type, schema, identity, and policy contract

**Files:**
- Create: `src/modules/advisory-skills/advisory-skill.types.ts`
- Create: `src/modules/advisory-skills/advisory-skill.schemas.ts`
- Create: `src/modules/advisory-skills/advisory-skill.policy.ts`
- Test: `tests/unit/advisory-skill.schemas.test.ts`

**Interfaces:**
- Produces `AdvisoryMethodKey`, `AdvisoryCapability`, `AdvisoryRegistryV1`, `AdvisorySourceManifestV1`, `AdvisoryMethodProjectionV1`, `LoadedAdvisoryMethod`, `AdvisorySkillError`, `ADVISORY_METHOD_IDENTITIES`, and strict Zod schemas used by later tasks.
- No filesystem or vendor data is consumed yet.

- [ ] **Step 1: Write the failing schema/policy tests**

Create tests that import the not-yet-created module and require:

```ts
import { describe, expect, it } from 'vitest'
import {
  advisoryMethodProjectionSchema,
  advisoryRegistrySchema,
  advisorySourceManifestSchema,
} from '../../src/modules/advisory-skills/advisory-skill.schemas.js'
import {
  ADVISORY_METHOD_IDENTITIES,
  ADVISORY_CAPABILITIES,
} from '../../src/modules/advisory-skills/advisory-skill.policy.js'

it('locks exactly 13 unique V1 method identities', () => {
  expect(ADVISORY_METHOD_IDENTITIES).toHaveLength(13)
  expect(new Set(ADVISORY_METHOD_IDENTITIES.map((x) => x.skillId)).size).toBe(13)
  expect(new Set(ADVISORY_METHOD_IDENTITIES.map((x) => x.methodKey)).size).toBe(13)
})

it('rejects short or symbolic upstream refs', () => {
  const result = advisorySourceManifestSchema.safeParse({
    manifestVersion: 'ADVISORY_SOURCE_MANIFEST_V1',
    sourceId: 'x',
    sourceRepo: 'owner/repo',
    upstreamCommit: 'main',
    licenseSpdx: 'MIT',
    licenseFile: { path: 'LICENSE', sha256: 'a'.repeat(64) },
    localVersion: '1.0.0',
    reviewedAt: '2026-08-22',
    skills: [],
  })
  expect(result.success).toBe(false)
})

it('rejects authority fields supplied by vendor data', () => {
  const candidate = validProjectionFixture()
  expect(advisoryMethodProjectionSchema.safeParse({ ...candidate, authority: 'AUTHORITATIVE' }).success).toBe(false)
})
```

Also cover: unknown registry/manifest/projection versions, unknown capability, unknown license, malformed lowercase SHA-256, empty `sourceRefs`, and missing `evidenceRules` / `forbiddenInferences`.

- [ ] **Step 2: Run RED**

Run:

```bash
npx vitest run tests/unit/advisory-skill.schemas.test.ts
```

Expected: FAIL at TypeScript/module resolution because `src/modules/advisory-skills/*` does not yet exist. Commit this test-only RED before production code.

- [ ] **Step 3: Implement minimal V1 types/policy/schemas**

Define the exact method-key union:

```ts
export const ADVISORY_METHOD_KEYS = [
  'SEO_AUDIT',
  'AI_SEO',
  'SCHEMA',
  'PROGRAMMATIC_SEO',
  'SITE_ARCHITECTURE',
  'CONTENT_STRATEGY',
  'ANALYTICS',
  'EXPERIMENT_DESIGN',
  'CONTENT_QUALITY_AUDIT',
  'DOMAIN_TRUST_AUDIT',
  'TECHNICAL_SEO_CHECK',
  'ON_PAGE_SEO_CHECK',
  'OFFSITE_SIGNAL_ANALYSIS',
] as const
```

Define the exact capability union:

```ts
export const ADVISORY_CAPABILITIES = [
  'SEO_AUDIT_METHOD',
  'AI_SEO_METHOD',
  'SCHEMA_METHOD',
  'PROGRAMMATIC_SEO_METHOD',
  'SITE_ARCHITECTURE_METHOD',
  'CONTENT_STRATEGY_METHOD',
  'ANALYTICS_METHOD',
  'EXPERIMENT_METHOD',
  'CONTENT_QUALITY_METHOD',
  'DOMAIN_TRUST_METHOD',
  'TECHNICAL_SEO_METHOD',
  'ON_PAGE_SEO_METHOD',
  'OFFSITE_SIGNAL_METHOD',
] as const
```

Define exactly these stable identity tuples:

```ts
export const ADVISORY_METHOD_IDENTITIES = [
  ['corey.seo-audit', 'SEO_AUDIT', 'SEO_AUDIT_METHOD'],
  ['corey.ai-seo', 'AI_SEO', 'AI_SEO_METHOD'],
  ['corey.schema', 'SCHEMA', 'SCHEMA_METHOD'],
  ['corey.programmatic-seo', 'PROGRAMMATIC_SEO', 'PROGRAMMATIC_SEO_METHOD'],
  ['corey.site-architecture', 'SITE_ARCHITECTURE', 'SITE_ARCHITECTURE_METHOD'],
  ['corey.content-strategy', 'CONTENT_STRATEGY', 'CONTENT_STRATEGY_METHOD'],
  ['corey.analytics', 'ANALYTICS', 'ANALYTICS_METHOD'],
  ['corey.ab-testing', 'EXPERIMENT_DESIGN', 'EXPERIMENT_METHOD'],
  ['aaron.content-quality-auditor', 'CONTENT_QUALITY_AUDIT', 'CONTENT_QUALITY_METHOD'],
  ['aaron.domain-authority-auditor', 'DOMAIN_TRUST_AUDIT', 'DOMAIN_TRUST_METHOD'],
  ['aaron.technical-seo-checker', 'TECHNICAL_SEO_CHECK', 'TECHNICAL_SEO_METHOD'],
  ['aaron.on-page-seo-checker', 'ON_PAGE_SEO_CHECK', 'ON_PAGE_SEO_METHOD'],
  ['aaron.offsite-signal-analyzer', 'OFFSITE_SIGNAL_ANALYSIS', 'OFFSITE_SIGNAL_METHOD'],
] as const
```

Use `z.object(...).strict()` throughout. `upstreamCommit` must match `/^[0-9a-f]{40}$/`; SHA-256 must match `/^[0-9a-f]{64}$/`; `licenseSpdx` is exactly `MIT | Apache-2.0`; arrays used for method content are non-empty. Vendor-controlled schemas must contain no authority, execution, credential, network, Git, risk, approval, or VERIFIED field.

Implement deterministic first-party error codes from the spec in `AdvisorySkillError`.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run tests/unit/advisory-skill.schemas.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Commit production + test together with a focused message such as `feat: add advisory skill V1 contracts`.

---

### Task 2: Implement fail-closed filesystem, integrity, legal, and census validation

**Files:**
- Create: `src/modules/advisory-skills/advisory-skill.loader.ts`
- Test: `tests/unit/advisory-skill.loader.test.ts`

**Interfaces:**
- Consumes Task 1 schemas/policy/error type.
- Produces:

```ts
export async function loadAdvisorySources(rootDir: string): Promise<LoadedAdvisorySource[]>
```

`LoadedAdvisorySource` is internal and contains validated manifest metadata plus parsed projections; it must not contain raw upstream file body strings.

- [ ] **Step 1: Write fixture-based failing tests**

Each test creates a temporary vendor tree using Node `mkdtemp`, writes exact fixture bytes, calculates hashes with the same Node `createHash('sha256')` primitive in test helpers, and then mutates one property at a time.

Required RED cases:

```ts
it('loads a valid hash-bound source tree')
it('fails when registry manifest hash is changed')
it('fails when raw markdown bytes change')
it('fails when projection bytes change')
it('fails when LICENSE bytes change')
it('fails path traversal through manifestPath')
it('fails path traversal through upstream/projection/legal paths')
it('rejects any symlink inside the vendor root')
it('fails on undeclared files under a source directory')
it('fails on unexpected top-level files or directories')
it('rejects .sh, .py, .js, .ts, executable or binary vendor payloads')
it('fails when a declared file is missing')
it('fails duplicate source, skill, or method identities')
it('fails projection sourceRefs that are not a subset of declared upstreamFiles')
```

For path tests use both `../escape.md` and absolute paths. For symlink tests skip only when the host OS explicitly cannot create symlinks; CI on Ubuntu must execute the assertion.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/unit/advisory-skill.loader.test.ts
```

Expected: FAIL because `loadAdvisorySources` does not exist.

- [ ] **Step 3: Implement minimal loader helpers**

Keep helpers private in `advisory-skill.loader.ts`:

```ts
async function readRegularFileInside(baseDir: string, relativePath: string): Promise<Buffer>
function sha256(bytes: Buffer): string
async function assertNoSymlinks(rootDir: string): Promise<void>
async function assertSourceFileCensus(sourceDir: string, declared: Set<string>): Promise<void>
async function assertRootCensus(rootDir: string, declaredSourceDirs: Set<string>): Promise<void>
```

Rules:

- Use `path.resolve` and `realpath`; resolved target must equal base or begin with `${base}${path.sep}`.
- Reject absolute paths and empty path segments before reading.
- `lstat` every traversed file/directory; reject symbolic links.
- Allowed vendored data extensions are `.md`, `.json`, `.txt`, plus extensionless `LICENSE` / `NOTICE` only when declared as legal files.
- Read `registry.json` and each `manifest.json` as exact bytes, hash before JSON parsing, then validate parsed JSON with Task 1 strict schemas.
- Verify legal, upstream, and projection hashes before parsing projections.
- File census is exact: no undeclared regular file; no unregistered source directory; only `registry.json` plus declared source directories at top level.
- Do not import Prisma, BullMQ, HTTP clients, child-process, Git, MCP, or dynamic module loaders.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run tests/unit/advisory-skill.loader.test.ts tests/unit/advisory-skill.schemas.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Commit as `feat: validate advisory skill supply chain`.

---

### Task 3: Add the projection-only public registry API

**Files:**
- Create: `src/modules/advisory-skills/advisory-skill.registry.ts`
- Modify only if needed for exported result types: `src/modules/advisory-skills/advisory-skill.types.ts`
- Test: `tests/unit/advisory-skill.registry.test.ts`

**Interfaces:**
- Consumes `loadAdvisorySources(rootDir)`.
- Produces:

```ts
export async function createAdvisorySkillRegistry(options: {
  rootDir: string
}): Promise<AdvisorySkillRegistry>

export interface AdvisorySkillRegistry {
  getByMethodKeys(keys: readonly AdvisoryMethodKey[]): LoadedAdvisoryMethod[]
  listByCapabilities(capabilities: readonly AdvisoryCapability[]): LoadedAdvisoryMethod[]
  listAll(): LoadedAdvisoryMethod[]
}
```

- [ ] **Step 1: Write failing public-API tests**

Require:

```ts
const registry = await createAdvisorySkillRegistry({ rootDir })
const method = registry.getByMethodKeys(['SEO_AUDIT'])[0]
expect(method.authority).toBe('ADVISORY_ONLY')
expect(method.projection.methodKey).toBe('SEO_AUDIT')
expect(method.provenance).toMatchObject({
  sourceRepo: 'owner/repo',
  upstreamCommit: 'a'.repeat(40),
  localVersion: '1.0.0',
})
expect(JSON.stringify(method)).not.toContain('raw upstream body sentinel')
```

Also require deterministic order independent of registry/source declaration order, deduped query inputs, unknown requested keys producing an empty subset rather than implicit fallback, capability lookup returning matching methods once each, and caller mutation not mutating registry internal state (return frozen or defensive copies).

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/unit/advisory-skill.registry.test.ts
```

Expected: FAIL because public registry does not exist.

- [ ] **Step 3: Implement minimal public registry**

- Flatten validated source projections into `LoadedAdvisoryMethod`.
- Stamp `authority: 'ADVISORY_ONLY'` in first-party code only.
- Provenance contains `sourceRepo`, `upstreamCommit`, `localVersion`, `projectionSha256`, and sorted unique source-file hashes.
- Sort all public results by `methodKey`, then `skillId`.
- Do not return raw file paths as readable handles and do not export a raw-file reader.
- Do not use environment variables to resolve root.

- [ ] **Step 4: Run GREEN**

```bash
npx vitest run tests/unit/advisory-skill.registry.test.ts tests/unit/advisory-skill.loader.test.ts tests/unit/advisory-skill.schemas.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Commit as `feat: add advisory skill registry`.

---

### Task 4: Vendor and project the eight Corey SEO/GEO methods

**Files:**
- Create: `vendor/third-party-skills/coreyhaines31-marketingskills/LICENSE`
- Create: `vendor/third-party-skills/coreyhaines31-marketingskills/upstream/skills/seo-audit/SKILL.md`
- Create: `vendor/third-party-skills/coreyhaines31-marketingskills/upstream/skills/ai-seo/SKILL.md`
- Create: `vendor/third-party-skills/coreyhaines31-marketingskills/upstream/skills/schema/SKILL.md`
- Create: `vendor/third-party-skills/coreyhaines31-marketingskills/upstream/skills/programmatic-seo/SKILL.md`
- Create: `vendor/third-party-skills/coreyhaines31-marketingskills/upstream/skills/site-architecture/SKILL.md`
- Create: `vendor/third-party-skills/coreyhaines31-marketingskills/upstream/skills/content-strategy/SKILL.md`
- Create: `vendor/third-party-skills/coreyhaines31-marketingskills/upstream/skills/analytics/SKILL.md`
- Create: `vendor/third-party-skills/coreyhaines31-marketingskills/upstream/skills/ab-testing/SKILL.md`
- Create: eight corresponding projection JSON files named by method key.
- Create: `vendor/third-party-skills/coreyhaines31-marketingskills/manifest.json`
- Create initially/modify later: `vendor/third-party-skills/registry.json`
- Test: `tests/integration/advisory-skill.vendor.test.ts`

**Interfaces:**
- Consumes Task 3 public registry.
- Produces eight real loaded methods from exact Corey pin.

- [ ] **Step 1: Re-verify exact upstream pin before writing bytes**

Fetch exact commit `3df87f97621e18fbed7f6aa684edba54f49779a7`, root `LICENSE`, and each exact `skills/<name>/SKILL.md` path listed above. Stop if any path is absent or if license is no longer the exact pinned MIT text. Never substitute `main`, a tag, a short SHA, or a renamed skill automatically.

- [ ] **Step 2: Write a test-only RED for the real vendor registry**

```ts
const rootDir = path.resolve('vendor/third-party-skills')
const registry = await createAdvisorySkillRegistry({ rootDir })
const corey = registry.listAll().filter((x) => x.skillId.startsWith('corey.'))
expect(corey.map((x) => x.methodKey)).toEqual([
  'AI_SEO', 'ANALYTICS', 'CONTENT_STRATEGY', 'EXPERIMENT_DESIGN',
  'PROGRAMMATIC_SEO', 'SCHEMA', 'SEO_AUDIT', 'SITE_ARCHITECTURE',
].sort())
expect(corey.every((x) => x.authority === 'ADVISORY_ONLY')).toBe(true)
expect(corey.every((x) => x.provenance.upstreamCommit === '3df87f97621e18fbed7f6aa684edba54f49779a7')).toBe(true)
```

RED must fail because vendor registry/assets are absent, not because of a TypeScript fixture error.

- [ ] **Step 3: Vendor exact bytes and create first-party projections**

Copy only the eight selected `SKILL.md` entrypoints and exact MIT `LICENSE`; do not vendor scripts, connectors, package files, hooks, MCP configs, or unrelated skills even if Markdown references them.

For each projection use `ADVISORY_METHOD_PROJECTION_V1` and the fixed Task 1 identity. Projection content must be a bounded, first-party reviewed method summary. Each projection must:

- describe when the method is useful;
- list the minimum inputs it expects;
- list bounded analysis/planning steps rather than executable shell/API commands;
- separate checks from outputs;
- explicitly state evidence rules such as “missing observed data remains unknown”;
- explicitly state forbidden inferences, including no fabricated rank/citation/traffic/performance claims;
- reference only its exact vendored `SKILL.md` hash.

Do not copy upstream prompt-routing instructions, connector setup, autonomous execution language, credential instructions, or shell commands into projections.

- [ ] **Step 4: Build Corey manifest and registry hashes**

Use localVersion `1.0.0`, reviewedAt `2026-08-22`, source ID `coreyhaines31-marketingskills`, sourceRepo `coreyhaines31/marketingskills`, exact pin, SPDX `MIT`, hash-bound license, eight exact upstream files, eight projection hashes, and exact fixed capabilities.

Compute manifest SHA-256 over exact committed manifest bytes and store it in top-level `registry.json` with version `THIRD_PARTY_ADVISORY_REGISTRY_V1`.

- [ ] **Step 5: Run GREEN**

```bash
npx vitest run tests/integration/advisory-skill.vendor.test.ts tests/unit/advisory-skill.*.test.ts
npm run typecheck
```

Expected: PASS for the eight Corey methods.

- [ ] **Step 6: Commit**

Commit as `feat: vendor reviewed Corey SEO methods`.

---

### Task 5: Vendor and project the five Aaron complementary SEO/GEO methods

**Files:**
- Create: `vendor/third-party-skills/aaron-marketing-skills/LICENSE`
- Create exact raw entrypoints:
  - `vendor/third-party-skills/aaron-marketing-skills/upstream/seo-geo/tune/content-quality-auditor/SKILL.md`
  - `vendor/third-party-skills/aaron-marketing-skills/upstream/seo-geo/evaluate/domain-authority-auditor/SKILL.md`
  - `vendor/third-party-skills/aaron-marketing-skills/upstream/seo-geo/tune/technical-seo-checker/SKILL.md`
  - `vendor/third-party-skills/aaron-marketing-skills/upstream/seo-geo/tune/on-page-seo-checker/SKILL.md`
  - `vendor/third-party-skills/aaron-marketing-skills/upstream/seo-geo/evaluate/offsite-signal-analyzer/SKILL.md`
- Create five corresponding projection JSON files.
- Create: `vendor/third-party-skills/aaron-marketing-skills/manifest.json`
- Modify: `vendor/third-party-skills/registry.json`
- Modify: `tests/integration/advisory-skill.vendor.test.ts`

**Interfaces:**
- Adds five complementary methods; public registry total becomes exactly 13.

- [ ] **Step 1: Re-verify exact Aaron pin and legal boundary**

Fetch commit `17296c71d1ff822975efb1ea28de52668c9c9022`, exact root `LICENSE`, and all five exact entrypoints above. Verify SPDX remains Apache-2.0 and confirm root `NOTICE` is absent at that pin. Stop on any mismatch; do not substitute the current branch head.

- [ ] **Step 2: Write test-only RED for 13-method real registry**

Extend integration expectations:

```ts
const all = registry.listAll()
expect(all).toHaveLength(13)
expect(all.filter((x) => x.skillId.startsWith('aaron.')).map((x) => x.methodKey)).toEqual([
  'CONTENT_QUALITY_AUDIT',
  'DOMAIN_TRUST_AUDIT',
  'OFFSITE_SIGNAL_ANALYSIS',
  'ON_PAGE_SEO_CHECK',
  'TECHNICAL_SEO_CHECK',
].sort())
expect(all.every((x) => x.authority === 'ADVISORY_ONLY')).toBe(true)
```

Also assert Aaron methods carry exact upstream commit `17296c71d1ff822975efb1ea28de52668c9c9022` and Apache-2.0 source metadata is validated by the manifest loader.

- [ ] **Step 3: Vendor exact bytes and create bounded projections**

Copy only the five selected `SKILL.md` files and exact Apache license. Do not vendor Aaron’s Python/Bash runtimes, connectors, hooks, registries, memory systems, MCP configs, commands, or mutation-class `indexpush` tooling.

Projection rules are identical to Task 4. In particular:

- CORE-EEAT / CITE names may appear as advisory frameworks but their upstream numeric/gate output never becomes P7 score, P8 risk, approval, or VERIFIED state.
- `offsite-signal-analyzer` may describe using observed first-party inputs but cannot infer backlinks, AI referral traffic, or citation status when those inputs are missing.
- technical/on-page methods cannot mutate pages or call scanners/connectors in 0H.

- [ ] **Step 4: Build Aaron manifest and update top-level registry**

Use source ID `aaron-marketing-skills`, localVersion `1.0.0`, reviewedAt `2026-08-22`, exact pin, SPDX `Apache-2.0`, no `noticeFile`, five stable identities, exact content/projection hashes, and updated hash-bound source manifest entry in `registry.json`.

- [ ] **Step 5: Run GREEN**

```bash
npx vitest run tests/integration/advisory-skill.vendor.test.ts tests/unit/advisory-skill.*.test.ts
npm run typecheck
```

Expected: exactly 13 methods load and all focused tests pass.

- [ ] **Step 6: Commit**

Commit as `feat: vendor reviewed Aaron SEO methods`.

---

### Task 6: Prove non-execution and authority isolation against the real codebase

**Files:**
- Create: `tests/unit/advisory-skill.boundary.test.ts`
- Modify only if a genuine boundary bug is exposed: `src/modules/advisory-skills/*`

**Interfaces:**
- Verifies architecture rather than adding a new runtime feature.

- [ ] **Step 1: Write boundary tests before any fix**

Use source inspection and behavior tests to prove:

```ts
it('advisory module has no forbidden runtime imports')
it('public loaded methods contain projection data but no raw upstream body')
it('environment changes cannot redirect rootDir')
it('vendor strings resembling shell/API/credential instructions remain inert data')
it('vendor tree contains no executable/script extensions')
it('P7 score modules do not import advisory-skills')
it('P8 publication risk/approval/mutation modules do not import advisory-skills')
```

The forbidden import/source patterns must include `child_process`, `eval(`, `Function(`, `import(` from vendor paths, `fetch(`, `axios`, `undici`, `ioredis`, `bullmq`, `@prisma/client`, GitHub mutation clients, MCP/plugin runtime imports, and environment-based root discovery in the advisory module.

Do not assert that generic strings can never occur in raw vendored Markdown; the rule is that first-party module code cannot execute/import those capabilities and public projections cannot expose raw bodies.

- [ ] **Step 2: Run tests**

```bash
npx vitest run tests/unit/advisory-skill.boundary.test.ts
```

If they pass immediately, Task 6 is a regression gate and needs no production commit. If any assertion fails, treat it as a real RED, identify the exact boundary leak, make the smallest first-party fix, and rerun.

- [ ] **Step 3: Run focused full 0H suite**

```bash
npx vitest run tests/unit/advisory-skill.schemas.test.ts tests/unit/advisory-skill.loader.test.ts tests/unit/advisory-skill.registry.test.ts tests/unit/advisory-skill.boundary.test.ts tests/integration/advisory-skill.vendor.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit test/fix if changed**

Commit boundary-only changes as `test: lock advisory skill safety boundaries` or, if a production fix was required, a narrowly named `fix:` commit.

---

### Task 7: Documentation, full regression, PR review, and exact-head release gate

**Files:**
- Create: `docs/development/p9-0h-third-party-skill-foundation.md`
- Do not modify scoring/risk/schema files unless a separately proven regression requires it.

**Interfaces:**
- Produces operator/developer documentation and release evidence only.

- [ ] **Step 1: Write development documentation**

Document:

- the two exact pins and licenses;
- the 13 fixed local identities;
- raw snapshot vs first-party projection distinction;
- explicit-root loader usage;
- why raw Markdown is not public runtime content;
- integrity chain: legal/raw/projection → manifest → registry;
- file census/path/symlink rules;
- no runtime network/credentials/DB/queue/Git/MCP/process execution;
- upgrade procedure and stop conditions;
- P9-A packaging/provenance handoff deferred to P9-A;
- rollback is additive: revert the P9-0H PR; no database rollback exists because there is no migration.

- [ ] **Step 2: Run full repository regression locally/CI-equivalent where available**

Run:

```bash
npm run typecheck
npm test
npm run build
```

Expected: all existing Growth, evidence, P8 risk/approval/mutation/verification, and new advisory tests pass.

- [ ] **Step 3: Open/update Draft PR and run exact-head CI**

The PR body must state:

- no Prisma migration;
- no P7 scoring change;
- no P8 safety change;
- no runtime updater/network/executable third-party code;
- exact upstream pins and licenses;
- focused advisory safety tests;
- raw Markdown not exposed by public API;
- no merge/deploy without separate authorization.

Wait for exact final PR head and require all three jobs:

```text
verify = success
production-audit = success
e2e = success
```

Inside `verify`, require Prisma validate/generate/migrate, Typecheck, full Vitest, and Build all success.

- [ ] **Step 4: Perform final diff review**

Review every changed filename and reject release if the PR contains:

- Prisma schema/migration changes;
- P7 score/evidence changes;
- P8 risk/approval/mutation/verification changes;
- shell/Python/JS/TS executables under vendor;
- package/dependency changes not required by this plan;
- server boot wiring;
- runtime fetch/updater code;
- credentials or private data;
- raw-upstream public API exposure;
- unpinned upstream refs;
- unhashed legal/raw/projection/manifest assets.

- [ ] **Step 5: Mark Ready only after exact-head evidence**

Use `verification-before-completion`. Mark Ready for review only when exact final head has the three required CI jobs green and manual diff review has no blocker. Do not merge. Human merge requires a separate explicit `合并` instruction.
