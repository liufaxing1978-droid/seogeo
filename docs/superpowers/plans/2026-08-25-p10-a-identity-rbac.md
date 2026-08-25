# P10-A Identity and RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add application-native users, secure server-side sessions, project membership/RBAC, CSRF protection, trusted actor propagation, and project-scoped authorization without expanding any P7/P8/P9 domain authority.

**Architecture:** Keep identity, session, CSRF, membership, capability policy, audit, and rate limiting as separate modules under `src/auth` and `src/modules/projects`. `createApp()` performs only composition. Every project request resolves trusted authentication first, then active membership/capability, then the existing plan feature gate and domain command. P9-F consumes authenticated `User.id` as its server actor and retains all existing authority-field restrictions.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Express 5, EJS, Prisma 6/PostgreSQL 17, Redis 7/ioredis, Vitest 3, Supertest, Playwright Chromium.

**Spec:** `docs/superpowers/specs/2026-08-25-p10-a-identity-rbac-design.md`

## Global Constraints

- Base is `main@60733718026b1876340d50ff8626fcd8cd1558f5` on branch `feat/p10-a-identity-rbac`.
- Authentication source is local email + password plus database-backed opaque sessions; no public signup, OAuth login, magic link, MFA, API key, organization RBAC, or invitation email in P10-A.
- Passwords use Node `crypto.scrypt` with V1 parameters `N=32768`, `r=8`, `p=1`, 32-byte random salt, 64-byte derived key; malformed hashes fail closed.
- Session lifetime is seven-day absolute expiry with no sliding refresh and no request-time `lastSeenAt` writes.
- Production session cookie is `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`; only a SHA-256 digest of the raw token is stored.
- `SESSION_SECRET` must be at least 32 characters in production; development/test may use an explicit local default.
- Unsafe cookie-authenticated methods `POST|PUT|PATCH|DELETE` require CSRF before domain side effects; login uses same-origin validation and rate limiting because it is unauthenticated.
- Global identity comes only from validated server session state; never from client `actorId`, user/role headers, query parameters, or request body identity fields.
- Project roles are `OWNER | ADMIN | OPERATOR | VIEWER`; membership status is `ACTIVE | REVOKED`.
- Every normal project must retain at least one ACTIVE OWNER; membership commands use a project-row lock to serialize owner-changing operations.
- Role capability, PlanLevel feature gates, and P7/P8/P9 domain authority remain separate checks.
- P9-C automation remains exact LOW + `CREATE_CONTENT_PAGE`; no auto Merge, Deploy, Rollback, writable global kill switch, fake human approval, or P8 verification bypass is added.
- P9-F GET/SSR persisted-read purity must remain request-write-free, including authentication/session handling.
- No `NODE_ENV=test` authentication bypass, hard-coded actor, or fallback production admin is allowed. Tests create explicit User/Session/Membership fixtures.
- Merge requires separate explicit human authorization. Deployment requires another separate explicit human authorization.

---

## File Structure Map

Create these focused modules:

```text
prisma/models/identity.prisma
prisma/migrations/20260825130000_add_p10a_identity_rbac/migration.sql
src/auth/email.ts
src/auth/password.ts
src/auth/session.repository.ts
src/auth/authentication.ts
src/auth/csrf.ts
src/auth/login-attempt-limiter.ts
src/auth/security-audit.repository.ts
src/auth/project-capabilities.ts
src/auth/project-access.ts
src/auth/auth.routes.ts
src/types/express.d.ts
src/modules/projects/project-membership.repository.ts
src/modules/projects/project-membership.service.ts
src/modules/projects/project-membership.routes.ts
scripts/auth-admin.ts
tests/helpers/auth-fixture.ts
tests/unit/auth.email.test.ts
tests/unit/auth.password.test.ts
tests/unit/auth.csrf.test.ts
tests/unit/auth.project-capabilities.test.ts
tests/unit/auth.login-attempt-limiter.test.ts
tests/integration/auth.session.test.ts
tests/integration/auth.routes.test.ts
tests/integration/project-membership.test.ts
tests/integration/project-authorization.test.ts
tests/integration/p10a-authority-boundary.test.ts
tests/e2e/auth-rbac.spec.ts
docs/development/p10-a-identity-rbac.md
```

Modify existing composition/domain files only where required:

```text
prisma/schema.prisma
src/config/env.ts
src/app.ts
src/auth/require-feature.ts
src/modules/projects/project.repository.ts
src/modules/projects/project.service.ts
src/modules/projects/project.types.ts
src/modules/projects/project.routes.ts
src/modules/optimization-operations/operations.routes.ts
src/modules/optimization-operations/operations.web.routes.ts
src/modules/search-console/search-console.routes.ts
src/web/routes.ts
package.json
.github/workflows/ci.yml
tests/e2e/projects.spec.ts
tests/e2e/dashboard.spec.ts
```

The remaining route modules mounted by `src/app.ts` are changed in Task 10 only to add the shared authorization guards appropriate to their existing read/mutation operations; do not refactor their domain implementations.

