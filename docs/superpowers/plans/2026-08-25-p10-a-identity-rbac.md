# P10-A Identity and RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add application-native users, secure database-backed sessions, project membership/RBAC, CSRF protection, trusted human actor propagation, and project-scoped authorization without expanding any P7/P8/P9 domain authority.

**Architecture:** Keep password, session, CSRF, login throttling, audit, project capability policy, membership commands, and route authorization in focused modules. `createApp()` composes them; it does not become an auth service. Every protected request follows Authentication → Active ProjectMembership → ProjectCapability → existing PlanLevel feature gate → existing domain command. P9-F receives authenticated `User.id` as the server actor and retains its immutable policy/authority protections.

**Tech Stack:** Node.js 22+, TypeScript 5.9, Express 5, EJS, Prisma 6/PostgreSQL 17, Redis 7/ioredis, Vitest 3, Supertest, Playwright Chromium.

**Spec:** `docs/superpowers/specs/2026-08-25-p10-a-identity-rbac-design.md`

## Global Constraints

- Base is `main@60733718026b1876340d50ff8626fcd8cd1558f5`; branch is `feat/p10-a-identity-rbac`.
- P10-A uses local email + password and opaque database sessions. No public signup, magic link, OAuth login, MFA, SAML, API key, organization RBAC, invitation email, or password-reset email is added.
- Email normalization is trim + lowercase over the complete string only; no Gmail dot/plus rewriting.
- Password V1 uses Node `crypto.scrypt` with `N=32768`, `r=8`, `p=1`, 32 random salt bytes, 64 derived-key bytes, and explicit `maxmem >= 64 MiB`.
- Session token is at least 32 random bytes, base64url encoded; only SHA-256(token) is persisted.
- Session lifetime is seven-day absolute expiry. No sliding renewal, request-time `lastSeenAt`, read-triggered rotation, or read-triggered audit is allowed.
- Production cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`; production `SESSION_SECRET` must contain at least 32 characters.
- Unsafe authenticated methods `POST|PUT|PATCH|DELETE` require CSRF before any business/queue/provider/AI/Git side effect. Login is unauthenticated and therefore uses same-origin validation plus rate limiting instead of authenticated CSRF.
- Identity never comes from `X-User-Id`, `X-Actor-Id`, client `actorId`, client role fields, query identity, or request-body identity.
- Roles: `OWNER | ADMIN | OPERATOR | VIEWER`; membership states: `ACTIVE | REVOKED`.
- Every normal project must retain at least one ACTIVE OWNER. Owner-changing commands serialize on the Project row.
- Human RBAC, PlanLevel feature entitlement, and P7/P8/P9 domain authority remain separate gates.
- P9-C remains exact LOW + `CREATE_CONTENT_PAGE`; no automatic Merge, Deploy, Rollback, writable global kill switch, fake approval, or P8 verification bypass is introduced.
- All P9-F GET/SSR paths remain persisted-read: auth lookup may read UserSession/User/Membership but must not write them.
- No test-only global auth bypass is allowed. Tests create explicit User/Session/ProjectMembership fixtures.
- Merge requires a new explicit human merge instruction. Deployment requires another separate explicit deployment instruction.

## File Structure

Create:

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
tests/unit/auth.env.test.ts
tests/unit/auth.csrf.test.ts
tests/unit/auth.project-capabilities.test.ts
tests/unit/auth.login-attempt-limiter.test.ts
tests/integration/auth.session.test.ts
tests/integration/auth.routes.test.ts
tests/integration/auth.admin-cli.test.ts
tests/integration/project-membership.test.ts
tests/integration/project-authorization.test.ts
tests/integration/projects.auth.test.ts
tests/integration/p10a-operations-auth.test.ts
tests/integration/p10a-route-authorization.test.ts
tests/integration/p10a-authority-boundary.test.ts
tests/unit/p10a-route-boundary.test.ts
tests/unit/p10a-authority-static.test.ts
tests/e2e/auth-rbac.spec.ts
docs/development/p10-a-identity-rbac.md
```

