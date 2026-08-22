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
- Aaron legal file: exact pinned `LICENSE`, SPDX `Apache-2.0`; the pinned repository has no root `NOTICE`, so V1 omits `noticeFile`.
- SHA-256 values are lowercase hex over exact committed bytes with no newline normalization.
- Final exact PR head must pass `verify`, `production-audit`, and `e2e`; do not merge without a separate explicit human `合并` instruction.

## File Structure

First-party code:

- `src/modules/advisory-skills/advisory-skill.types.ts` — V1 types and public result types.
- `src/modules/advisory-skills/advisory-skill.schemas.ts` — strict Zod registry/manifest/projection schemas.
- `src/modules/advisory-skills/advisory-skill.policy.ts` — first-party allowlists, fixed identities, error codes.
- `src/modules/advisory-skills/advisory-skill.loader.ts` — filesystem/path/hash/legal/census validation.
- `src/modules/advisory-skills/advisory-skill.registry.ts` — projection-only explicit-root public read API.

Tests:

- `tests/unit/advisory-skill.schemas.test.ts`
- `tests/unit/advisory-skill.loader.test.ts`
- `tests/unit/advisory-skill.registry.test.ts`
- `tests/unit/advisory-skill.boundary.test.ts`
- `tests/integration/advisory-skill.vendor.test.ts`

Vendor root:

- `vendor/third-party-skills/registry.json`
- `vendor/third-party-skills/coreyhaines31-marketingskills/{manifest.json,LICENSE,upstream/,projections/}`
- `vendor/third-party-skills/aaron-marketing-skills/{manifest.json,LICENSE,upstream/,projections/}`

No executable/runtime file is allowed below `vendor/third-party-skills/`.

---

### Task 1: Lock V1 types, schemas, identities, capabilities, and errors

**Files:**
- Create: `src/modules/advisory-skills/advisory-skill.types.ts`
- Create: `src/modules/advisory-skills/advisory-skill.schemas.ts`
- Create: `src/modules/advisory-skills/advisory-skill.policy.ts`
- Test: `tests/unit/advisory-skill.schemas.test.ts`

**Interfaces:**
- Produces `AdvisoryMethodKey`, `AdvisoryCapability`, `AdvisoryRegistryV1`, `AdvisorySourceManifestV1`, `AdvisoryMethodProjectionV1`, `LoadedAdvisoryMethod`, `AdvisorySkillError`, `ADVISORY_METHOD_IDENTITIES`, `ADVISORY_CAPABILITIES`, and strict Zod schemas.
- `LoadedAdvisorySource` is deliberately not public; Task 2 defines it as an internal loader type.

- [ ] **Step 1: Write test-only RED**

Create `tests/unit/advisory-skill.schemas.test.ts` and import the not-yet-created modules. Lock these behaviors:

```ts
it('locks exactly 13 unique V1 method identities', () => {
  expect(ADVISORY_METHOD_IDENTITIES).toHaveLength(13)
  expect(new Set(ADVISORY_METHOD_IDENTITIES.map((x) => x.skillId)).size).toBe(13)
  expect(new Set(ADVISORY_METHOD_IDENTITIES.map((x) => x.methodKey)).size).toBe(13)
})

it('rejects symbolic upstream refs', () => {
  const result = advisorySourceManifestSchema.safeParse({
    manifestVersion: 'ADVISORY_SOURCE_MANIFEST_V1',
    sourceId: 'fixture',
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

it('rejects vendor-supplied authority fields', () => {
  const candidate = validProjectionFixture()
  expect(advisoryMethodProjectionSchema.safeParse({
    ...candidate,
    authority: 'AUTHORITATIVE',
  }).success).toBe(false)
})
```

Also test: unknown schema versions, unknown capabilities, unknown license, uppercase/short/malformed SHA-256, empty projection arrays, empty `sourceRefs`, missing `evidenceRules`, missing `forbiddenInferences`, and extra unknown object keys.

- [ ] **Step 2: Verify RED**

Run:

```bash
npx vitest run tests/unit/advisory-skill.schemas.test.ts
```

