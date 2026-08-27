# Release-01 Production Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the P0-P10 application reproducibly staging-ready as Migration + Web + Worker roles without expanding product authority or deploying Production.

**Architecture:** One source/build line produces a production-shaped runtime used by separate Web and Worker processes; database schema changes are applied by a one-shot migration role. Express remains the UI/API boundary, BullMQ remains the async boundary, PostgreSQL 17 and Redis 7 remain independent dependencies, and TLS terminates at a trusted reverse proxy.

**Tech Stack:** Node.js 22, TypeScript 5.9, Express 5, Prisma 6/PostgreSQL 17, BullMQ 5/Redis 7, EJS, Playwright, Vitest, GitHub Actions, Docker.

**Spec:** `docs/superpowers/specs/2026-08-27-release-01-production-readiness-design.md`

## Global Constraints

- Release-01 is production-readiness/staging work only. It does not start P11 and does not authorize Production deployment.
- AI remains advisory only; existing deterministic and persisted truth sources remain authoritative in their existing domains.
- P6 official-provider visibility facts remain authoritative only when actually sampled and persisted; no consumer-app ranking claims may be invented.
- Search Console remains read-only.
- Direct default-branch writes remain prohibited; all work stays on the Release-01 PR branch until reviewed.
- Preserve `PR_CREATED != DEPLOYED != VERIFIED`.
- DeepSeek cannot approve, execute, merge, deploy, or roll back.
- Distribution normally requires VERIFIED; `MANUAL_HANDOFF` remains manual; community final actions remain human-operated.
- Optimization and controlled autopilot do not gain merge, deploy, or rollback authority.
- Configuration presence must never be presented as live provider health.
- `CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH=true` remains the default safety posture.
- PostgreSQL 17, Redis 7, Node.js 22, Prisma 6, existing queue names/processors, RBAC, CSRF, session, publication, distribution, and optimization semantics remain unchanged.
- No Prisma schema or feature-data migration is expected. If a schema change becomes necessary, stop Release-01 implementation and perform a separate scope review before changing `prisma/schema.prisma` or adding a feature migration.
- Every runtime change follows RED -> minimal GREEN -> focused verification -> exact-head full CI.

---

### Task 1: Production environment fail-fast and complete environment contract

**Files:**
- Modify: `src/config/env.ts`
- Modify: `.env.example`
- Modify: `tests/unit/auth.env.test.ts`

**Interfaces:**
- Consumes: existing Zod environment schema and current `env` singleton import contract.
- Produces: exported `parseEnv(input: NodeJS.ProcessEnv): RuntimeEnv` plus `env = parseEnv(process.env)`; production requires explicit DB/Redis/session values; `TRUST_PROXY_HOPS` becomes a validated non-negative integer for Task 2.

- [ ] **Step 1: Extend the failing environment tests**

Add cases that remove `DATABASE_URL` and `REDIS_URL` from `process.env` under `NODE_ENV=production` and assert module import rejects with exact messages. Preserve the existing short-session-secret test and add a passing case with all three required values.

```ts
it('rejects production when DATABASE_URL is not explicitly configured', async () => {
  process.env.NODE_ENV = 'production';
  delete process.env.DATABASE_URL;
  process.env.REDIS_URL = 'redis://127.0.0.1:6379';
  process.env.SESSION_SECRET = 's'.repeat(32);

  await expect(loadEnvModule()).rejects.toThrow(
    'DATABASE_URL is required in production',
  );
});

it('rejects production when REDIS_URL is not explicitly configured', async () => {
  process.env.NODE_ENV = 'production';
  process.env.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/seogeo';
  delete process.env.REDIS_URL;
  process.env.SESSION_SECRET = 's'.repeat(32);

  await expect(loadEnvModule()).rejects.toThrow(
    'REDIS_URL is required in production',
  );
});
```