---

### Task 1: Identity Schema, Email Normalization, Password Hashing, and Production Secret Contract

**Files:**
- Create: `prisma/models/identity.prisma`
- Create: `prisma/migrations/20260825130000_add_p10a_identity_rbac/migration.sql`
- Create: `src/auth/email.ts`
- Create: `src/auth/password.ts`
- Modify: `prisma/schema.prisma`
- Modify: `src/config/env.ts`
- Test: `tests/unit/auth.email.test.ts`
- Test: `tests/unit/auth.password.test.ts`

**Interfaces:**
- Produces: `normalizeEmail(email: string): string`
- Produces: `PasswordHasher` with `hash(password: string): Promise<string>` and `verify(password: string, encoded: string): Promise<boolean>`
- Produces Prisma models/enums: `User`, `UserSession`, `ProjectMembership`, `SecurityAuditEvent`, `UserStatus`, `ProjectRole`, `MembershipStatus`, `SecurityAuditEventType`

- [ ] **Step 1: Write RED tests for normalized email and password format**

```ts
expect(normalizeEmail('  Owner@Example.COM ')).toBe('owner@example.com');
expect(normalizeEmail('a+b@example.com')).toBe('a+b@example.com');

const encoded = await passwordHasher.hash('correct horse battery staple');
expect(encoded).toMatch(/^scrypt\$1\$32768\$8\$1\$/);
expect(await passwordHasher.verify('correct horse battery staple', encoded)).toBe(true);
expect(await passwordHasher.verify('wrong', encoded)).toBe(false);
expect(await passwordHasher.verify('x', 'broken-format')).toBe(false);
```

- [ ] **Step 2: Run focused RED tests**

Run:

```bash
npx vitest run tests/unit/auth.email.test.ts tests/unit/auth.password.test.ts
```

Expected: FAIL because `src/auth/email.ts` and `src/auth/password.ts` do not exist.

- [ ] **Step 3: Add identity Prisma model and additive SQL migration**

Use this schema shape:

```prisma
enum UserStatus { ACTIVE DISABLED }
enum ProjectRole { OWNER ADMIN OPERATOR VIEWER }
enum MembershipStatus { ACTIVE REVOKED }
enum SecurityAuditEventType {
  USER_PROVISIONED USER_DISABLED USER_ENABLED
  SESSION_CREATED SESSION_REVOKED SESSIONS_REVOKED_ALL
  MEMBERSHIP_CREATED MEMBERSHIP_REACTIVATED MEMBERSHIP_ROLE_CHANGED MEMBERSHIP_REVOKED
}

model User {
  id                  String        @id @default(uuid()) @db.Uuid
  email               String
  normalizedEmail     String        @unique
  displayName         String?
  passwordHash        String
  passwordHashVersion Int           @default(1)
  status              UserStatus    @default(ACTIVE)
  createdAt           DateTime      @default(now())
  updatedAt           DateTime      @updatedAt
  sessions            UserSession[]
  memberships         ProjectMembership[]
}

model UserSession {
  id        String   @id @default(uuid()) @db.Uuid
  userId    String   @db.Uuid
  tokenHash String   @unique
  createdAt DateTime @default(now())
  expiresAt DateTime
  revokedAt DateTime?
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId, expiresAt])
}

model ProjectMembership {
  id        String           @id @default(uuid()) @db.Uuid
  projectId String           @db.Uuid
  userId    String           @db.Uuid
  role      ProjectRole
  status    MembershipStatus @default(ACTIVE)
  createdAt DateTime         @default(now())
  updatedAt DateTime         @updatedAt
  project   Project          @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user      User             @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@unique([projectId, userId])
  @@index([userId, status])
  @@index([projectId, status, role])
}

model SecurityAuditEvent {
  id           String                 @id @default(uuid()) @db.Uuid
  eventType    SecurityAuditEventType
  actorUserId  String?                @db.Uuid
  targetUserId String?                @db.Uuid
  projectId    String?                @db.Uuid
  roleBefore   ProjectRole?
  roleAfter    ProjectRole?
  createdAt    DateTime               @default(now())
  @@index([projectId, createdAt])
  @@index([targetUserId, createdAt])
}
```

Add `memberships ProjectMembership[]` to `Project` in `prisma/schema.prisma`. The SQL migration must be additive only and contain no rewrite/delete of P7/P8/P9 tables.

- [ ] **Step 4: Implement normalization, scrypt format, and production secret validation**

Use `scrypt` with explicit `maxmem: 64 * 1024 * 1024` and `timingSafeEqual`. Encoded format:

```text
scrypt$1$32768$8$1$<base64url-salt>$<base64url-derived-key>
```

In `src/config/env.ts`, parse `SESSION_SECRET` with existing development/test default but add a post-parse production assertion:

```ts
if (parsed.NODE_ENV === 'production' && parsed.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters in production');
}
```