Expected: module-resolution/type failure because advisory-skill production files do not exist. Commit this test-only RED before production code.

- [ ] **Step 3: Implement minimal V1 contract**

In `advisory-skill.types.ts` define exact literal unions for:

```ts
export const ADVISORY_METHOD_KEYS = [
  'SEO_AUDIT', 'AI_SEO', 'SCHEMA', 'PROGRAMMATIC_SEO',
  'SITE_ARCHITECTURE', 'CONTENT_STRATEGY', 'ANALYTICS', 'EXPERIMENT_DESIGN',
  'CONTENT_QUALITY_AUDIT', 'DOMAIN_TRUST_AUDIT', 'TECHNICAL_SEO_CHECK',
  'ON_PAGE_SEO_CHECK', 'OFFSITE_SIGNAL_ANALYSIS',
] as const

export const ADVISORY_CAPABILITIES = [
  'SEO_AUDIT_METHOD', 'AI_SEO_METHOD', 'SCHEMA_METHOD', 'PROGRAMMATIC_SEO_METHOD',
  'SITE_ARCHITECTURE_METHOD', 'CONTENT_STRATEGY_METHOD', 'ANALYTICS_METHOD',
  'EXPERIMENT_METHOD', 'CONTENT_QUALITY_METHOD', 'DOMAIN_TRUST_METHOD',
  'TECHNICAL_SEO_METHOD', 'ON_PAGE_SEO_METHOD', 'OFFSITE_SIGNAL_METHOD',
] as const
```

In `advisory-skill.policy.ts`, define identities as objects, not tuples:

```ts
export const ADVISORY_METHOD_IDENTITIES = [
  { skillId: 'corey.seo-audit', methodKey: 'SEO_AUDIT', capability: 'SEO_AUDIT_METHOD' },
  { skillId: 'corey.ai-seo', methodKey: 'AI_SEO', capability: 'AI_SEO_METHOD' },
  { skillId: 'corey.schema', methodKey: 'SCHEMA', capability: 'SCHEMA_METHOD' },
  { skillId: 'corey.programmatic-seo', methodKey: 'PROGRAMMATIC_SEO', capability: 'PROGRAMMATIC_SEO_METHOD' },
  { skillId: 'corey.site-architecture', methodKey: 'SITE_ARCHITECTURE', capability: 'SITE_ARCHITECTURE_METHOD' },
  { skillId: 'corey.content-strategy', methodKey: 'CONTENT_STRATEGY', capability: 'CONTENT_STRATEGY_METHOD' },
  { skillId: 'corey.analytics', methodKey: 'ANALYTICS', capability: 'ANALYTICS_METHOD' },
  { skillId: 'corey.ab-testing', methodKey: 'EXPERIMENT_DESIGN', capability: 'EXPERIMENT_METHOD' },
  { skillId: 'aaron.content-quality-auditor', methodKey: 'CONTENT_QUALITY_AUDIT', capability: 'CONTENT_QUALITY_METHOD' },
  { skillId: 'aaron.domain-authority-auditor', methodKey: 'DOMAIN_TRUST_AUDIT', capability: 'DOMAIN_TRUST_METHOD' },
  { skillId: 'aaron.technical-seo-checker', methodKey: 'TECHNICAL_SEO_CHECK', capability: 'TECHNICAL_SEO_METHOD' },
  { skillId: 'aaron.on-page-seo-checker', methodKey: 'ON_PAGE_SEO_CHECK', capability: 'ON_PAGE_SEO_METHOD' },
  { skillId: 'aaron.offsite-signal-analyzer', methodKey: 'OFFSITE_SIGNAL_ANALYSIS', capability: 'OFFSITE_SIGNAL_METHOD' },
] as const
```

Use `z.object(...).strict()` for every vendor-controlled object. `upstreamCommit` matches `/^[0-9a-f]{40}$/`; SHA-256 matches `/^[0-9a-f]{64}$/`; `licenseSpdx` is only `MIT | Apache-2.0`. Method content arrays are non-empty. No schema contains authority, execution, credential, network, Git, risk, approval, or VERIFIED fields.