Modify only where the new boundary requires it:

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
src/modules/search-console/search-console.service.ts
src/web/routes.ts
src/web/dashboard.repository.ts
package.json
.github/workflows/ci.yml
project-scoped route/web-route modules already mounted in src/app.ts
existing E2E specs that directly create projects
```

---

### Task 1: Identity Schema, Password Hashing, Audit Persistence, and Production Secret Contract

**Files:**
- Create: `prisma/models/identity.prisma`
- Create: `prisma/migrations/20260825130000_add_p10a_identity_rbac/migration.sql`
- Create: `src/auth/email.ts`
- Create: `src/auth/password.ts`
- Modify: `prisma/schema.prisma`
- Modify: `src/config/env.ts`
- Test: `tests/unit/auth.email.test.ts`
- Test: `tests/unit/auth.password.test.ts`
- Test: `tests/unit/auth.env.test.ts`

**Interfaces:**
- `normalizeEmail(email: string): string`
- `PasswordHasher.hash(password: string): Promise<string>`
- `PasswordHasher.verify(password: string, encoded: string): Promise<boolean>`
- Prisma enums/models: `UserStatus`, `ProjectRole`, `MembershipStatus`, `SecurityAuditEventType`, `User`, `UserSession`, `ProjectMembership`, `SecurityAuditEvent`

- [ ] **Step 1: Write RED normalization/password/environment tests**

```ts
expect(normalizeEmail('  Owner@Example.COM ')).toBe('owner@example.com');
expect(normalizeEmail('a+b@example.com')).toBe('a+b@example.com');

const encoded = await passwordHasher.hash('correct horse battery staple');
expect(encoded).toMatch(/^scrypt\$1\$32768\$8\$1\$/);
expect(await passwordHasher.verify('correct horse battery staple', encoded)).toBe(true);
expect(await passwordHasher.verify('wrong', encoded)).toBe(false);
expect(await passwordHasher.verify('x', 'broken')).toBe(false);
```

`auth.env.test.ts` must import `src/config/env.ts` with `NODE_ENV=production` and `SESSION_SECRET=short`, expecting module initialization to reject; 32-character production secret must parse.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/unit/auth.email.test.ts tests/unit/auth.password.test.ts tests/unit/auth.env.test.ts
```

Expected: FAIL because new modules/contracts are absent.

- [ ] **Step 3: Add Prisma schema and forward-only migration**

Use these bounded enums:

```prisma
enum UserStatus { ACTIVE DISABLED }
enum ProjectRole { OWNER ADMIN OPERATOR VIEWER }
enum MembershipStatus { ACTIVE REVOKED }
enum SecurityAuditEventType {
  USER_PROVISIONED
  USER_DISABLED
  USER_ENABLED
  PASSWORD_CHANGED
  SESSION_CREATED
  SESSION_REVOKED
  SESSIONS_REVOKED_ALL
  MEMBERSHIP_CREATED
  MEMBERSHIP_REACTIVATED
  MEMBERSHIP_ROLE_CHANGED
  MEMBERSHIP_REVOKED
}
```

Required models:

```prisma
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
  version      String                 @default("SECURITY_AUDIT_V1")
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

Add `memberships ProjectMembership[]` to `Project`. The SQL migration also adds a PostgreSQL `BEFORE UPDATE OR DELETE` trigger on `SecurityAuditEvent` that raises an exception, matching the repository's immutable-row pattern. The migration contains no `DROP`, `TRUNCATE`, existing-row `DELETE`, P7/P8/P9 rewrite, hard-coded user, or literal-email membership assignment.

- [ ] **Step 4: Implement email and password utilities**

Encoded password format:

```text
scrypt$1$32768$8$1$<base64url-32-byte-salt>$<base64url-64-byte-key>
```

Use `crypto.scrypt` with `{ N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }` and `timingSafeEqual`. Stored-format parsing is strict and malformed values return `false` rather than throwing credentials into logs.

- [ ] **Step 5: Enforce production secret length**

After parsing env:

```ts
if (parsed.NODE_ENV === 'production' && parsed.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be at least 32 characters in production');
}
```

- [ ] **Step 6: Run GREEN**

```bash
npx prisma validate
npx prisma generate
npx vitest run tests/unit/auth.email.test.ts tests/unit/auth.password.test.ts tests/unit/auth.env.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma src/auth/email.ts src/auth/password.ts src/config/env.ts tests/unit/auth.email.test.ts tests/unit/auth.password.test.ts tests/unit/auth.env.test.ts
git commit -m "feat: add P10-A identity foundation"
```

---

### Task 2: Session Repository, Trusted Request Authentication, and Explicit Test Fixture

**Files:**
- Create: `src/auth/session.repository.ts`
- Create: `src/auth/authentication.ts`
- Create: `src/types/express.d.ts`
- Create: `tests/helpers/auth-fixture.ts`
- Create: `tests/integration/auth.session.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- `SESSION_COOKIE_NAME = 'seogeo_session'`
- `createSessionToken(): { rawToken: string; tokenHash: string }`
- `SessionRepository.create(userId, tokenHash, expiresAt)`
- `SessionRepository.findActiveByTokenHash(tokenHash, now)`
- `SessionRepository.revoke(sessionId, at)`
- `SessionRepository.revokeAllForUser(userId, at)`
- `AuthenticatedActor { userId: string; sessionId: string }`
- `authenticationMiddleware: RequestHandler`
- `requireAuthentication(): RequestHandler`
- `seedAuthenticatedUser(options)` creates real Prisma rows and returns cookie/CSRF inputs for tests