- [ ] **Step 5: Verify Prisma and focused GREEN tests**

Run:

```bash
npx prisma validate
npx prisma generate
npx vitest run tests/unit/auth.email.test.ts tests/unit/auth.password.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add prisma src/auth/email.ts src/auth/password.ts src/config/env.ts tests/unit/auth.email.test.ts tests/unit/auth.password.test.ts
git commit -m "feat: add P10-A identity foundation"
```

---

### Task 2: Session Persistence, Trusted Request Authentication, and Test Fixture

**Files:**
- Create: `src/auth/session.repository.ts`
- Create: `src/auth/authentication.ts`
- Create: `src/types/express.d.ts`
- Create: `tests/helpers/auth-fixture.ts`
- Create: `tests/integration/auth.session.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Produces: `SESSION_COOKIE_NAME = 'seogeo_session'`
- Produces: `createSessionToken(): { rawToken: string; tokenHash: string }`
- Produces: `SessionRepository.create/findActiveByTokenHash/revoke/revokeAllForUser`
- Produces: `AuthenticatedActor { userId: string; sessionId: string }`
- Produces: `authenticationMiddleware: RequestHandler`
- Produces: `requireAuthentication(): RequestHandler`
- Produces test helper `seedAuthenticatedUser(options): Promise<{ user; project?; membership?; cookie; csrfToken }>`

- [ ] **Step 1: Write RED session integration contracts**

```ts
const session = await seedSession({ userStatus: 'ACTIVE', expiresAt: future });
const res = await request(createApp()).get('/auth/session').set('Cookie', session.cookie);
expect(res.status).toBe(200);

await prisma.userSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
const revoked = await request(createApp()).get('/auth/session').set('Cookie', session.cookie);
expect(revoked.status).toBe(401);
```

Add a purity assertion that snapshots the `UserSession` row before/after authenticated GET and expects byte-for-byte relevant fields unchanged.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/integration/auth.session.test.ts
```

Expected: FAIL because session repository/middleware/routes are absent.

- [ ] **Step 3: Implement opaque token + read-only resolver**

`createSessionToken()` generates 32 random bytes base64url and SHA-256 digests the raw token. `authenticationMiddleware` parses only `seogeo_session`, looks up one active session with ACTIVE user, sets:

```ts
req.auth = { userId: row.userId, sessionId: row.id };
res.locals.auth = req.auth;
res.locals.authSessionTokenHash = row.tokenHash;
```

Invalid/missing cookie sets both auth values to null and performs no write.

- [ ] **Step 4: Add explicit test fixture instead of auth bypass**

`tests/helpers/auth-fixture.ts` must create actual Prisma User/Session/Membership rows and return a real cookie. It may accept role/plan/status parameters but never alter production middleware behavior.

- [ ] **Step 5: Run focused GREEN and request-write purity test**

```bash
npx vitest run tests/integration/auth.session.test.ts
npm run typecheck
```

Expected: PASS, including zero `UserSession` update on GET.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/auth/session.repository.ts src/auth/authentication.ts src/types/express.d.ts src/app.ts tests/helpers/auth-fixture.ts tests/integration/auth.session.test.ts
git commit -m "feat: add server-side authentication sessions"
```

---

### Task 3: CSRF and Login Rate Limiter

**Files:**
- Create: `src/auth/csrf.ts`
- Create: `src/auth/login-attempt-limiter.ts`
- Create: `tests/unit/auth.csrf.test.ts`
- Create: `tests/unit/auth.login-attempt-limiter.test.ts`

**Interfaces:**
- Produces: `deriveCsrfToken(secret, sessionId, tokenHash): string`
- Produces: `requireCsrf(): RequestHandler`
- Produces: `LoginAttemptLimiter` with `assertAllowed(key)`, `recordFailure(key)`, `clear(key)`
- Produces: `RedisLoginAttemptLimiter` using an injected `Redis`
- Produces: `loginLimiterKey(normalizedEmail, sourceIp): string`

- [ ] **Step 1: Write RED crypto and limiter tests**

```ts
const token = deriveCsrfToken('s'.repeat(32), 'session-id', 'a'.repeat(64));
expect(verifyCsrfToken(token, token)).toBe(true);
expect(verifyCsrfToken(token, token + 'x')).toBe(false);