Create `AdvisorySkillError` with stable error codes from the spec, including registry/manifest invalid, path escape, symlink, undeclared file, rejected type, hash mismatch, rejected license/capability, duplicate ID/method, and projection invalid.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/unit/advisory-skill.schemas.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Commit as `feat: add advisory skill V1 contracts`.

---

### Task 2: Implement fail-closed filesystem, integrity, legal, and census validation

**Files:**
- Create: `src/modules/advisory-skills/advisory-skill.loader.ts`
- Test: `tests/unit/advisory-skill.loader.test.ts`

**Interfaces:**
- Consumes Task 1 schemas/policy/errors.
- Defines internal:

```ts
type LoadedAdvisorySource = {
  manifest: AdvisorySourceManifestV1
  methods: Array<{
    skill: AdvisorySourceManifestV1['skills'][number]
    projection: AdvisoryMethodProjectionV1
  }>
}

export async function loadAdvisorySources(rootDir: string): Promise<LoadedAdvisorySource[]>
```

Raw upstream bytes are validated and discarded; they are not returned in `LoadedAdvisorySource`.

- [ ] **Step 1: Write fixture-based test-only RED**

Create temporary vendor trees with `mkdtemp`, `mkdir`, `writeFile`, `createHash('sha256')`, and one valid single-method fixture. Add tests for:

```ts
it('loads a valid hash-bound source tree')
it('fails when registry manifest hash changes')
it('fails when raw markdown changes')
it('fails when projection changes')
it('fails when LICENSE changes')
it('fails registry and source path traversal')
it('rejects absolute paths')
it('rejects any symlink inside the vendor root')
it('fails on undeclared source files')
it('fails on unexpected top-level files/directories')
it('rejects script/executable/binary payloads')
it('fails on missing declared files')
it('fails duplicate source, skill, and method IDs')
it('fails projection sourceRefs outside declared upstreamFiles')
```

Path traversal tests must include both `../escape.md` and absolute filesystem paths. Ubuntu CI must execute symlink rejection; skip only on hosts that explicitly cannot create symlinks.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/advisory-skill.loader.test.ts
```

Expected: module-resolution failure for `advisory-skill.loader.js`.

- [ ] **Step 3: Implement minimal loader**

Private helpers:

```ts
async function readRegularFileInside(baseDir: string, relativePath: string): Promise<Buffer>
function sha256(bytes: Buffer): string
async function assertNoSymlinks(rootDir: string): Promise<void>
async function assertSourceFileCensus(sourceDir: string, declared: Set<string>): Promise<void>
async function assertRootCensus(rootDir: string, declaredSourceDirs: Set<string>): Promise<void>
```

Rules:

- Reject absolute paths and `..` segments before access.
- Use `path.resolve` + `realpath`; result must remain under configured base.
- `lstat` traversed paths and reject symlinks.
- Allowed data extensions are `.md`, `.json`, `.txt`; extensionless `LICENSE`/`NOTICE` are allowed only when declared legal files.
- Hash exact `manifest.json` bytes before parsing; registry owns that hash.
- Hash legal/raw/projection files before parsing projections.
- Strict-parse registry, manifest, projection with Task 1 schemas.
- Projection `skillId`/`methodKey` must match manifest; every `sourceRef` path/hash pair must match a declared upstream file for that skill.
- Enforce global duplicate source/skill/method rejection.
- Enforce exact source and top-level file census.
- Import only first-party Node `fs/promises`, `path`, `crypto` plus Task 1 modules/Zod outputs. No Prisma, BullMQ, HTTP, child-process, Git, MCP, or dynamic import of vendor data.

- [ ] **Step 4: Verify GREEN**

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
- Modify only if needed: `src/modules/advisory-skills/advisory-skill.types.ts`
- Test: `tests/unit/advisory-skill.registry.test.ts`

**Interfaces:**

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

- [ ] **Step 1: Write public-API test-only RED**

Lock:

```ts
const registry = await createAdvisorySkillRegistry({ rootDir })
const method = registry.getByMethodKeys(['SEO_AUDIT'])[0]
expect(method.authority).toBe('ADVISORY_ONLY')
expect(method.projection.methodKey).toBe('SEO_AUDIT')
expect(JSON.stringify(method)).not.toContain('RAW_UPSTREAM_SENTINEL')
```

Also require deterministic sorting (`methodKey`, then `skillId`), deduped query keys/capabilities, unknown requested keys returning an empty subset with no fallback, exact provenance, and caller mutation not changing subsequent registry reads.

- [ ] **Step 2: Verify RED**

```bash
npx vitest run tests/unit/advisory-skill.registry.test.ts
```

Expected: missing registry module.

- [ ] **Step 3: Implement minimal registry**

- Flatten validated source projections into `LoadedAdvisoryMethod`.
- Stamp `authority: 'ADVISORY_ONLY'` in first-party code only.
- Provenance contains `sourceRepo`, `upstreamCommit`, `localVersion`, `projectionSha256`, and sorted unique source-file hashes.
- Return immutable data or defensive copies.
- Public module exports no raw upstream reader/body.
- `rootDir` is mandatory and never sourced from environment variables.

- [ ] **Step 4: Verify GREEN**

```bash
npx vitest run tests/unit/advisory-skill.registry.test.ts tests/unit/advisory-skill.loader.test.ts tests/unit/advisory-skill.schemas.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