Extend `restoreEnv()` to preserve/restore `DATABASE_URL`, `REDIS_URL`, and `TRUST_PROXY_HOPS` so tests never leak environment state.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:
```bash
npx vitest run tests/unit/auth.env.test.ts
```
Expected: the new missing-DB/missing-Redis assertions fail because the current schema silently supplies localhost defaults.

- [ ] **Step 3: Implement minimal production parsing**

Refactor `src/config/env.ts` so parsing is testable while keeping existing imports stable:

```ts
const schema = z.object({
  // existing fields unchanged
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
});

export type RuntimeEnv = z.infer<typeof schema>;

export function parseEnv(input: NodeJS.ProcessEnv): RuntimeEnv {
  const parsed = schema.parse(input);

  if (parsed.NODE_ENV === 'production') {
    if (!input.DATABASE_URL?.trim()) {
      throw new Error('DATABASE_URL is required in production');
    }
    if (!input.REDIS_URL?.trim()) {
      throw new Error('REDIS_URL is required in production');
    }
    if (!input.SESSION_SECRET?.trim()) {
      throw new Error('SESSION_SECRET is required in production');
    }
    if (parsed.SESSION_SECRET.length < 32) {
      throw new Error('SESSION_SECRET must be at least 32 characters in production');
    }
  }

  return parsed;
}

export const env = parseEnv(process.env);
```

Keep development/test defaults unchanged. Do not make DeepSeek/OAuth/provider credentials globally mandatory.

- [ ] **Step 4: Align `.env.example`**

Document the complete non-secret runtime surface, including:

```dotenv
TRUST_PROXY_HOPS=0
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_OAUTH_REDIRECT_URI=
OAUTH_CREDENTIAL_ENCRYPTION_KEY=
OAUTH_CREDENTIAL_KEY_VERSION=v1
```

Keep `CONTROLLED_AUTOPILOT_GLOBAL_KILL_SWITCH=true`; do not add real credentials.

- [ ] **Step 5: Run focused and compiler verification**

Run:
```bash
npx vitest run tests/unit/auth.env.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit the independently reviewable environment contract**

```bash
git add src/config/env.ts .env.example tests/unit/auth.env.test.ts
git commit -m "fix: fail closed on production runtime env"
```

---

### Task 2: Trusted reverse-proxy contract without weakening login Origin checks

**Files:**
- Modify: `src/app.ts`
- Create: `src/runtime/trust-proxy.ts`
- Create: `tests/unit/trust-proxy.test.ts`
- Create: `tests/integration/release-01-proxy-auth.test.ts`

**Interfaces:**
- Consumes: `env.TRUST_PROXY_HOPS`, Express `Application`, existing `/auth/login` Origin validation.
- Produces: `configureTrustProxy(app: Express, hops: number): void`; `0` means no trusted proxy, positive integer means exactly that many trusted hops.

- [ ] **Step 1: Write a failing helper contract test**

```ts
import express from 'express';
import { describe, expect, it } from 'vitest';
import { configureTrustProxy } from '../../src/runtime/trust-proxy.js';

describe('trusted proxy configuration', () => {
  it('keeps forwarded headers untrusted at zero hops', () => {
    const app = express();
    configureTrustProxy(app, 0);
    expect(app.get('trust proxy')).toBe(false);
  });

  it('trusts exactly the configured proxy hop count', () => {
    const app = express();
    configureTrustProxy(app, 1);
    expect(app.get('trust proxy')).toBe(1);
  });
});
```

- [ ] **Step 2: Run helper test and verify RED**

Run:
```bash
npx vitest run tests/unit/trust-proxy.test.ts
```
Expected: FAIL because `src/runtime/trust-proxy.ts` does not exist.

- [ ] **Step 3: Implement the minimal helper and wire `createApp()`**

```ts
import type { Express } from 'express';