for (let i = 0; i < 10; i++) await limiter.recordFailure(key);
await expect(limiter.assertAllowed(key)).rejects.toMatchObject({ code: 'LOGIN_RATE_LIMITED' });
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/unit/auth.csrf.test.ts tests/unit/auth.login-attempt-limiter.test.ts
```

Expected: FAIL on missing modules.

- [ ] **Step 3: Implement CSRF HMAC and constant-time verification**

Derive HMAC-SHA256 over canonical UTF-8 `sessionId + "\n" + tokenHash`; read submitted token from `X-CSRF-Token` or `_csrf` form field. Missing auth/token returns `CSRF_INVALID` 403 before next middleware.

- [ ] **Step 4: Implement Redis limiter fail-closed semantics**

Hash `normalizedEmail + "\n" + sourceIp` with SHA-256 for the Redis key. Use one Lua script for atomic `INCR` + first-write `EXPIRE 900`; block when current failures are >= 10. Convert Redis errors to `AUTH_RATE_LIMITER_UNAVAILABLE` 503.

- [ ] **Step 5: Run GREEN**

```bash
npx vitest run tests/unit/auth.csrf.test.ts tests/unit/auth.login-attempt-limiter.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/auth/csrf.ts src/auth/login-attempt-limiter.ts tests/unit/auth.csrf.test.ts tests/unit/auth.login-attempt-limiter.test.ts
git commit -m "feat: add CSRF and login throttling"
```

---

### Task 4: Login, Logout, Session, and Password-Change HTTP Surface

**Files:**
- Create: `src/auth/auth.routes.ts`
- Create: `src/views/auth/login.ejs`
- Create: `tests/integration/auth.routes.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Routes: `GET /auth/login`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/session`, `POST /auth/password/change`
- Consumes: Task 1 `PasswordHasher`, Task 2 `SessionRepository/authenticationMiddleware`, Task 3 `requireCsrf/LoginAttemptLimiter`

- [ ] **Step 1: Write RED route tests**

Cover exact public semantics:

```ts
expect((await postLogin('missing@example.com', 'wrong')).body.error.code).toBe('INVALID_CREDENTIALS');
expect((await postLogin(validEmail, 'wrong')).body.error.code).toBe('INVALID_CREDENTIALS');
expect(success.headers['set-cookie'][0]).toContain('HttpOnly');
```

Also assert: external `Origin` fails before password verification; logout without CSRF is 403; password change revokes every active session; disabled user cannot log in.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/integration/auth.routes.test.ts
```

Expected: FAIL because auth routes do not exist.

- [ ] **Step 3: Implement route service dependencies and cookie handling**

Login flow is strictly:

```text
normalize email
→ same-origin check
→ limiter.assertAllowed
→ find ACTIVE user
→ passwordHasher.verify
→ on failure limiter.recordFailure + INVALID_CREDENTIALS
→ limiter.clear
→ create fresh session
→ set cookie
```

Use the same public `INVALID_CREDENTIALS` response for unknown email, wrong password, and disabled user. Session endpoint returns bounded `{ user: { id, email, displayName }, session: { id, expiresAt }, csrfToken }` and never tokenHash/password fields.

- [ ] **Step 4: Implement logout/password change mutations**

Both require `requireAuthentication()` then `requireCsrf()`. Password change verifies current password, writes new hash/version and revokes all sessions in one transaction; clear the current browser cookie afterward.

- [ ] **Step 5: Run GREEN**

```bash
npx vitest run tests/integration/auth.routes.test.ts tests/integration/auth.session.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

```bash
git add src/auth/auth.routes.ts src/views/auth/login.ejs src/app.ts tests/integration/auth.routes.test.ts
git commit -m "feat: add local authentication routes"
```

---

### Task 5: Append-Only Security Audit and Server-Operator CLI

**Files:**
- Create: `src/auth/security-audit.repository.ts`
- Create: `scripts/auth-admin.ts`
- Modify: `package.json`
- Test: `tests/integration/auth.admin-cli.test.ts`

**Interfaces:**
- Produces: `SecurityAuditRepository.append(event)`; no update/delete methods
- CLI commands: `bootstrap-owner`, `provision-user`, `disable-user`, `enable-user`
- Package command: `npm run auth:admin -- <command> <email>`

- [ ] **Step 1: Write RED CLI/service tests using exported command functions**

Assert:

```text
bootstrap-owner with zero users → creates ACTIVE user + OWNER on every existing project
bootstrap-owner with >=1 user → fails with no writes
provision-user → user only, no project membership
disable-user → status DISABLED + all sessions revoked + USER_DISABLED audit
enable-user → status ACTIVE + USER_ENABLED audit
```

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/integration/auth.admin-cli.test.ts
```

Expected: FAIL on missing CLI/audit modules.

- [ ] **Step 3: Implement append-only audit repository and transactional commands**

Export pure command functions from `scripts/auth-admin.ts` and keep only argument/TTY wiring in the executable tail. Password input must come from stdin/TTY and never `process.argv`; mask interactive characters while reading and request confirmation before hashing.

- [ ] **Step 4: Add package script**

```json
"auth:admin": "tsx scripts/auth-admin.ts"
```

Do not add startup-time bootstrap logic to `src/server.ts`.

- [ ] **Step 5: Run GREEN**

```bash
npx vitest run tests/integration/auth.admin-cli.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/auth/security-audit.repository.ts scripts/auth-admin.ts package.json tests/integration/auth.admin-cli.test.ts
git commit -m "feat: add identity bootstrap and audit"
```

---

### Task 6: Central Project Capabilities and Membership-Aware Middleware