Commit as `feat: add advisory skill registry`.

---

### Task 4: Vendor the eight reviewed Corey methods

**Files:**
- Create exact MIT `vendor/third-party-skills/coreyhaines31-marketingskills/LICENSE`.
- Create exact pinned raw entrypoints:
  - `.../upstream/skills/seo-audit/SKILL.md`
  - `.../upstream/skills/ai-seo/SKILL.md`
  - `.../upstream/skills/schema/SKILL.md`
  - `.../upstream/skills/programmatic-seo/SKILL.md`
  - `.../upstream/skills/site-architecture/SKILL.md`
  - `.../upstream/skills/content-strategy/SKILL.md`
  - `.../upstream/skills/analytics/SKILL.md`
  - `.../upstream/skills/ab-testing/SKILL.md`
- Create eight JSON projections named by fixed method key.
- Create `vendor/third-party-skills/coreyhaines31-marketingskills/manifest.json`.
- Create initial `vendor/third-party-skills/registry.json`.
- Create/modify `tests/integration/advisory-skill.vendor.test.ts`.

- [ ] **Step 1: Re-verify upstream supply-chain inputs**

Fetch exact commit `3df87f97621e18fbed7f6aa684edba54f49779a7`, exact root `LICENSE`, and each exact `skills/<name>/SKILL.md`. Stop if any pinned path is missing or license differs from the reviewed MIT file. Never substitute `main`, tag, short SHA, or renamed skill.

- [ ] **Step 2: Write real-vendor test-only RED**

```ts
const registry = await createAdvisorySkillRegistry({
  rootDir: path.resolve('vendor/third-party-skills'),
})
const corey = registry.listAll().filter((x) => x.skillId.startsWith('corey.'))
expect(corey).toHaveLength(8)
expect(corey.every((x) => x.authority === 'ADVISORY_ONLY')).toBe(true)
expect(corey.every((x) => x.provenance.upstreamCommit === '3df87f97621e18fbed7f6aa684edba54f49779a7')).toBe(true)
```

RED must be missing vendor assets, not TypeScript fixture errors.

- [ ] **Step 3: Vendor exact bytes and create bounded projections**

Copy only the eight selected `SKILL.md` entrypoints and exact MIT `LICENSE`. Do not vendor scripts, connectors, package files, hooks, MCP configs, or unrelated skills even if Markdown references them.

Every projection uses `ADVISORY_METHOD_PROJECTION_V1`, the fixed identity/capability, and non-empty `purpose`, `whenToUse`, `requiredInputs`, `steps`, `checks`, `outputs`, `evidenceRules`, `forbiddenInferences`, `sourceRefs`. Projection text must describe analysis/planning methods only; omit upstream routing/tool/credential/mutation instructions. Explicitly retain “missing observed data remains unknown” and prohibit fabricated rankings/citations/traffic/performance.