export function configureTrustProxy(app: Express, hops: number): void {
  app.set('trust proxy', hops === 0 ? false : hops);
}
```

In `createApp()` call `configureTrustProxy(app, env.TRUST_PROXY_HOPS)` immediately after creating the Express app, before auth/session-sensitive middleware.

- [ ] **Step 4: Write proxy/origin integration RED coverage**

Create a focused integration test that uses `createApp()`, overrides trusted proxy to one hop for the test instance, sends `Host`, `X-Forwarded-Proto: https`, and `Origin` headers, and proves the current auth route distinguishes a matching public HTTPS origin from a mismatched origin. The mismatch must continue to return the existing `LOGIN_ORIGIN_INVALID` response; the matching origin must proceed past Origin rejection to the existing authentication outcome.

```ts
const app = createApp();
app.set('trust proxy', 1);

const mismatched = await request(app)
  .post('/auth/login')
  .set('Host', 'staging.example')
  .set('X-Forwarded-Proto', 'https')
  .set('Origin', 'https://evil.example')
  .send({ email: 'missing@example.com', password: 'wrong' });

expect(mismatched.body.error?.code).toBe('LOGIN_ORIGIN_INVALID');
```

For the matching request use `Origin: https://staging.example`; assert it does **not** return `LOGIN_ORIGIN_INVALID`. Do not change password/session/RBAC semantics merely to satisfy this test.

- [ ] **Step 5: Run focused proxy/auth tests and verify GREEN**

Run:
```bash
npx vitest run tests/unit/trust-proxy.test.ts tests/integration/release-01-proxy-auth.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app.ts src/runtime/trust-proxy.ts tests/unit/trust-proxy.test.ts tests/integration/release-01-proxy-auth.test.ts
git commit -m "fix: define trusted proxy runtime contract"
```

---

### Task 3: Testable Web lifecycle with graceful shutdown

**Files:**
- Create: `src/runtime/web-runtime.ts`
- Modify: `src/server.ts`
- Create: `tests/unit/web-runtime.test.ts`

**Interfaces:**
- Consumes: Express `Application`, Node `http.Server`, `env.PORT`.
- Produces:
  - `startWebServer(app: Express, port: number, onListening?: () => void): Server`
  - `stopWebServer(server: Server): Promise<void>`
- Web runtime must not import or invoke `startWorkers()`.

- [ ] **Step 1: Write failing lifecycle tests**

Use a fake server close callback so the unit test does not bind a real port:

```ts
it('resolves when server.close succeeds', async () => {
  const server = {
    close(callback: (error?: Error) => void) { callback(); }
  } as unknown as Server;

  await expect(stopWebServer(server)).resolves.toBeUndefined();
});

it('rejects when server.close reports an error', async () => {
  const expected = new Error('close failed');
  const server = {
    close(callback: (error?: Error) => void) { callback(expected); }
  } as unknown as Server;

  await expect(stopWebServer(server)).rejects.toBe(expected);
});
```

Also assert the production Web entry source does not import `worker-bootstrap` so process separation is locked by a contract test.

- [ ] **Step 2: Run RED**

Run:
```bash
npx vitest run tests/unit/web-runtime.test.ts
```
Expected: FAIL because `web-runtime.ts` does not exist.

- [ ] **Step 3: Implement minimal Web runtime and thin entry**

`web-runtime.ts` owns listen/close mechanics. `src/server.ts` remains the executable entry: create app, start Web, log startup/shutdown, register SIGTERM/SIGINT, call `stopWebServer()`, and set `process.exitCode = 1` only on shutdown error. Do not start BullMQ workers.

- [ ] **Step 4: Run focused verification**