**Files:**
- Create: `src/auth/project-capabilities.ts`
- Create: `src/auth/project-access.ts`
- Create: `tests/unit/auth.project-capabilities.test.ts`
- Create: `tests/integration/project-authorization.test.ts`
- Modify: `src/auth/require-feature.ts`

**Interfaces:**
- Produces `ProjectCapability` union exactly:

```text
PROJECT_READ
PROJECT_SETTINGS_WRITE
PROJECT_MEMBER_READ
PROJECT_MEMBER_MANAGE_BASIC
PROJECT_MEMBER_MANAGE_ALL
CRAWL_RUN
SEO_RUN
GEO_RUN
AI_RUN
CONTENT_WRITE
PUBLICATION_PREPARE
PUBLICATION_EXECUTE
DISTRIBUTION_EXECUTE
OPTIMIZATION_RUN
AUTOPILOT_POLICY_REVISE
EXPERIMENT_READ
FEEDBACK_READ
```

- Produces `hasProjectCapability(role, capability): boolean`
- Produces `requireProjectMembership(): RequestHandler`
- Produces `requireProjectCapability(capability): RequestHandler`
- Produces `assertProjectCapability(userId, projectId, capability)` for resource-ID routes after minimal project resolution

- [ ] **Step 1: Write RED role matrix tests**

Explicitly assert VIEWER has no mutation capability; OPERATOR has operational capabilities but no project settings/member management; ADMIN can manage VIEWER/OPERATOR but not ADMIN/OWNER; OWNER has manage-all but no special domain bypass flag.

- [ ] **Step 2: Write RED HTTP non-enumeration tests**

Use two users/projects and assert user A requesting user B project gets `404 PROJECT_NOT_FOUND`; valid member with insufficient capability gets `403 PROJECT_CAPABILITY_REQUIRED`.

- [ ] **Step 3: Implement central capability table and access repository**

Do not use numeric role ordering for authorization. Use explicit immutable `Set<ProjectCapability>` values per role.

- [ ] **Step 4: Modify `requireFeature()` to reuse `res.locals.project`**

Behavior:

```ts
const project = res.locals.project ?? await projectService.get(projectId);
```

Keep the existing compatibility lookup when project membership middleware has not populated locals yet.

- [ ] **Step 5: Run GREEN**

```bash
npx vitest run tests/unit/auth.project-capabilities.test.ts tests/integration/project-authorization.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/auth/project-capabilities.ts src/auth/project-access.ts src/auth/require-feature.ts tests/unit/auth.project-capabilities.test.ts tests/integration/project-authorization.test.ts
git commit -m "feat: add project RBAC middleware"
```

---

### Task 7: Project Membership Commands, Last-Owner Invariant, and Membership API

**Files:**
- Create: `src/modules/projects/project-membership.repository.ts`
- Create: `src/modules/projects/project-membership.service.ts`
- Create: `src/modules/projects/project-membership.routes.ts`
- Create: `tests/integration/project-membership.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- Routes: `GET|POST /api/projects/:projectId/members`, `PATCH|DELETE /api/projects/:projectId/members/:membershipId`
- `POST` accepts `{ email, role }`; `PATCH` accepts `{ role }`; DELETE logically sets REVOKED
- Every role-changing/revoking transaction acquires project lock using `SELECT id FROM "Project" WHERE id = $1 FOR UPDATE`

- [ ] **Step 1: Write RED service/API tests**

Cover create/reactivate, ADMIN target restrictions, OWNER manage-all, disabled/missing `USER_NOT_AVAILABLE`, cross-project membership id hiding, and last-owner demotion/revoke rejection with `409 LAST_PROJECT_OWNER_REQUIRED`.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/integration/project-membership.test.ts
```

Expected: FAIL because membership service/routes do not exist.

- [ ] **Step 3: Implement repository and transactional invariant**

All owner-count-sensitive changes lock the Project row first, re-read ACTIVE OWNER count inside the same transaction, and reject any resulting zero-owner state. Do not rely on UI checks.

- [ ] **Step 4: Implement route authorization**

```text
GET    → requireAuthentication → membership → PROJECT_MEMBER_READ
POST   → requireAuthentication → CSRF → membership → BASIC or ALL target-policy validation
PATCH  → requireAuthentication → CSRF → membership → BASIC or ALL target-policy validation
DELETE → requireAuthentication → CSRF → membership → BASIC or ALL target-policy validation
```

VIEWER receives no `PROJECT_MEMBER_READ`; ADMIN/OWNER do.

- [ ] **Step 5: Run GREEN**