- [ ] **Step 4: Build hash chain**

Manifest values:

```text
sourceId = coreyhaines31-marketingskills
sourceRepo = coreyhaines31/marketingskills
upstreamCommit = 3df87f97621e18fbed7f6aa684edba54f49779a7
licenseSpdx = MIT
localVersion = 1.0.0
reviewedAt = 2026-08-22
```

Hash exact legal/raw/projection bytes. Then hash exact `manifest.json` bytes and store that in top-level `registry.json` version `THIRD_PARTY_ADVISORY_REGISTRY_V1`.

- [ ] **Step 5: Verify GREEN**

```bash
npx vitest run tests/integration/advisory-skill.vendor.test.ts tests/unit/advisory-skill.schemas.test.ts tests/unit/advisory-skill.loader.test.ts tests/unit/advisory-skill.registry.test.ts
npm run typecheck
```

Expected: eight Corey methods load.

- [ ] **Step 6: Commit**

Commit as `feat: vendor reviewed Corey SEO methods`.

---

### Task 5: Vendor the five reviewed Aaron complementary methods

**Files:**
- Create exact Apache-2.0 `vendor/third-party-skills/aaron-marketing-skills/LICENSE`.
- Create exact raw entrypoints:
  - `.../upstream/seo-geo/tune/content-quality-auditor/SKILL.md`
  - `.../upstream/seo-geo/evaluate/domain-authority-auditor/SKILL.md`
  - `.../upstream/seo-geo/tune/technical-seo-checker/SKILL.md`
  - `.../upstream/seo-geo/tune/on-page-seo-checker/SKILL.md`
  - `.../upstream/seo-geo/evaluate/offsite-signal-analyzer/SKILL.md`
- Create five JSON projections.
- Create `vendor/third-party-skills/aaron-marketing-skills/manifest.json`.
- Modify `vendor/third-party-skills/registry.json`.
- Modify `tests/integration/advisory-skill.vendor.test.ts`.

- [ ] **Step 1: Re-verify upstream pin and legal boundary**

Fetch exact commit `17296c71d1ff822975efb1ea28de52668c9c9022`, exact root `LICENSE`, and all five entrypoints. Confirm Apache-2.0 and confirm root `NOTICE` is absent. Stop on mismatch; never switch to current `main`.

- [ ] **Step 2: Write 13-method test-only RED**

```ts
const all = registry.listAll()
expect(all).toHaveLength(13)
expect(all.filter((x) => x.skillId.startsWith('aaron.')).map((x) => x.methodKey).sort()).toEqual([
  'CONTENT_QUALITY_AUDIT', 'DOMAIN_TRUST_AUDIT', 'OFFSITE_SIGNAL_ANALYSIS',
  'ON_PAGE_SEO_CHECK', 'TECHNICAL_SEO_CHECK',
].sort())
```

Also assert exact Aaron upstream commit provenance and `ADVISORY_ONLY` on all 13.

- [ ] **Step 3: Vendor exact bytes and create bounded projections**

Copy only the five selected `SKILL.md` files and exact Apache license. Exclude Python/Bash runtimes, connectors, hooks, registries, memory, commands, MCP config, and mutation-class tooling.

Projection-specific rules:

- CORE-EEAT/CITE are advisory method names only; their upstream scores/gates never become P7 score, P8 risk, approval, or VERIFIED state.
- Offsite method cannot infer backlinks/AI-referral/citation status without observed inputs.
- Technical/on-page methods cannot mutate pages or invoke scanners/connectors in 0H.

- [ ] **Step 4: Build Aaron hash chain and update registry**

```text
sourceId = aaron-marketing-skills
sourceRepo = aaron-he-zhu/aaron-marketing-skills
upstreamCommit = 17296c71d1ff822975efb1ea28de52668c9c9022
licenseSpdx = Apache-2.0
noticeFile = omitted
localVersion = 1.0.0
reviewedAt = 2026-08-22
```

Hash legal/raw/projection bytes, then exact Aaron manifest bytes, and update top-level registry with both source manifest hashes.