- [ ] **Step 1: Write RED tests against a test-local protected probe route**

Do not depend on `/auth/session`, which is created in Task 4. In the test:

```ts
const app = express();
app.use(authenticationMiddleware);
app.get('/probe', requireAuthentication(), (req, res) => res.json({ auth: req.auth }));
```

Assert a valid cookie returns `{ userId, sessionId }`; missing, expired, revoked, and DISABLED-user sessions return 401.

- [ ] **Step 2: Add GET purity assertion**

Read the `UserSession` row and `SecurityAuditEvent` count, call `/probe`, read them again, and assert no session fields changed and no audit row was appended merely because authentication was read.

- [ ] **Step 3: Run RED**

```bash
npx vitest run tests/integration/auth.session.test.ts
```

Expected: FAIL because session/authentication modules do not exist.

- [ ] **Step 4: Implement token and read-only resolver**

Generate 32 random bytes, base64url encode as raw token, SHA-256 digest as `tokenHash`. `authenticationMiddleware` reads only the owned session cookie, looks up active session + ACTIVE user, then sets:

```ts
req.auth = { userId: row.userId, sessionId: row.id };
res.locals.auth = req.auth;
res.locals.authSessionTokenHash = row.tokenHash;
```

Missing/invalid auth sets `req.auth = null`, `res.locals.auth = null`, and performs no write.

- [ ] **Step 5: Add real test fixture**

`tests/helpers/auth-fixture.ts` accepts explicit `{ role, planLevel, userStatus, membershipStatus }`, creates User/Project/ProjectMembership/UserSession rows, derives the actual cookie and CSRF token, and returns cleanup identifiers. It must not branch production code on `NODE_ENV=test`.

- [ ] **Step 6: Run GREEN**

```bash
npx vitest run tests/integration/auth.session.test.ts
npm run typecheck
```

Expected: PASS including the no-write GET contract.

- [ ] **Step 7: Commit**

```bash
git add src/auth/session.repository.ts src/auth/authentication.ts src/types/express.d.ts src/app.ts tests/helpers/auth-fixture.ts tests/integration/auth.session.test.ts
git commit -m "feat: add server-side authentication sessions"
```

---

### Task 3: CSRF and Redis Login Throttling

**Files:**
- Create: `src/auth/csrf.ts`
- Create: `src/auth/login-attempt-limiter.ts`
- Create: `tests/unit/auth.csrf.test.ts`
- Create: `tests/unit/auth.login-attempt-limiter.test.ts`

**Interfaces:**
- `deriveCsrfToken(secret: string, sessionId: string, tokenHash: string): string`
- `verifyCsrfToken(expected: string, submitted: string): boolean`
- `requireCsrf(): RequestHandler`
- `LoginAttemptLimiter.assertAllowed(key: string): Promise<void>`
- `LoginAttemptLimiter.recordFailure(key: string): Promise<void>`
- `LoginAttemptLimiter.clear(key: string): Promise<void>`
- `loginLimiterKey(normalizedEmail: string, sourceIp: string): string`
- `RedisLoginAttemptLimiter` accepts an injected ioredis `Redis`

- [ ] **Step 1: Write RED CSRF tests**

```ts
const token = deriveCsrfToken('s'.repeat(32), 'session-id', 'a'.repeat(64));
expect(verifyCsrfToken(token, token)).toBe(true);
expect(verifyCsrfToken(token, token + 'x')).toBe(false);
```

Also assert `requireCsrf()` rejects missing/header/form mismatch before `next()`.

- [ ] **Step 2: Write RED limiter tests**

Use a deterministic fake Redis or injected fake limiter for unit behavior. Ten recorded failures within one 15-minute bucket are allowed to accumulate; `assertAllowed` then returns `LOGIN_RATE_LIMITED` 429. `clear` permits the next attempt. Backend errors map to `AUTH_RATE_LIMITER_UNAVAILABLE` 503.