```bash
npx vitest run tests/integration/project-membership.test.ts tests/integration/project-authorization.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 7**

```bash
git add src/modules/projects/project-membership.* src/app.ts tests/integration/project-membership.test.ts
git commit -m "feat: add project memberships"
```

---

### Task 8: Make Project Creation, Listing, Detail, Dashboard, and Update Membership-Scoped

**Files:**
- Modify: `src/modules/projects/project.repository.ts`
- Modify: `src/modules/projects/project.types.ts`
- Modify: `src/modules/projects/project.service.ts`
- Modify: `src/modules/projects/project.routes.ts`
- Modify: `src/web/routes.ts`
- Modify: `src/web/dashboard.repository.ts`
- Modify: `tests/e2e/projects.spec.ts`
- Modify: `tests/e2e/dashboard.spec.ts`
- Test: `tests/integration/projects.auth.test.ts`

**Interfaces:**
- `ProjectService.createForOwner(userId, input)` creates Project + OWNER membership atomically
- `ProjectService.listForUser(userId)` returns only ACTIVE memberships
- `GET /api/projects` requires authentication
- `GET /api/projects/:id` requires `PROJECT_READ`
- `PATCH /api/projects/:id` requires CSRF + `PROJECT_SETTINGS_WRITE`

- [ ] **Step 1: Write RED API tests**

Assert anonymous list/create/get/update reject; creation always creates OWNER; project+membership rollback together on forced membership failure; list excludes non-members and revoked memberships.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/integration/projects.auth.test.ts
```

Expected: FAIL on current unscoped project repository/service.

- [ ] **Step 3: Implement transactional project command and membership-scoped list**

Use `prisma.$transaction` for `project.create` + `projectMembership.create`. Replace unscoped `findMany` with relation-filtered query:

```ts
where: { memberships: { some: { userId, status: 'ACTIVE' } } }
```

- [ ] **Step 4: Protect web project pages and portfolio**

`/`, `/projects`, `/projects/new`, POST `/projects`, and `/projects/:id` require authentication; portfolio/dashboard queries accept the authenticated user id and cannot return projects outside ACTIVE memberships. Add CSRF hidden input to project-create form.

- [ ] **Step 5: Update Playwright setup in affected specs**

Each browser spec creates/logs in an explicit fixture user, creates membership for directly seeded projects, and uses CSRF-aware project creation. Do not add a global browser auth bypass.

- [ ] **Step 6: Run GREEN**

```bash
npx vitest run tests/integration/projects.auth.test.ts
npx playwright test tests/e2e/projects.spec.ts tests/e2e/dashboard.spec.ts --project=chromium
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 8**

```bash
git add src/modules/projects src/web tests/integration/projects.auth.test.ts tests/e2e/projects.spec.ts tests/e2e/dashboard.spec.ts
git commit -m "feat: scope projects to memberships"
```

---

### Task 9: Roll Trusted Authentication into P9-F Operations Center

**Files:**
- Modify: `src/modules/optimization-operations/operations.routes.ts`
- Modify: `src/modules/optimization-operations/operations.web.routes.ts`
- Modify: `src/app.ts`
- Test: `tests/integration/p10a-operations-auth.test.ts`

**Interfaces:**
- Production `OperationsActorResolver.resolve(req)` returns `{ actorId: req.auth.userId }` only after project RBAC gate has passed
- Operations reads require authenticated membership + `PROJECT_READ` + existing `OPTIMIZATION_OPERATIONS_CENTER`
- Policy revision requires CSRF + `AUTOPILOT_POLICY_REVISE` + feature gate

- [ ] **Step 1: Write RED P9-F authorization tests**

Assert VIEWER Advanced can read but cannot revise; OPERATOR Advanced can revise; OPERATOR Standard receives feature denial; OWNER Standard still receives feature denial; submitted `actorId/allowedRiskClass/allowedOperationClasses` remains rejected before command; persisted revision actor equals authenticated User.id.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/integration/p10a-operations-auth.test.ts
```

Expected: FAIL because current P9-F only checks feature + actor presence.

- [ ] **Step 3: Add explicit guards before current P9-F logic**

Do not change `PolicyRevisionCommand` domain semantics. Preserve `containsForbiddenPolicyMutationField`, optimistic concurrency, idempotency, immutable revision, and LOW/CREATE_CONTENT_PAGE lock.

- [ ] **Step 4: Replace SSR `policyMutationAvailable` computation**

Compute only from server facts:

```ts
policyMutationAvailable =
  hasProjectCapability(res.locals.membership.role, 'AUTOPILOT_POLICY_REVISE')
  && hasFeature(res.locals.project.planLevel, 'OPTIMIZATION_OPERATIONS_CENTER');
```

Render CSRF token only for an authenticated session and never render tokenHash.

- [ ] **Step 5: Prove P9-F GET purity remains unchanged**

Snapshot UserSession and policy/audit tables before/after Operations GET and assert no authentication/session/audit write occurs.

- [ ] **Step 6: Run GREEN and P9-F regression**

```bash
npx vitest run tests/integration/p10a-operations-auth.test.ts tests/integration/optimization-operations*.test.ts tests/unit/optimization-operations*.test.ts
npm run typecheck
```

If shell glob matches no file, run the existing discovered P9-F test filenames returned by `find tests -type f | grep 'operations'`.

- [ ] **Step 7: Commit Task 9**