Run:
```bash
npx vitest run tests/unit/web-runtime.test.ts
npm run typecheck
npm run build
```
Expected: PASS and `dist/src/server.js` remains the Web start target.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/web-runtime.ts src/server.ts tests/unit/web-runtime.test.ts
git commit -m "refactor: isolate web runtime lifecycle"
```

---

### Task 4: Dedicated production Worker entry and graceful lifecycle

**Files:**
- Create: `src/runtime/worker-runtime.ts`
- Create: `src/worker.ts`
- Modify: `package.json`
- Create: `tests/unit/worker-runtime.test.ts`
- Preserve: `src/queue/worker-bootstrap.ts` queue semantics; change only if a lifecycle defect is proven by RED coverage.

**Interfaces:**
- Consumes: existing `startWorkers(): Promise<{ close(): Promise<void> }>`.
- Produces:
  - `startWorkerRuntime(start?: typeof startWorkers): Promise<WorkerRuntime>`
  - `WorkerRuntime.close(): Promise<void>`
  - npm script `start:worker` -> `node dist/src/worker.js`
- Worker entry must not import `createApp()` or bind an HTTP port.

- [ ] **Step 1: Write failing Worker runtime test**

```ts
it('starts existing workers and delegates shutdown exactly once', async () => {
  const close = vi.fn().mockResolvedValue(undefined);
  const start = vi.fn().mockResolvedValue({ close });

  const runtime = await startWorkerRuntime(start as never);
  expect(start).toHaveBeenCalledTimes(1);

  await runtime.close();
  expect(close).toHaveBeenCalledTimes(1);
});
```

Add a source-contract assertion that `src/worker.ts` does not import `./app.js` or call `.listen(`.

- [ ] **Step 2: Run RED**

Run:
```bash
npx vitest run tests/unit/worker-runtime.test.ts
```
Expected: FAIL because Worker runtime/entry do not exist.

- [ ] **Step 3: Implement minimal runtime**

```ts
import { startWorkers } from '../queue/worker-bootstrap.js';

export async function startWorkerRuntime(start = startWorkers) {
  const workers = await start();
  return { close: () => workers.close() };
}
```

`src/worker.ts` loads validated env through normal imports, starts the Worker runtime, logs startup/shutdown, and handles SIGTERM/SIGINT by awaiting `runtime.close()`. On startup or close failure log to stderr and set non-zero `process.exitCode`. Do not create an HTTP health endpoint.

- [ ] **Step 4: Add production command**

Add:
```json
"start:worker": "node dist/src/worker.js"
```

Keep `start` unchanged as Web-only.

- [ ] **Step 5: Run focused and build verification**

Run:
```bash
npx vitest run tests/unit/worker-runtime.test.ts tests/unit/worker-bootstrap.test.ts
npm run typecheck
npm run build
node -e "const p=require('./package.json'); if(p.scripts['start:worker']!=='node dist/src/worker.js') process.exit(1)"
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/worker-runtime.ts src/worker.ts package.json tests/unit/worker-runtime.test.ts
git commit -m "feat: add dedicated production worker runtime"
```

---

### Task 5: Reproducible Docker deployment artifact for Web, Worker, and Migration roles

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Create: `tests/unit/release-01-packaging.contract.test.ts`

**Interfaces:**
- Consumes: Node 22, `package-lock.json`, TypeScript build output, Prisma schema/client, EJS/static assets, runtime Playwright dependency.
- Produces:
  - `runtime` image target usable with either `npm start` or `npm run start:worker`.
  - `migration` image target whose default command is `npx prisma migrate deploy`.

- [ ] **Step 1: Write RED packaging contract**

Read Dockerfile text and assert it declares named `build`, `runtime`, and `migration` stages, uses Node 22, copies `dist`, `prisma`, `src/views`, and `src/public`, and contains no `ARG`/`ENV` assignment for application secrets such as `SESSION_SECRET`, `DATABASE_URL`, provider API keys, or OAuth client secrets.

```ts
const dockerfile = readFileSync('Dockerfile', 'utf8');
expect(dockerfile).toContain('AS runtime');
expect(dockerfile).toContain('AS migration');
expect(dockerfile).toContain('node:22');
expect(dockerfile).not.toMatch(/ENV\s+(SESSION_SECRET|DATABASE_URL|DEEPSEEK_API_KEY)=/);
```

- [ ] **Step 2: Run RED**

Run:
```bash
npx vitest run tests/unit/release-01-packaging.contract.test.ts
```
Expected: FAIL because Dockerfile does not exist.

- [ ] **Step 3: Create a multi-stage Dockerfile**

Use a Debian-based Node 22 image so Chromium dependencies are supported. The build stage runs `npm ci`, `npx prisma generate`, and `npm run build`. The runtime stage installs production dependencies only, copies generated Prisma runtime, compiled output, EJS views/static assets and required vendor/runtime files, and uses Web as default command. `npm run start:worker` must be available from the same runtime image. Install Playwright Chromium/runtime dependencies only because crawler browser fallback is an existing production capability; do not include `@playwright/test` in runtime dependencies.

The migration stage retains the Prisma CLI required to run:
```dockerfile
CMD ["npx", "prisma", "migrate", "deploy"]
```

No secret value may be embedded at build time.

- [ ] **Step 4: Create `.dockerignore`**

Exclude at minimum `.git`, `node_modules`, `dist`, `.env`, `.env.*` except `.env.example`, local screenshots/artifacts, coverage output, and editor/system files. Ensure required `vendor/third-party-skills`, `src/views`, `src/public`, and `prisma` remain in build context.

- [ ] **Step 5: Verify source contract and local Docker build when Docker is available**

Run:
```bash
npx vitest run tests/unit/release-01-packaging.contract.test.ts
npm run build
docker build --target runtime -t seogeo:release-01-test .
docker build --target migration -t seogeo-migration:release-01-test .
```
Expected: tests/build pass and both image targets build. If the local execution environment has no Docker daemon, record that exact limitation and rely on Task 6 GitHub Actions Docker build as the authoritative image-build gate; do not mark packaging verified before that CI job passes.

- [ ] **Step 6: Commit**

```bash
git add Dockerfile .dockerignore tests/unit/release-01-packaging.contract.test.ts
git commit -m "build: add Release-01 deployment artifact"
```

---

### Task 6: CI gate for deployable Release-01 artifact

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `tests/unit/release-01-packaging.contract.test.ts` only if the workflow exposes a real packaging-contract defect.

**Interfaces:**
- Consumes: existing `verify`, `production-audit`, and `e2e` jobs unchanged in meaning.
- Produces: additional `deployment-artifact` job that builds both Docker targets and proves Web/Worker commands are present in the runtime image.

- [ ] **Step 1: Add a RED workflow contract test**

Extend the packaging contract test to read `.github/workflows/ci.yml` and require a `deployment-artifact:` job plus both target builds:

```ts
const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
expect(workflow).toContain('deployment-artifact:');
expect(workflow).toContain('docker build --target runtime');
expect(workflow).toContain('docker build --target migration');
```

- [ ] **Step 2: Run RED**

Run:
```bash
npx vitest run tests/unit/release-01-packaging.contract.test.ts
```
Expected: FAIL because current CI has no deployment-artifact job.

- [ ] **Step 3: Add the minimal GitHub Actions job**

Add a separate job that:

1. checks out the exact PR head;
2. builds `runtime` target tagged with `${{ github.sha }}`;
3. builds `migration` target tagged with `${{ github.sha }}`;
4. runs a no-network image command to verify `package.json` contains both Web and Worker commands and `dist/src/server.js` plus `dist/src/worker.js` exist;
5. verifies the runtime image does not contain the Prisma CLI package directory;
6. never injects real staging/production secrets into image build steps.

Do not weaken or replace the existing `production-audit` job.

- [ ] **Step 4: Run local workflow contract and repository verification**

Run:
```bash
npx vitest run tests/unit/release-01-packaging.contract.test.ts
npm run typecheck
npm test
npm run build
```
Expected: PASS locally. The Docker build itself is authoritative only after the GitHub Actions `deployment-artifact` job is green.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml tests/unit/release-01-packaging.contract.test.ts
git commit -m "ci: verify Release-01 deployment artifact"
```

---

### Task 7: Staging deployment, backup/restore, rollback, and acceptance runbooks

**Files:**
- Create: `docs/development/release-01-staging-runbook.md`
- Create: `docs/development/release-01-backup-restore.md`
- Create: `docs/development/release-01-rollback.md`
- Create: `docs/development/release-01-staging-acceptance.md`
- Create: `tests/unit/release-01-runbooks.contract.test.ts`

**Interfaces:**
- Consumes: exact candidate SHA, runtime/migration Docker targets, public staging base URL, PostgreSQL backup tooling, existing health endpoints.
- Produces: operator-executable, platform-neutral deployment and recovery procedures with no autonomous deployment or rollback authority.

- [ ] **Step 1: Write RED runbook contract**

Assert the four documents exist and contain the safety-critical commands/phrases:

```ts
expect(staging).toContain('prisma migrate deploy');
expect(staging).toContain('/health/live');
expect(staging).toContain('/health/ready');
expect(backup).toContain('pg_dump');
expect(backup).toContain('pg_restore');
expect(rollback).toContain('previous known-good');
expect(acceptance).toContain('PR_CREATED != DEPLOYED != VERIFIED');
```

- [ ] **Step 2: Run RED**

Run:
```bash
npx vitest run tests/unit/release-01-runbooks.contract.test.ts
```
Expected: FAIL because the runbooks do not exist.

- [ ] **Step 3: Write the staging deployment runbook**

Document exact order and commands, parameterized by operator-set environment variables rather than secrets in source:

```bash
export RELEASE_SHA='<exact-git-sha>'
docker build --target runtime -t "seogeo:${RELEASE_SHA}" .
docker build --target migration -t "seogeo-migration:${RELEASE_SHA}" .
# create/record backup first
docker run --rm --env-file /secure/path/staging.env "seogeo-migration:${RELEASE_SHA}"
# start/update Web with: npm start
# start/update Worker with: npm run start:worker
curl -fsS "${STAGING_BASE_URL}/health/live"
curl -fsS "${STAGING_BASE_URL}/health/ready"
```

The document must require HTTPS, exact SHA recording, `TRUST_PROXY_HOPS` matching topology, production fail-fast configuration, Web/Worker separate processes, and no Production action.

- [ ] **Step 4: Write backup/restore runbook**

Use environment variables so credentials are not echoed into documentation:

```bash
pg_dump --format=custom --no-owner --file="${BACKUP_FILE}" "${DATABASE_URL}"
pg_restore --clean --if-exists --no-owner --dbname="${RESTORE_DATABASE_URL}" "${BACKUP_FILE}"
```

Require restore drill against a non-production target and record backup identifier + candidate SHA. State clearly that Prisma down-migrations are not generated automatically.

- [ ] **Step 5: Write application rollback runbook**

Define rollback as redeploying the previous known-good immutable SHA/image for both Web and Worker. If DB compatibility prevents application rollback, stop traffic/change rollout and use operator-reviewed restore or forward-fix migration. Explicitly prohibit DeepSeek, queues, or optimization logic from initiating rollback.

- [ ] **Step 6: Write the 25-item staging acceptance checklist**

Copy the design’s 25 gates exactly enough that each item can be marked with candidate SHA, timestamp, evidence link/result, and PASS/FAIL. A provider credential that is intentionally absent must be recorded as not-configured/not-sampled, never as a fabricated pass.

- [ ] **Step 7: Run runbook and full doc-adjacent verification**

Run:
```bash
npx vitest run tests/unit/release-01-runbooks.contract.test.ts
npm run typecheck
```
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add docs/development/release-01-staging-runbook.md docs/development/release-01-backup-restore.md docs/development/release-01-rollback.md docs/development/release-01-staging-acceptance.md tests/unit/release-01-runbooks.contract.test.ts
git commit -m "docs: add Release-01 staging operations runbooks"
```

---

### Task 8: Exact-head Release-01 repository verification and staging handoff

**Files:**
- Modify: `docs/development/release-01-staging-acceptance.md` only to record repository-side evidence that actually exists.
- Update: Draft PR #173 metadata/body to reflect implementation scope.

**Interfaces:**
- Consumes: exact PR head SHA and GitHub Actions results.
- Produces: repository-side evidence that the candidate is **STAGING DEPLOYABLE**. It must not claim **STAGING READY** until the external staging target completes all 25 acceptance gates.

- [ ] **Step 1: Run the complete local repository suite before pushing the final implementation head**

Run:
```bash
npx prisma validate
npx prisma generate
npm run typecheck
npm test
npm run build
```
Expected: PASS.

- [ ] **Step 2: Inspect the exact branch diff**

Verify no Prisma schema/feature migration, P11 feature, provider semantics, UI redesign, autonomous deployment/rollback, or default-branch direct write was introduced. The intended diff is limited to runtime/env/proxy/process/packaging/CI/tests/runbooks and the already-approved design/plan documents.

- [ ] **Step 3: Update PR #173 title/body without merging**

Set title to:

`chore: prepare Release-01 staging runtime`

Body must identify:
- exact base and current head;
- Web/Worker/Migration roles;
- production env fail-fast;
- trusted proxy/HTTPS contract;
- Docker packaging and CI artifact gate;
- staging/backup/restore/rollback runbooks;
- explicit no-P11/no-Production/no-authority-expansion boundary.

Keep the PR Draft until exact-head CI is green.

- [ ] **Step 4: Obtain exact-head GitHub Actions evidence**

Require all jobs on the exact head to complete successfully:
- `verify`
- `production-audit`
- `e2e`
- `deployment-artifact`

If any job fails, use the failing log as the next RED evidence, make the smallest correction, and rerun exact-head CI. Do not declare success from a superseded SHA.

- [ ] **Step 5: Record repository-side evidence**

In `release-01-staging-acceptance.md`, record the exact candidate SHA and CI run links/IDs/results for the repository gates only. Leave external HTTPS, real staging service, provider, queue restart, backup/restore drill, and rollback-drill items unpassed until actually exercised against Staging.

- [ ] **Step 6: Final boundary check**

The repository-side terminal state is:

`STAGING DEPLOYABLE — external staging acceptance pending`

Do **not** write `STAGING READY` unless all 25 staging gates have real evidence. Do **not** Production deploy. Do **not** start P11.

---

## Plan Self-Review

### Spec coverage

- Web/Worker separation: Tasks 3-4.
- Migration role: Tasks 5 and 7.
- Production fail-fast environment contract: Task 1.
- Trusted reverse proxy and HTTPS Origin preservation: Task 2 plus real staging gate in Task 8.
- Existing health/readiness semantics: Task 7; no new public Worker health endpoint.
- Repeatable deployment artifact: Tasks 5-6.
- Minimum logging/startup/shutdown visibility: Tasks 3-4.
- Backup/restore/application rollback: Task 7.
- 25-item staging acceptance: Task 7, evidence gating Task 8.
- Existing CI verify/audit/e2e preserved: Tasks 6 and 8.
- No P11, Production, authority expansion, automatic rollback, Kubernetes, autoscaling, full observability, or schema expansion: Global Constraints + Task 8 diff review.

### Placeholder scan

This plan contains no implementation placeholders such as TBD/TODO/“implement later”. Commands, file paths, required interfaces, expected RED failures, GREEN verification, and terminal state are explicit.

### Type/interface consistency

- `parseEnv(process.env)` preserves the existing exported `env` singleton while adding a testable parser.
- `TRUST_PROXY_HOPS` flows from Task 1 into `configureTrustProxy()` in Task 2.
- Web lifecycle remains `http.Server`-based and never depends on Worker runtime.
- Worker lifecycle consumes the existing `startWorkers(): Promise<{ close(): Promise<void> }>` contract already returned by `worker-bootstrap.ts`.
- Both Web and Worker use the same `runtime` image; Migration uses the dedicated `migration` target because Prisma CLI is intentionally absent from deployable runtime dependencies.
- Task 8 distinguishes repository-side `STAGING DEPLOYABLE` from external `STAGING READY` and from `PRODUCTION DEPLOYED`.