- [ ] **Step 3: Run RED**

```bash
npx vitest run tests/unit/auth.csrf.test.ts tests/unit/auth.login-attempt-limiter.test.ts
```

Expected: FAIL on missing modules.

- [ ] **Step 4: Implement CSRF**

HMAC-SHA256 message is exact UTF-8 `sessionId + "\n" + tokenHash`. Read submitted value from `X-CSRF-Token` or `_csrf`; compare with `timingSafeEqual`. Never accept CSRF as authentication.

- [ ] **Step 5: Implement fixed-window Redis limiter**

Key material is SHA-256 of `normalizedEmail + "\n" + sourceIp`; Redis never stores plaintext email/password/token. Use Lua for atomic `INCR` + first-write `EXPIRE 900`. Do not enable unrestricted `trust proxy`; source IP remains Express connection-derived under current config.

- [ ] **Step 6: Run GREEN and commit**

```bash
npx vitest run tests/unit/auth.csrf.test.ts tests/unit/auth.login-attempt-limiter.test.ts
npm run typecheck
git add src/auth/csrf.ts src/auth/login-attempt-limiter.ts tests/unit/auth.csrf.test.ts tests/unit/auth.login-attempt-limiter.test.ts
git commit -m "feat: add CSRF and login throttling"
```

---

### Task 4: Authentication HTTP Routes

**Files:**
- Create: `src/auth/auth.routes.ts`
- Create: `src/views/auth/login.ejs`
- Create: `tests/integration/auth.routes.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- `GET /auth/login`
- `POST /auth/login`
- `POST /auth/logout`
- `GET /auth/session`
- `POST /auth/password/change`

- [ ] **Step 1: Write RED route tests**

Assert nonexistent email, wrong password, and disabled user all return the same `401 INVALID_CREDENTIALS`; valid login creates a fresh session and cookie; external `Origin` is rejected before credential verification; logout/password change require authentication + CSRF; password change revokes all active sessions.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/integration/auth.routes.test.ts
```

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement login flow**

Exact order:

```text
normalize email
→ validate same-origin request metadata
→ limiter.assertAllowed
→ read ACTIVE user
→ PasswordHasher.verify
→ failure: limiter.recordFailure + INVALID_CREDENTIALS
→ success: limiter.clear
→ create fresh seven-day UserSession
→ set seogeo_session cookie
```

Do not reuse/promote an old cookie.

- [ ] **Step 4: Implement bounded session response and unsafe auth mutations**

`GET /auth/session` returns only user `{id,email,displayName}`, session `{id,expiresAt}`, and derived CSRF token. Logout revokes only current session. Password change verifies current password, then in one transaction updates password hash/version and revokes all sessions; caller must log in again.

- [ ] **Step 5: Run GREEN and commit**

```bash
npx vitest run tests/integration/auth.routes.test.ts tests/integration/auth.session.test.ts
npm run typecheck
git add src/auth/auth.routes.ts src/views/auth/login.ejs src/app.ts tests/integration/auth.routes.test.ts
git commit -m "feat: add local authentication routes"
```

---

### Task 5: Security Audit Repository and Server-Operator Account CLI

**Files:**
- Create: `src/auth/security-audit.repository.ts`
- Create: `scripts/auth-admin.ts`
- Create: `tests/integration/auth.admin-cli.test.ts`
- Modify: `src/auth/auth.routes.ts`
- Modify: `package.json`

**Interfaces:**
- `SecurityAuditRepository.append(event)` only; no update/delete API
- CLI: `bootstrap-owner`, `provision-user`, `disable-user`, `enable-user`
- Package entry: `npm run auth:admin -- <command> <email>`; password is never a command-line argument

- [ ] **Step 1: Write RED audit/CLI tests**

Verify:

```text
successful login → SESSION_CREATED
logout → SESSION_REVOKED
password change → PASSWORD_CHANGED + SESSIONS_REVOKED_ALL
bootstrap-owner with zero users → initial ACTIVE user + OWNER membership on every existing project
bootstrap-owner with >=1 user → fail with zero writes
provision-user → global user only
user disable → DISABLED + all sessions revoked + USER_DISABLED
user enable → ACTIVE + USER_ENABLED
```