- [ ] **Step 5: Verify GREEN**

```bash
npx vitest run tests/integration/advisory-skill.vendor.test.ts tests/unit/advisory-skill.schemas.test.ts tests/unit/advisory-skill.loader.test.ts tests/unit/advisory-skill.registry.test.ts
npm run typecheck
```

Expected: exactly 13 methods load.

- [ ] **Step 6: Commit**

Commit as `feat: vendor reviewed Aaron SEO methods`.

---

### Task 6: Prove non-execution and authority isolation

**Files:**
- Create: `tests/unit/advisory-skill.boundary.test.ts`
- Modify `src/modules/advisory-skills/*` only if a boundary test exposes a real implementation leak.

- [ ] **Step 1: Write boundary tests**

Lock these properties:

```ts
it('advisory module has no forbidden runtime imports')
it('public loaded methods expose projection but no raw body')
it('environment changes cannot redirect explicit rootDir')
it('command/API/credential-looking vendor strings remain inert')
it('real vendor tree contains no executable/script extensions')
it('P7 score modules do not import advisory-skills')
it('P8 risk/approval/mutation modules do not import advisory-skills')
```

Source inspection must reject first-party advisory code importing/using process execution, `eval`, dynamic vendor import, HTTP clients, BullMQ/ioredis, Prisma, Git mutation clients, MCP/plugin loaders, or environment-based vendor-root discovery. Do not reject command-like strings inside raw vendor Markdown; raw Markdown is allowed to contain upstream text because it is never executed/exposed as runtime instructions.

- [ ] **Step 2: Run boundary test**

```bash
npx vitest run tests/unit/advisory-skill.boundary.test.ts
```

If it passes immediately, this is a regression gate and needs no production change. If it fails, treat the exact leak as RED and make only the minimum first-party fix.

- [ ] **Step 3: Run focused P9-0H suite**

```bash
npx vitest run tests/unit/advisory-skill.schemas.test.ts tests/unit/advisory-skill.loader.test.ts tests/unit/advisory-skill.registry.test.ts tests/unit/advisory-skill.boundary.test.ts tests/integration/advisory-skill.vendor.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit changed boundary tests/fix**

Use `test: lock advisory skill safety boundaries` if test-only, or a narrowly named `fix:` commit if production code changed.

---

### Task 7: Documentation, full regression, PR review, and exact-head release gate

**Files:**
- Create: `docs/development/p9-0h-third-party-skill-foundation.md`

- [ ] **Step 1: Write development documentation**

Document exact pins/licenses, 13 identities, raw-vs-projection boundary, explicit-root usage, integrity chain, path/symlink/census rules, prohibited runtime capabilities, upgrade stop conditions, P9-A packaging/provenance handoff, and additive rollback by reverting the PR (no DB rollback because no migration).

- [ ] **Step 2: Run full regression**

```bash
npm run typecheck
npm test
npm run build
```

Expected: all existing Growth/evidence and P8 risk/approval/mutation/verification tests remain green together with new advisory tests.

- [ ] **Step 3: Open/update Draft PR and run exact-head CI**

PR body must state: no migration; no P7 scoring change; no P8 safety change; no runtime updater/network/executable third-party code; exact pins/licenses; projection-only public API; no merge/deploy without separate authorization.

Require exact final head:

```text
verify = success
production-audit = success
e2e = success
```

Within `verify`, require Prisma validate/generate/migrate, Typecheck, full Vitest, and Build success.

- [ ] **Step 4: Manual final diff review**

Reject release if changed files contain Prisma schema/migration, P7 score/evidence, P8 risk/approval/mutation/verification, executable vendor files, unrelated dependency/package changes, server boot wiring, runtime fetch/updater code, credentials/private data, raw-upstream public API exposure, unpinned refs, or unhashed legal/raw/projection/manifest assets.

- [ ] **Step 5: Mark Ready only after fresh exact-head evidence**

Use `verification-before-completion`; mark Ready only after exact-head three-job success plus manual diff review. Do not merge. Human merge requires separate explicit `合并`.