```bash
git add src/modules/optimization-operations src/app.ts tests/integration/p10a-operations-auth.test.ts
git commit -m "feat: bind P9-F actor to authenticated user"
```

---

### Task 10: Authorize Every Remaining Project-Scoped Read and Mutation Route

**Files:**
- Modify project-scoped route modules already mounted in `src/app.ts`:
  - `src/modules/market/market.routes.ts`
  - `src/modules/crawler/crawl.routes.ts`
  - `src/modules/seo/seo.routes.ts`
  - `src/modules/geo/geo.routes.ts`
  - `src/modules/search-console/search-console.routes.ts`
  - `src/modules/growth/growth.routes.ts`
  - `src/modules/growth/growth-explanation.routes.ts`
  - `src/modules/optimization-feedback/feedback.routes.ts`
  - `src/modules/ai/ai.routes.ts`
  - `src/modules/content/content.routes.ts`
  - `src/modules/competitor/competitor.routes.ts`
  - `src/modules/optimization-orchestration/orchestration.routes.ts`
  - `src/modules/optimization-experiments/experiment.routes.ts`
  - `src/modules/publication/publication.routes.ts`
  - `src/modules/distribution/distribution.routes.ts`
  - `src/modules/reporting/report.routes.ts`
  - `src/modules/visibility/visibility.routes.ts`
  - `src/modules/visibility/visibility-intelligence.routes.ts`
  - `src/modules/visibility/visibility-metrics.routes.ts`
  - `src/modules/visibility/visibility-history.routes.ts`
- Modify corresponding project-scoped web route modules and `src/web/routes.ts`
- Test: `tests/integration/p10a-route-authorization.test.ts`
- Test: `tests/unit/p10a-route-boundary.test.ts`

**Interfaces / capability mapping:**

```text
all persisted project reads                           → PROJECT_READ
market/project connection settings writes            → PROJECT_SETTINGS_WRITE
crawl start/retry                                     → CRAWL_RUN
SEO run/issue mutation                                → SEO_RUN
GEO run                                               → GEO_RUN
AI analysis, visibility sampling, report generation  → AI_RUN
content draft/editor mutation                         → CONTENT_WRITE
publication preparation/approval planning             → PUBLICATION_PREPARE
publication execution/verify commands                 → PUBLICATION_EXECUTE
distribution prepare/publish/manual-result/verify     → DISTRIBUTION_EXECUTE
manual optimization run                               → OPTIMIZATION_RUN
experiment reads                                      → EXPERIMENT_READ
feedback reads                                        → FEEDBACK_READ
```

- [ ] **Step 1: Write a RED static route-boundary inventory**

Create a test that reads the above route source files and requires imports/usages of shared project access guards for every route containing `:projectId` or `:id` project scope and CSRF on unsafe methods. Add explicit resource-ID cases for `/crawls/:crawlId`, `/pages/:pageId`, `/seo/issues/:issueId`, AI task ids, publication/distribution ids: resolve the owning project id before rendering/mutating, then call `assertProjectCapability`.

- [ ] **Step 2: Write RED HTTP side-effect tests for representative modules**

For CRAWL, AI, publication, distribution, optimization manual run, and Search Console, inject fake services whose methods increment counters. Assert anonymous/VIEWER/missing-CSRF requests are rejected and counters remain zero.

- [ ] **Step 3: Apply read guards without changing domain logic**

Add `requireAuthentication`, membership/project resolution and the mapped read capability before repository/service calls that expose protected data.

- [ ] **Step 4: Apply mutation guards and CSRF**

Every cookie-authenticated unsafe route must run CSRF before queue/provider/AI/Git/domain command. Preserve existing PlanLevel/domain gates after human RBAC.

- [ ] **Step 5: Fix Search Console OAuth actor and callback binding**

Replace current `actorId = project-api:${projectId}` with authenticated `req.auth.userId` at `/oauth/start`. On callback, consume the stored nonce and require the current authenticated user id to equal the nonce actor before credential materialization; mismatch returns a bounded authorization error before provider credential write. Preserve existing state TTL/single-use behavior.

- [ ] **Step 6: Run focused route suite and full unit/integration regression**

```bash
npx vitest run tests/unit/p10a-route-boundary.test.ts tests/integration/p10a-route-authorization.test.ts
npm test
npm run typecheck
```

Expected: PASS. Inspect negative DB/authorization logs; do not describe logs as globally clean.

- [ ] **Step 7: Commit Task 10**

```bash
git add src/modules src/web src/app.ts tests/unit/p10a-route-boundary.test.ts tests/integration/p10a-route-authorization.test.ts
git commit -m "feat: enforce project authorization across routes"
```

---

### Task 11: P9/P8 Authority Regression and Forbidden-Write Static Gate

**Files:**
- Create: `tests/integration/p10a-authority-boundary.test.ts`
- Create: `tests/unit/p10a-authority-static.test.ts`