Try Prisma `update/delete` against an audit row and assert the database immutability trigger rejects both.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/integration/auth.admin-cli.test.ts tests/integration/auth.routes.test.ts
```

Expected: new audit/CLI assertions fail.

- [ ] **Step 3: Implement append-only audit repository and auth-route event writes**

Audit allowlist contains only event type, actor/target user ids, project id, role before/after, version, timestamp. Never pass password, hash, cookie, tokenHash, CSRF, authorization header, request body, or provider credential.

- [ ] **Step 4: Implement CLI commands**

Export command functions for tests; executable wrapper parses only command/email. Read password from stdin/TTY with hidden echo and confirmation, then hash. `bootstrap-owner` is allowed only when User count is zero and creates initial OWNER memberships for all existing projects in the same command transaction.

- [ ] **Step 5: Run GREEN and commit**

```bash
npx vitest run tests/integration/auth.admin-cli.test.ts tests/integration/auth.routes.test.ts
npm run typecheck
git add src/auth/security-audit.repository.ts src/auth/auth.routes.ts scripts/auth-admin.ts package.json tests/integration/auth.admin-cli.test.ts
git commit -m "feat: add identity bootstrap and security audit"
```

---

### Task 6: Central Project Capabilities and Access Middleware

**Files:**
- Create: `src/auth/project-capabilities.ts`
- Create: `src/auth/project-access.ts`
- Create: `tests/unit/auth.project-capabilities.test.ts`
- Create: `tests/integration/project-authorization.test.ts`
- Modify: `src/auth/require-feature.ts`

**Interfaces:**

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

- `hasProjectCapability(role, capability): boolean`
- `requireProjectMembership(): RequestHandler`
- `requireProjectCapability(capability): RequestHandler`
- `assertProjectCapability(userId, projectId, capability)` for resource-id routes after minimal owning-project resolution

- [ ] **Step 1: Write RED role-matrix tests**

Exact roles:

```text
VIEWER  → PROJECT_READ, EXPERIMENT_READ, FEEDBACK_READ
OPERATOR→ VIEWER + operational capabilities, no project settings/member management
ADMIN   → OPERATOR + PROJECT_SETTINGS_WRITE + PROJECT_MEMBER_READ + PROJECT_MEMBER_MANAGE_BASIC
OWNER   → ADMIN + PROJECT_MEMBER_MANAGE_ALL
```

ADMIN target rules: may manage VIEWER/OPERATOR only; cannot create/modify/revoke ADMIN/OWNER or promote any member to ADMIN/OWNER.

- [ ] **Step 2: Write RED HTTP non-enumeration tests**

User A requesting User B project must receive `404 PROJECT_NOT_FOUND`. Valid member lacking capability receives `403 PROJECT_CAPABILITY_REQUIRED`.

- [ ] **Step 3: Implement explicit Set-based capability map**

Do not authorize using numeric role ranking. `requireProjectMembership` resolves Project + ACTIVE membership once and stores both in `res.locals`.

- [ ] **Step 4: Make `requireFeature()` reuse resolved project**

```ts
const project = res.locals.project ?? await projectService.get(projectId);
```

Keep fallback only for migration compatibility; release completion requires all project-scoped production routes classified.

- [ ] **Step 5: Run GREEN and commit**

```bash
npx vitest run tests/unit/auth.project-capabilities.test.ts tests/integration/project-authorization.test.ts
npm run typecheck
git add src/auth/project-capabilities.ts src/auth/project-access.ts src/auth/require-feature.ts tests/unit/auth.project-capabilities.test.ts tests/integration/project-authorization.test.ts
git commit -m "feat: add project RBAC middleware"
```

---

### Task 7: Membership Commands, Last-Owner Lock, and Membership API

**Files:**
- Create: `src/modules/projects/project-membership.repository.ts`
- Create: `src/modules/projects/project-membership.service.ts`
- Create: `src/modules/projects/project-membership.routes.ts`
- Create: `tests/integration/project-membership.test.ts`
- Modify: `src/app.ts`

**Interfaces:**
- `GET /api/projects/:projectId/members`
- `POST /api/projects/:projectId/members` accepts `{ email, role }`
- `PATCH /api/projects/:projectId/members/:membershipId` accepts `{ role }`
- `DELETE /api/projects/:projectId/members/:membershipId` performs logical `REVOKED`

- [ ] **Step 1: Write RED service/API tests**

Cover new membership, reactivation, disabled/missing user as bounded `USER_NOT_AVAILABLE`, ADMIN target restrictions, OWNER manage-all, cross-project membership id hiding, and last-owner demotion/revocation as `409 LAST_PROJECT_OWNER_REQUIRED`.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/integration/project-membership.test.ts
```

Expected: FAIL on missing service/routes.

- [ ] **Step 3: Implement serialized owner invariant**

Every role-change/revoke/reactivate transaction begins with:

```sql
SELECT id FROM "Project" WHERE id = $1 FOR UPDATE;
```

Re-read ACTIVE OWNER count in that transaction and reject any resulting zero-owner state. UI checks are non-authoritative.

- [ ] **Step 4: Implement route chain**

```text
GET    → auth → membership → PROJECT_MEMBER_READ
POST   → auth → CSRF → membership → BASIC/ALL target-policy check
PATCH  → auth → CSRF → membership → BASIC/ALL target-policy check
DELETE → auth → CSRF → membership → BASIC/ALL target-policy check
```

Append corresponding membership audit events inside the successful transaction boundary.

- [ ] **Step 5: Run GREEN and commit**

```bash
npx vitest run tests/integration/project-membership.test.ts tests/integration/project-authorization.test.ts
npm run typecheck
git add src/modules/projects/project-membership.* src/app.ts tests/integration/project-membership.test.ts
git commit -m "feat: add project memberships"
```

---

### Task 8: Scope Project Creation, Listing, Detail, Update, and Portfolio to Memberships

**Files:**
- Modify: `src/modules/projects/project.repository.ts`
- Modify: `src/modules/projects/project.types.ts`
- Modify: `src/modules/projects/project.service.ts`
- Modify: `src/modules/projects/project.routes.ts`
- Modify: `src/web/routes.ts`
- Modify: `src/web/dashboard.repository.ts`
- Create: `tests/integration/projects.auth.test.ts`
- Modify: `tests/e2e/projects.spec.ts`
- Modify: `tests/e2e/dashboard.spec.ts`

**Interfaces:**
- `ProjectService.createForOwner(userId, input)` atomically creates Project + ACTIVE OWNER membership
- `ProjectService.listForUser(userId)` returns only projects joined through ACTIVE membership

- [ ] **Step 1: Write RED API tests**