**Interfaces:**
- No new production interface; this task freezes the cross-phase authority contract.

- [ ] **Step 1: Write authority integration assertions**

With an authenticated OWNER and OPERATOR, prove:

```text
MEDIUM/HIGH autopilot is still impossible
operation class other than CREATE_CONTENT_PAGE is still impossible
human RBAC cannot synthesize P8 approval
P9-C still has no direct Git mutation
P8 VERIFIED cannot be forced by role
no automatic merge/deploy/rollback command is exposed
global autopilot kill switch has no write route
client actor fields remain forbidden
```

- [ ] **Step 2: Write static forbidden-import/route scan**

Scan P10-A/auth/membership modules and reject imports/calls that provide Git merge/deploy/rollback, P7 score mutation, P8 verification mutation, or global kill-switch write authority. Also reject production-source reads of `X-User-Id`, `X-Actor-Id`, `body.actorId` as authentication sources.

- [ ] **Step 3: Run RED against any uncovered leak, then minimal GREEN**

```bash
npx vitest run tests/integration/p10a-authority-boundary.test.ts tests/unit/p10a-authority-static.test.ts
```

If a test identifies a real boundary leak, fix only that leak and rerun until PASS.

- [ ] **Step 4: Run P7→P9 authority regression set plus full Vitest**

```bash
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit Task 11**

```bash
git add tests/integration/p10a-authority-boundary.test.ts tests/unit/p10a-authority-static.test.ts src
git commit -m "test: harden P10-A authority boundaries"
```

---

### Task 12: Browser E2E, Migration Verification, Development Documentation, and Exact-Head Release Gate

**Files:**
- Create: `tests/e2e/auth-rbac.spec.ts`
- Modify existing E2E specs that directly seed projects so each project receives an explicit membership for the logged-in fixture user
- Create: `docs/development/p10-a-identity-rbac.md`
- Modify: `.github/workflows/ci.yml` only if required to seed a test login fixture; do not weaken CI secret policy

**Interfaces:**
- Browser test helper logs in through the real `/auth/login` route and uses returned real session cookie.
- Release gate remains `production-audit`, `e2e`, `verify` on one exact head.

- [ ] **Step 1: Write RED Chromium flows**

`tests/e2e/auth-rbac.spec.ts` must cover:

```text
valid login → only member projects visible
cross-project URL → no project existence leak
VIEWER → allowed read, mutation controls absent
OPERATOR + ADVANCED → P9-F policy control visible and valid CSRF revision succeeds
logout → protected pages inaccessible
```

- [ ] **Step 2: Update existing browser fixtures without bypassing auth**

For each spec that currently calls `prisma.project.create`, create one test user/session or use a shared Playwright setup that provisions a user through server-side test seed code, then create ACTIVE membership rows for the projects used by that spec. Do not globally disable auth in Playwright.

- [ ] **Step 3: Run focused E2E**

```bash
npx playwright test tests/e2e/auth-rbac.spec.ts tests/e2e/projects.spec.ts tests/e2e/dashboard.spec.ts --project=chromium
```

Expected: PASS.

- [ ] **Step 4: Verify both migration paths**

Blank DB:

```bash
DATABASE_URL="$P10A_BLANK_DATABASE_URL" npx prisma migrate deploy
```

Current-P9-shaped DB: restore/prepare a DB migrated through existing P9 migrations, record counts/hashes for P9 immutable/history tables, run `npx prisma migrate deploy`, and assert those counts/hashes are unchanged while the P10-A identity tables exist. Use test-owned PostgreSQL databases only.

- [ ] **Step 5: Write development/operator documentation**

`docs/development/p10-a-identity-rbac.md` must document exact cookie/session/CSRF behavior, role/capability matrix, bootstrap/provision/disable commands, production rollout order, last-owner recovery procedure, P9-F actor attribution, rate-limiter fail-closed behavior, and rollback principle. State explicitly that migration does not create an admin and production must run `bootstrap-owner` before authenticated traffic is promoted.

- [ ] **Step 6: Run local final verification**

```bash
npx prisma validate
npx prisma generate
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=high --legacy-peer-deps
```

Expected: all commands PASS. Inspect expected negative security/database messages rather than claiming zero-error logs.

- [ ] **Step 7: Commit release docs/E2E**

```bash
git add tests/e2e docs/development .github/workflows/ci.yml
git commit -m "docs: finalize P10-A identity release gate"
```

- [ ] **Step 8: Push/open Draft PR and require exact-head CI**

Record the exact branch head SHA and require the GitHub Actions run for that exact SHA to complete:

```text
production-audit ✅
e2e ✅
verify ✅
  Prisma Validate ✅
  Prisma Generate ✅
  Prisma migrate deploy ✅
  Typecheck ✅
  Full Vitest ✅
  Build ✅
```

Do not mark Ready for Review until changed-file authority review is complete and unresolved review threads are zero/resolved. Do not merge without a new explicit human merge instruction. Do not deploy without a separate explicit deployment instruction.