Anonymous create/list/get/update reject. New project creates owner membership in same transaction. Forced membership failure rolls Project back. Revoked/non-member projects never appear in list.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/integration/projects.auth.test.ts
```

- [ ] **Step 3: Implement transactional create and scoped list**

Scoped list query uses:

```ts
where: { memberships: { some: { userId, status: 'ACTIVE' } } }
```

`GET /api/projects/:id` requires `PROJECT_READ`; `PATCH` requires CSRF + `PROJECT_SETTINGS_WRITE`.

- [ ] **Step 4: Protect web portfolio/project creation**

`/`, `/projects`, `/projects/new`, POST `/projects`, and `/projects/:id` require authentication. Portfolio repository accepts authenticated user id and never returns non-member projects. Project-create form carries derived `_csrf` hidden input.

- [ ] **Step 5: Update focused E2E fixtures**

Directly seeded projects receive ACTIVE membership for the test login user. Do not bypass auth globally.

- [ ] **Step 6: Run GREEN and commit**

```bash
npx vitest run tests/integration/projects.auth.test.ts
npx playwright test tests/e2e/projects.spec.ts tests/e2e/dashboard.spec.ts --project=chromium
npm run typecheck
git add src/modules/projects src/web tests/integration/projects.auth.test.ts tests/e2e/projects.spec.ts tests/e2e/dashboard.spec.ts
git commit -m "feat: scope projects to memberships"
```

---

### Task 9: P9-F Trusted Actor and Operations Center RBAC

**Files:**
- Modify: `src/modules/optimization-operations/operations.routes.ts`
- Modify: `src/modules/optimization-operations/operations.web.routes.ts`
- Modify: `src/app.ts`
- Create: `tests/integration/p10a-operations-auth.test.ts`

**Interfaces:**
- Operations reads: auth → ACTIVE membership → `PROJECT_READ` → `OPTIMIZATION_OPERATIONS_CENTER`
- Policy revision: auth → CSRF → ACTIVE membership → `AUTOPILOT_POLICY_REVISE` → feature gate → current P9-F validation/command
- Production actor: `OperationsActor { actorId: req.auth.userId }`

- [ ] **Step 1: Write RED P9-F authorization tests**

VIEWER Advanced reads but cannot revise; OPERATOR Advanced revises; OPERATOR/OWNER Standard cannot bypass feature gate; persisted revision actor equals authenticated User.id. Client `actorId`, `allowedRiskClass`, and `allowedOperationClasses` remain rejected before policy command.

- [ ] **Step 2: Run RED**

```bash
npx vitest run tests/integration/p10a-operations-auth.test.ts
```

- [ ] **Step 3: Add human authorization guards without changing P9-F domain command**

Preserve forbidden-field check, optimistic concurrency, request idempotency, immutable revision, atomic policy update + revision, and LOW/CREATE_CONTENT_PAGE authority lock.

- [ ] **Step 4: Fix SSR control visibility**

`policyMutationAvailable` is true only when authenticated membership has `AUTOPILOT_POLICY_REVISE` and PlanLevel has Operations Center. Render CSRF token for authorized control; never render tokenHash.

- [ ] **Step 5: Prove read purity**

Snapshot UserSession, SecurityAuditEvent, policy and revision counts before/after Operations GET; assert no request-time auth/audit/policy write.

- [ ] **Step 6: Run GREEN plus full Vitest**

```bash
npx vitest run tests/integration/p10a-operations-auth.test.ts
npm test
npm run typecheck
git add src/modules/optimization-operations src/app.ts tests/integration/p10a-operations-auth.test.ts
git commit -m "feat: bind P9-F actor to authenticated user"
```

---

### Task 10: Protect Every Remaining Project-Scoped Route and Search Console OAuth Actor

**Files:**
- Modify the project-scoped route modules already mounted by `src/app.ts` for Market, Crawl, SEO, GEO, Search Console, Growth, Optimization Feedback, AI, Content, Competitor, Optimization Orchestration, Experiments, Publication, Distribution, Reporting, Visibility, Visibility Intelligence/Metrics/History
- Modify corresponding web route modules and `src/web/routes.ts`
- Modify: `src/modules/search-console/search-console.routes.ts`
- Modify: `src/modules/search-console/search-console.service.ts`
- Create: `tests/integration/p10a-route-authorization.test.ts`
- Create: `tests/unit/p10a-route-boundary.test.ts`

**Capability mapping:**

```text
persisted project reads                               → PROJECT_READ
market/connection/project settings write              → PROJECT_SETTINGS_WRITE
crawl start/retry                                     → CRAWL_RUN
SEO run/issue mutation                                → SEO_RUN
GEO run                                               → GEO_RUN
AI analysis/visibility sampling/report generation     → AI_RUN
content mutation                                      → CONTENT_WRITE
publication preparation/approval planning             → PUBLICATION_PREPARE
publication execution/verification commands           → PUBLICATION_EXECUTE
distribution prepare/publish/manual-result/verify     → DISTRIBUTION_EXECUTE
manual optimization run                               → OPTIMIZATION_RUN
experiment reads                                      → EXPERIMENT_READ
feedback reads                                        → FEEDBACK_READ
```

- [ ] **Step 1: Write RED static route inventory**

Read every mounted project-scoped route source and require use of shared auth/project guards. Unsafe methods must also use CSRF. Explicitly inventory resource-id routes such as crawl/page/SEO issue/AI task/publication/distribution ids: resolve owning `projectId` with a minimal persisted read, then call `assertProjectCapability` before full detail/mutation.

- [ ] **Step 2: Write representative side-effect RED tests**

Inject fakes for Crawl, AI, Publication, Distribution, Optimization manual run, and Search Console; anonymous/VIEWER/missing-CSRF requests must be rejected with fake call counters still zero.

- [ ] **Step 3: Apply guards without refactoring domain implementations**

Human authorization occurs before feature/domain work. Preserve every existing PlanLevel/domain check after RBAC.

- [ ] **Step 4: Correct Search Console OAuth actor**

At OAuth start, replace `project-api:${projectId}` with authenticated `req.auth.userId`. At callback, consume/validate nonce state as today, then require current authenticated user id to equal persisted nonce `actorId` before token/credential materialization. Actor mismatch returns bounded authorization failure before vault/provider connection write. Existing 10-minute TTL and single-use state semantics remain unchanged.

- [ ] **Step 5: Run focused suite, then full regression**

```bash
npx vitest run tests/unit/p10a-route-boundary.test.ts tests/integration/p10a-route-authorization.test.ts
npm test
npm run typecheck
```

Expected: PASS. Inspect expected negative DB/security logs; do not claim globally clean logs.

- [ ] **Step 6: Commit**

```bash
git add src/modules src/web src/app.ts tests/unit/p10a-route-boundary.test.ts tests/integration/p10a-route-authorization.test.ts
git commit -m "feat: enforce project authorization across routes"
```

---

### Task 11: Freeze P7/P8/P9 Authority Boundaries Under Human RBAC

**Files:**
- Create: `tests/integration/p10a-authority-boundary.test.ts`
- Create: `tests/unit/p10a-authority-static.test.ts`

**Interfaces:** No new production interface; this task is a release safety gate.

- [ ] **Step 1: Write authority integration tests**

Authenticated OWNER/OPERATOR still cannot cause:

```text
MEDIUM/HIGH autopilot
non-CREATE_CONTENT_PAGE autopilot
fake P8 human approval
P9-C direct Git mutation
forced P8 VERIFIED
automatic Merge
Deploy
Rollback
writable global autopilot kill switch
client actor override
```

- [ ] **Step 2: Write static forbidden-source scan**

Scan new P10-A/auth/membership modules and reject imports/calls that mutate P7 scoring/lifecycle, force P8 verification, merge/deploy/rollback, or write global kill switch. Reject production auth reads of `X-User-Id`, `X-Actor-Id`, or client `body.actorId` as identity sources.

- [ ] **Step 3: Run and minimally fix any discovered leak**

```bash
npx vitest run tests/integration/p10a-authority-boundary.test.ts tests/unit/p10a-authority-static.test.ts
npm test
npm run typecheck
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/integration/p10a-authority-boundary.test.ts tests/unit/p10a-authority-static.test.ts src
git commit -m "test: harden P10-A authority boundaries"
```

---

### Task 12: Browser E2E, Migration Proof, Operations Documentation, and Exact-Head Release Gate

**Files:**
- Create: `tests/e2e/auth-rbac.spec.ts`
- Modify existing E2E specs that seed Project rows directly so each receives a membership for the logged-in test user
- Create: `docs/development/p10-a-identity-rbac.md`
- Modify: `.github/workflows/ci.yml` only when needed for deterministic test fixture setup; do not weaken secrets or auth

**Interfaces:** Browser tests authenticate through real `/auth/login`; release gate remains `production-audit`, `e2e`, `verify` on the same exact SHA.

- [ ] **Step 1: Write RED browser flows**

```text
valid login → only member projects visible
cross-project URL → PROJECT_NOT_FOUND/no existence leak
VIEWER → read allowed, mutation controls absent
OPERATOR + ADVANCED → Operations policy controls visible, valid CSRF revision succeeds
logout → protected pages inaccessible
```

- [ ] **Step 2: Update existing E2E fixtures explicitly**

Every spec that directly calls `prisma.project.create` must create/use a test login User and ACTIVE ProjectMembership. No global browser auth bypass or production code branch is permitted.

- [ ] **Step 3: Run focused Chromium suite**

```bash
npx playwright test tests/e2e/auth-rbac.spec.ts tests/e2e/projects.spec.ts tests/e2e/dashboard.spec.ts --project=chromium
```

Expected: PASS.

- [ ] **Step 4: Verify migration from blank database**

On a test-owned empty PostgreSQL database:

```bash
DATABASE_URL="$P10A_BLANK_DATABASE_URL" npx prisma migrate deploy
DATABASE_URL="$P10A_BLANK_DATABASE_URL" npx prisma validate
```

Expected: all migrations apply from zero.

- [ ] **Step 5: Verify migration from current P9 shape**

Create a second test DB migrated through current main/P9 migrations, seed representative P9 immutable/history rows, record stable row counts/identity hashes, apply only forward P10-A migration(s), then assert those P9 values are unchanged and identity tables/audit immutability exist.

- [ ] **Step 6: Write operator/development document**

Document exact session cookie/expiry, CSRF, role-capability matrix, login limiter 10/15-minute rule and Redis fail-closed behavior, bootstrap/provision/disable/enable CLI, last-owner procedure, production rollout order, Search Console actor binding, P9-F actor attribution, read-purity guarantee, rollback principle, and explicit no Merge/Deploy authority expansion.

- [ ] **Step 7: Run full local release gate**

```bash
npx prisma validate
npx prisma generate
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=high --legacy-peer-deps
```

Expected: all PASS. Inspect expected negative security/database logs instead of claiming there are no ERROR strings.

- [ ] **Step 8: Commit final release slice**

```bash
git add tests/e2e docs/development .github/workflows/ci.yml
git commit -m "docs: finalize P10-A identity release gate"
```

- [ ] **Step 9: Open Draft PR and require exact-head CI**

Record the exact feature SHA and require the GitHub Actions run for that same SHA:

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

Before Ready for Review: changed-file authority review complete; unresolved review threads zero/resolved; exact reviewed head equals exact CI head. Do not merge without a new explicit human merge instruction. Do not deploy without a separate explicit deployment instruction.
