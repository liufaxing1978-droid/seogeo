# P10-A Identity, Session, Project Membership and RBAC Design

Date: 2026-08-25
Status: Approved design
Repository: `liufaxing1978-droid/seogeo`
Base: `main@60733718026b1876340d50ff8626fcd8cd1558f5`
Branch: `feat/p10-a-identity-rbac`

## 1. Purpose

P10-A introduces application-native identity, server-side sessions, project membership, role-based access control, CSRF protection, and trusted actor propagation so production mutations can be attributed to authenticated humans without weakening any existing P7/P8/P9 authority boundary.

P10-A answers four questions centrally:

1. Who is making this request?
2. Does that user belong to this project?
3. Does that project role allow the user to request this operation?
4. Does the existing plan/domain authority still allow the operation?

The authority chain is:

```text
Authentication
    ↓
Project Membership
    ↓
RBAC Capability
    ↓
Plan Feature Gate
    ↓
Existing Domain Authority
```

P10-A solves human identity and authorization. It does not expand automation authority.

## 2. Existing repository constraints

P10-A extends the existing Express/EJS/Prisma application instead of introducing a second application framework.

Current repository facts relevant to this design:

- `createApp()` has no authentication/session middleware;
- `AppOptions` already exposes the P9-F `OperationsActorResolver` seam;
- `OperationsActorResolver.resolve()` receives the Express `Request` object;
- `requireFeature()` checks project plan entitlement, not user identity or role;
- project create/list/get/update routes are not membership-scoped;
- `Project` has no owner/user/membership relation;
- Prisma uses the multi-file schema layout under `prisma/models`;
- `SESSION_SECRET` exists in environment configuration but is not currently used for application authentication;
- P9-F policy revision already fails closed when no trusted server actor is available;
- P9-F rejects client-controlled `actorId`, `allowedRiskClass`, and `allowedOperationClasses`;
- P9-F GET/SSR surfaces are persisted-read only and must not acquire request-time authentication writes.

## 3. Chosen approach

### 3.1 Authentication

P10-A V1 uses local email + password authentication backed by application-native `User` and `UserSession` persistence.

Rejected alternatives:

- public self-registration: deferred because it requires verification, abuse handling, recovery and customer-facing onboarding;
- email magic link: deferred because the repository has no transactional email foundation;
- Google/GitHub OAuth as the sole identity source: deferred so project authorization is not coupled to one external provider;
- Cloudflare Access-only authorization: may remain an optional perimeter control but does not replace application identity or project RBAC.

Future OAuth/passwordless providers can map into the same stable application `User.id` without changing ProjectMembership semantics.

### 3.2 HTTP integration

P10-A uses global optional authentication resolution plus explicit route authorization middleware.

It does not globally reject every unauthenticated request because `/health`, static assets and login routes remain public.

It does not allow each route to parse sessions or inspect raw roles independently.

## 4. Hard authority boundaries

P10-A MUST NOT:

- let a client submit or override authenticated actor identity;
- let a client submit a project role as proof of authorization;
- let OWNER/ADMIN bypass plan feature gates;
- let any human role change P7 Growth score, evidence, lifecycle or UNKNOWN semantics;
- let any human role bypass P8 risk, approval, immutable PublicationPlan, preview, mutation validation or VERIFIED semantics;
- expand P9-C automation beyond exact LOW-risk `CREATE_CONTENT_PAGE`;
- add automatic Merge, Deploy or Rollback authority;
- add a writable global autopilot kill switch;
- let authentication GET middleware enqueue work, call providers/AI/Git, materialize feedback, or update request activity timestamps;
- introduce a production auth bypass, fallback actor, hard-coded admin actor, or client header/body identity fallback.

`OWNER` is the highest project human role. It is not a domain superuser.

## 5. Identity model

P10-A adds `prisma/models/identity.prisma`.

### 5.1 UserStatus

```text
ACTIVE
DISABLED
```

### 5.2 User

Conceptual fields:

```text
id                  UUID primary key
email               original display email
normalizedEmail     unique normalized login identity
displayName         nullable
passwordHash        encoded password hash
passwordHashVersion integer
status              ACTIVE | DISABLED
createdAt
updatedAt
```

Rules:

- `normalizedEmail` is the unique login identity;
- normalization trims surrounding whitespace and lowercases the complete email string deterministically;
- normalization does not invent provider-specific dot/plus-address semantics;
- P10-A V1 does not expose an email-change command;
- a DISABLED user cannot create a new session or continue using an existing session;
- password material never appears in logs, audit metadata, API responses or observability events.

## 6. Password contract

P10-A V1 uses Node.js `crypto.scrypt` behind a narrow `PasswordHasher` port.

V1 encoded password hashes are versioned and self-describing with these parameters:

```text
algorithm = scrypt
formatVersion = 1
N = 32768
r = 8
p = 1
salt = 32 random bytes
derivedKey = 64 bytes
```

Verification derives the candidate key with stored server-produced parameters and compares with `timingSafeEqual`.

Password input policy is deliberately simple:

```text
minimum length = 12 characters
maximum length = 256 characters
no composition-class requirement
```

Rules:

- every password gets an independent cryptographically random salt;
- raw SHA-256/MD5/SHA-1 password hashing is forbidden;
- plaintext password is never persisted;
- malformed stored password hashes fail closed;
- client input cannot select scrypt parameters;
- `passwordHashVersion = 1` for V1 and permits later rehash migration without changing user identity.

P10-A does not implement recovery email or MFA.

## 7. Server-side session model

### 7.1 UserSession

Conceptual fields:

```text
id        UUID primary key
userId    FK -> User
tokenHash unique SHA-256 digest of random session token
createdAt
expiresAt
revokedAt nullable
```

P10-A deliberately has no request-updated `lastSeenAt` field in V1. This preserves P9-F persisted-read GET semantics.

### 7.2 Session token

On successful login:

1. generate at least 32 cryptographically random bytes;
2. encode them as an opaque base64url token;
3. store only SHA-256(token) in `UserSession.tokenHash`;
4. send only the raw token in the HttpOnly session cookie.

Session lookup hashes the presented cookie token and performs an indexed equality lookup by `tokenHash`.

### 7.3 Session lifetime

P10-A V1 uses seven-day absolute expiration.

There is no sliding expiration, request-time session refresh or read-time rotation.

A session is valid only when all are true:

- session row exists;
- `revokedAt IS NULL`;
- `expiresAt > now`;
- related User status is ACTIVE.

### 7.4 Cookie

The application-owned session cookie MUST use:

```text
HttpOnly = true
Secure = true in production
SameSite = Lax
Path = /
Max-Age aligned with the absolute session lifetime
```

Login always creates a fresh UserSession/token. An existing anonymous/expired cookie is never promoted into an authenticated session.

## 8. CSRF design

Every authenticated unsafe cookie-based browser method requires CSRF validation before business mutation:

```text
POST
PUT
PATCH
DELETE
```

P10-A uses a server-derived per-session token:

```text
csrfToken = HMAC-SHA256(
  SESSION_SECRET,
  canonical(sessionId + tokenHash)
)
```

The server derives the token from authenticated server state and does not persist a second raw CSRF secret.

Rules:

- SSR forms receive the token in a hidden input;
- authenticated browser JSON requests use `X-CSRF-Token`;
- verification uses constant-time comparison;
- CSRF validation runs before commands, queue work, AI/provider work or Git work;
- GET/HEAD remain read-only and do not require CSRF;
- CSRF is never accepted as authentication;
- production `SESSION_SECRET` must be non-default and at least 32 characters; `development-secret` is rejected when `NODE_ENV=production`;
- development/test may use the explicit local default.

### 8.1 Login CSRF

`POST /auth/login` is unauthenticated and therefore cannot use the authenticated per-session token.

To prevent login-CSRF, production browser login POST requires a same-origin `Origin` header. Missing or cross-origin `Origin` is rejected. The login route also rejects arbitrary external return URLs and accepts only normalized same-origin relative return paths.

## 9. Authentication request context

The global authentication middleware resolves:

```text
session cookie
→ token digest
→ UserSession
→ User
→ Request authentication context
```

Because existing P9-F `OperationsActorResolver.resolve()` receives `Request`, the canonical context is stored on an augmented Express request:

```text
req.auth = {
  userId,
  sessionId,
  sessionTokenHash
}
```

`sessionTokenHash` is server-only request context and is never serialized to a response/template.

For SSR/template convenience, a bounded public-safe projection is also mirrored to:

```text
res.locals.auth = {
  userId,
  sessionId
}
```

Invalid/anonymous requests use `req.auth = null` and `res.locals.auth = null`.

The middleware MUST NOT read local identity from:

```text
X-User-Id
X-Actor-Id
Authorization values pretending to be local session identity
query.userId
body.userId
body.actorId
```

It performs no request-time persistence write.

## 10. Authentication routes

P10-A V1 defines:

```text
GET  /auth/login
POST /auth/login
POST /auth/logout
GET  /auth/session
POST /auth/password/change
```

### 10.1 Login

Input:

```text
email
password
returnPath optional same-origin relative path
```

Nonexistent email, wrong password and disabled user all return the same bounded error:

```text
INVALID_CREDENTIALS
```

Successful login:

1. passes rate limiting;
2. validates credentials;
3. creates a fresh UserSession;
4. records SESSION_CREATED audit;
5. sets the session cookie.

### 10.2 Logout

Logout requires authentication and CSRF.

It transactionally revokes the current session, appends SESSION_REVOKED audit and clears the cookie.

### 10.3 Session endpoint

`GET /auth/session` is persisted-read only and returns bounded user/session identity. It never returns password data, token hashes or the server CSRF key.

It can return the derived current-session CSRF token to same-origin authenticated browser code.

### 10.4 Password change

Password change requires authentication, valid CSRF, current password verification and a new password satisfying Section 6.

One transaction:

1. updates password hash/version;
2. revokes every active session for that user, including current;
3. appends PASSWORD_CHANGED and SESSIONS_REVOKED_ALL audit events.

The caller must log in again.

## 11. Login rate limiting

P10-A introduces an injected `LoginAttemptLimiter` port.

Production uses existing Redis infrastructure through `REDIS_URL`.

The rate-limit key is a SHA-256 digest of:

```text
normalized email + server-derived source IP
```

V1 policy is exact:

```text
maximum failed attempts = 10
window = fixed 15-minute bucket
scope = normalized email + source IP
```

Rules:

- success clears the current failure bucket for that key;
- rate-limit responses do not reveal whether the user exists;
- Redis values never contain passwords/session tokens;
- if Redis limiter storage is unavailable in production, login fails closed with 503;
- tests use deterministic injected limiter fakes except dedicated Redis integration coverage.

Source IP uses the connection address by default. P10-A MUST NOT enable unrestricted `trust proxy=true`; any future reverse-proxy trust configuration must explicitly constrain trusted proxies/hops so clients cannot spoof the limiter IP through arbitrary forwarded headers.

The limiter is login-only in P10-A V1, not a general abuse platform.

## 12. Project membership model

### 12.1 ProjectRole

```text
OWNER
ADMIN
OPERATOR
VIEWER
```

### 12.2 MembershipStatus

```text
ACTIVE
REVOKED
```

### 12.3 ProjectMembership

Conceptual fields:

```text
id         UUID primary key
projectId  FK -> Project
userId     FK -> User
role       ProjectRole
status     MembershipStatus
createdAt
updatedAt

UNIQUE(projectId, userId)
```

Revoked memberships remain persisted for history. Reactivation occurs only through the membership command policy.

Ownership is one or more ACTIVE OWNER memberships. `Project` does not receive a single `ownerId`.

## 13. Project capability model

Routes/services do not scatter `role === ...` checks.

P10-A defines central `ProjectCapability` values and one deterministic role mapping.

V1 capabilities:

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

### 13.1 VIEWER

VIEWER has read-only project/data capabilities:

```text
PROJECT_READ
EXPERIMENT_READ
FEEDBACK_READ
```

VIEWER does not receive membership-list access or mutation capability.

### 13.2 OPERATOR

OPERATOR includes VIEWER read capabilities plus:

```text
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
```

Every operation remains subject to existing plan/domain authority.

### 13.3 ADMIN

ADMIN includes OPERATOR plus:

```text
PROJECT_SETTINGS_WRITE
PROJECT_MEMBER_READ
PROJECT_MEMBER_MANAGE_BASIC
```

ADMIN member management is limited to VIEWER and OPERATOR targets.

ADMIN cannot create/modify/revoke OWNER or ADMIN memberships and cannot promote any member to ADMIN/OWNER.

### 13.4 OWNER

OWNER includes ADMIN plus:

```text
PROJECT_MEMBER_MANAGE_ALL
```

OWNER may manage all roles subject to the last-owner invariant, but cannot bypass plan/domain authority.

## 14. Last-owner invariant

Every project MUST have at least one ACTIVE OWNER once P10-A authorization is enabled.

Membership commands fail closed if their transaction would produce zero ACTIVE OWNER memberships.

Forbidden outcomes:

```text
revoke last OWNER
demote last OWNER
remove last OWNER
```

Ownership transfer requires promoting another member to OWNER before the previous last OWNER is demoted/revoked.

The command/repository transaction enforces the invariant; UI checks are not authoritative.

## 15. Membership API

P10-A V1 adds:

```text
GET    /api/projects/:projectId/members
POST   /api/projects/:projectId/members
PATCH  /api/projects/:projectId/members/:membershipId
DELETE /api/projects/:projectId/members/:membershipId
```

### 15.1 Read

`GET` requires `PROJECT_MEMBER_READ`, therefore ADMIN or OWNER.

### 15.2 Add/reactivate

`POST` accepts only:

```text
email
role
```

The email resolves to an existing ACTIVE User.

If the membership does not exist, create ACTIVE membership subject to the actor's management capability and target-role rule.

If the membership exists with REVOKED status, POST reactivates that row with the requested allowed role and appends MEMBERSHIP_REACTIVATED audit.

Missing or disabled users return exactly:

```text
404 USER_NOT_AVAILABLE
```

No global user inventory is returned.

### 15.3 Role change

`PATCH` accepts only the new role and applies central target-role rules plus last-owner invariant.

### 15.4 Revoke

`DELETE` performs logical revocation (`status = REVOKED`) and preserves the row.

## 16. Global user provisioning and administration

P10-A V1 has no public signup and no project route that creates a global User.

Global identity administration is an explicit server-operator CLI boundary with these commands:

```text
auth bootstrap-owner
auth provision-user
auth disable-user
auth enable-user
```

Passwords are read through interactive stdin/TTY confirmation and are never accepted as command-line password arguments.

`auth provision-user` creates an ACTIVE User with no implicit ProjectMembership.

`auth disable-user` transactionally sets User status DISABLED, revokes all active sessions and appends USER_DISABLED + SESSIONS_REVOKED_ALL audit events.

`auth enable-user` sets status ACTIVE and appends USER_ENABLED. It does not create a session or restore revoked memberships.

No HTTP endpoint lists all global users.

## 17. Initial owner bootstrap

P10-A uses explicit one-time bootstrap rather than startup-time implicit admin creation.

`auth bootstrap-owner` is one database transaction:

1. confirm User count is zero under a transaction/advisory-lock-safe uniqueness boundary;
2. create the initial ACTIVE User;
3. create ACTIVE OWNER memberships for every existing Project;
4. append USER_PROVISIONED and membership audit rows;
5. commit all or nothing.

Rules:

- if there are no Projects, only User + audit are created;
- if one or more Users already exist, fail closed and write nothing;
- password is never a CLI argument;
- output never prints password/hash/session data.

This migrates all pre-P10-A projects without hard-coding an admin into schema migration.

## 18. Project create/list/get/update after P10-A

### 18.1 Create

`POST /api/projects` requires authentication and CSRF.

One transaction creates:

```text
Project
+
ProjectMembership {
  userId = authenticated User.id
  role = OWNER
  status = ACTIVE
}
+
MEMBERSHIP_CREATED audit
```

Failure of any write rolls back the whole transaction. Normal HTTP cannot create an ownerless project.

### 18.2 List

`GET /api/projects` returns only Projects joined through the authenticated user's ACTIVE memberships. It never calls an unscoped project `findMany()` for the response.

### 18.3 Get

`GET /api/projects/:id` requires `PROJECT_READ`.

Missing project and no-active-membership project use the same non-enumerating `PROJECT_NOT_FOUND` behavior.

### 18.4 Update

`PATCH /api/projects/:id` requires CSRF plus `PROJECT_SETTINGS_WRITE`.

## 19. Middleware chain

For project-scoped browser mutation:

```text
authenticationMiddleware
→ requireAuthentication
→ requireCsrf
→ requireProjectMembership
→ requireProjectCapability(...)
→ requireFeature(...) when feature-gated
→ request schema validation
→ domain command/service
```

For project reads:

```text
authenticationMiddleware
→ requireAuthentication
→ requireProjectMembership
→ requireProjectCapability(PROJECT_READ or narrower read capability)
→ requireFeature(...) when feature-gated
→ persisted read
```

`requireProjectMembership` resolves Project + ACTIVE membership once and stores them in `res.locals`.

`requireFeature()` reuses `res.locals.project` when available and retains compatibility lookup only for not-yet-migrated internal tests/routes during implementation. Release completion requires all project-scoped production routes to be classified and protected.

Role and PlanLevel remain separate dimensions.

Examples:

```text
OWNER + STANDARD
→ cannot use ADVANCED-only Operations Center

VIEWER + ADVANCED
→ may read Operations Center
→ may not revise policy

OPERATOR + ADVANCED
→ may request policy revision
→ cannot change P9-C authority fields
```

## 20. Public route boundary

P10-A V1 public routes are limited to:

```text
/health
/assets/*
GET /auth/login
POST /auth/login
```

All project-scoped API/web surfaces require authentication by release completion.

Login return paths must be same-origin relative application paths.

## 21. P9-F Operations Actor rollout

P9-F already requires a server-resolved actor for policy revision.

P10-A production actor resolution becomes:

```text
req.auth User
→ ACTIVE ProjectMembership
→ AUTOPILOT_POLICY_REVISE capability
→ OperationsActor { actorId = User.id }
```

Stable `User.id` is the audit actor; email is not.

The client still cannot submit:

```text
actorId
allowedRiskClass
allowedOperationClasses
```

P9-F policy command retains:

- optimistic concurrency;
- request idempotency;
- immutable AutopilotPolicyRevision;
- atomic policy update + revision;
- P9-C LOW + CREATE_CONTENT_PAGE hard lock.

## 22. P9-F SSR integration

Operations Center read requires authenticated project read access plus existing `OPTIMIZATION_OPERATIONS_CENTER` feature entitlement.

`policyMutationAvailable` is derived server-side from:

```text
authenticated User
AND ACTIVE membership
AND AUTOPILOT_POLICY_REVISE
AND OPTIMIZATION_OPERATIONS_CENTER
```

UI state is informational. The POST route repeats the complete server authorization chain.

## 23. Preserve persisted-read GET semantics

Ordinary authenticated GET/HEAD requests MUST NOT:

- update UserSession timestamps;
- rotate sessions;
- refresh expiration;
- append audit merely because a page was viewed;
- enqueue login/session maintenance;
- trigger provider/AI/Git/feedback materialization side effects.

This preserves P9-F persisted-read semantics.

## 24. Security audit persistence

P10-A adds an append-only `SecurityAuditEvent` model.

Event vocabulary:

```text
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
```

Conceptual fields:

```text
id
version = SECURITY_AUDIT_V1
eventType
actorUserId nullable
targetUserId nullable
projectId nullable
roleBefore nullable
roleAfter nullable
createdAt
```

`actorUserId = null` is reserved for authenticated-server-operator bootstrap/provisioning actions where no application User actor exists yet.

Audit MUST NOT contain:

```text
password
passwordHash
session token
tokenHash
CSRF token
cookie
Authorization header
raw request body
provider credentials
```

Audit rows are append-only and protected from update/delete using the repository's existing immutable-row database pattern.

## 25. Database migration strategy

P10-A uses forward additive migration(s) only.

They create:

- UserStatus;
- ProjectRole;
- MembershipStatus;
- SecurityAuditEventType or equivalent bounded enum;
- User;
- UserSession;
- ProjectMembership;
- SecurityAuditEvent;
- required indexes, unique constraints, foreign keys and audit immutability trigger.

They do NOT:

- create a hard-coded user;
- assign memberships from a literal email;
- modify historical P9 actor ids;
- delete/rewrite P7/P8/P9 rows;
- drop existing project data;
- rewrite existing AutopilotPolicyRevision rows.

Existing projects get their first OWNER only through `auth bootstrap-owner`.

## 26. Production rollout order

P10-A production rollout is:

```text
1. use the P10-A release artifact to apply forward DB migration
2. run auth bootstrap-owner from the same trusted artifact
3. verify every existing Project has >= 1 ACTIVE OWNER
4. start/promote the P10-A web application
5. smoke valid login
6. smoke membership-scoped project list
7. smoke cross-project denial
8. smoke P9-F policy revision actor attribution
```

There is no temporary production auth bypass.

If owner verification fails, authenticated traffic is not promoted.

## 27. Rollback boundary

The database migration is additive and may remain present if runtime rollback is necessary.

However, once P10-A authentication becomes the production access boundary, traffic MUST NOT be rolled back directly to an old unauthenticated P9 web build without an independent external access restriction/maintenance boundary. Doing so would reopen project routes that P10-A intentionally protects.

Runtime rollback therefore means either:

- keep P10-A authentication in front while reverting a later P10-A behavior; or
- place the service behind an explicit operator-only maintenance/perimeter restriction before starting an older build.

Rollback never deletes P9/P10 identity history merely to restore runtime availability.

## 28. Error semantics

Required public errors:

```text
AUTHENTICATION_REQUIRED        401
INVALID_CREDENTIALS            401
AUTH_SESSION_INVALID           401
CSRF_INVALID                   403
PROJECT_NOT_FOUND              404
PROJECT_CAPABILITY_REQUIRED    403
FEATURE_NOT_AVAILABLE          403
LAST_PROJECT_OWNER_REQUIRED    409
USER_NOT_AVAILABLE             404
LOGIN_RATE_LIMITED             429
AUTH_RATE_LIMITER_UNAVAILABLE  503
```

`PROJECT_NOT_FOUND` is used both for an absent project and a project hidden by no ACTIVE membership.

Error mapping is centralized and never exposes credential/membership internals.

P9-F conflict/idempotency errors remain intact.

## 29. Testing strategy

P10-A implementation follows RED → minimal GREEN per task.

### 29.1 Unit

Required coverage:

- email normalization;
- password length policy;
- scrypt create/parse/verify;
- malformed hash fail-closed;
- session digest/expiry/revocation;
- CSRF derivation/verification;
- same-origin login Origin/returnPath validation;
- role → ProjectCapability matrix;
- ADMIN target-role restrictions;
- last-owner invariant;
- fixed-window login limiter.

### 29.2 Integration

Required contracts include:

```text
unauthenticated project list → 401
unauthenticated project mutation → 401
invalid session → 401
revoked session → 401
disabled User with valid-looking session → 401

User A requests User B project
→ PROJECT_NOT_FOUND
→ no protected data

VIEWER project read permitted
VIEWER membership list denied
VIEWER mutation rejected before side effect

OPERATOR + ADVANCED Operations read permitted
OPERATOR + ADVANCED policy revision permitted with CSRF
OPERATOR + STANDARD feature rejected
OWNER + STANDARD feature rejected

missing/invalid CSRF
→ command not called
→ queue/provider/AI/Git adapters not called

client actorId / allowedRiskClass / allowedOperationClasses
→ rejected before policy command

project creation
→ Project + OWNER membership commit atomically

last OWNER demotion/revocation
→ transaction rejected

membership role downgrade/revocation
→ effective on next request without re-login

disabled User
→ all sessions revoked by operator command
```

### 29.3 Read purity

At least one real integration contract proves authenticated GET does not update UserSession or append a security audit row simply because data was read.

### 29.4 P9 authority regression

Release must prove no human role enables:

- MEDIUM/HIGH autopilot;
- non-`CREATE_CONTENT_PAGE` P9-C automation;
- fake human approval;
- direct P9-C Git mutation;
- auto-merge;
- auto-deploy;
- auto-rollback;
- writable global kill switch;
- P8 verification bypass;
- client actor override.

## 30. Browser E2E

Required Chromium flows:

1. valid local login;
2. project list shows only ACTIVE memberships;
3. cross-project URL does not leak project existence;
4. VIEWER reads an allowed Operations page and has no policy mutation controls;
5. OPERATOR with Advanced sees policy controls;
6. valid CSRF policy revision succeeds and audit actor equals authenticated User.id;
7. logout revokes protected access;
8. existing P8/P9 browser smoke remains green.

No E2E uses production credentials or live provider writes.

## 31. Migration verification

Exact-head verification covers both:

### 31.1 Blank database

All migrations from zero apply successfully.

### 31.2 Current P9 shape

A database representing `main@60733718026b1876340d50ff8626fcd8cd1558f5` applies only forward P10-A migrations without rewriting P9 facts/history.

## 32. Release gate

P10-A uses the established exact-head jobs:

```text
production-audit
e2e
verify
```

`verify` includes:

```text
Prisma Validate
Prisma Generate
Prisma migrate deploy
Typecheck
Full Vitest
Build
```

Before Ready for Review:

- reviewed PR head SHA equals CI head SHA;
- all three jobs are green on that exact head;
- changed-file authority review is complete;
- auth/RBAC static boundary scans are complete;
- expected negative database/security logs are inspected rather than described as globally clean;
- unresolved review threads are zero or explicitly resolved.

Merge requires separate explicit human authorization.

Deployment requires another separate explicit human authorization.

## 33. Implementation decomposition

The implementation plan must use bounded RED→GREEN slices in this order:

1. identity enums/models, SecurityAuditEvent foundation and password contracts;
2. UserSession persistence, request auth augmentation and resolver;
3. login/session/logout/password-change routes, login Origin protection and CSRF;
4. bootstrap/provision/disable/enable CLI commands;
5. ProjectMembership, capability matrix and last-owner invariant;
6. membership API;
7. project create/list/get/update membership scoping;
8. shared project middleware and `requireFeature()` integration;
9. P9-F actor rollout and Operations SSR controls;
10. remaining project-scoped read-route classification/adoption;
11. remaining mutation routes capability + CSRF adoption;
12. Redis login limiter integration;
13. P9 authority regression/static scans;
14. browser E2E, migration verification, development docs and exact-head release gate.

A slice can be split further when RED evidence exposes hidden complexity, but independent authority layers must not be collapsed into one unreviewable change.

## 34. Non-goals for V1

P10-A does not include:

- public signup;
- email verification;
- password reset email;
- magic links;
- OAuth login;
- MFA/passkeys;
- organization/workspace RBAC;
- SSO/SAML;
- SCIM;
- API keys/service accounts;
- billing/seat limits;
- custom permission editor;
- invitation email delivery;
- cross-project organization roles;
- any new P9 autonomous authority.

## 35. Success criteria

P10-A is complete only when all are true:

1. protected requests derive user identity only from validated server-side session state;
2. project requests verify ACTIVE membership before protected data/mutation;
3. roles map through central ProjectCapability policy;
4. PlanLevel and human RBAC remain separate gates;
5. unsafe cookie-authenticated mutations require CSRF;
6. login is same-origin protected and rate-limited;
7. all existing projects receive a bootstrap OWNER before authorization enforcement;
8. new project creation atomically creates its OWNER membership;
9. last ACTIVE OWNER cannot be removed/demoted/revoked;
10. P9-F policy revision actor is authenticated stable User.id;
11. P9-F client authority-field protections remain intact;
12. authenticated GET paths remain request-write-free;
13. OWNER cannot bypass P7/P8/P9 domain authority;
14. no auto Merge/Deploy/Rollback/global-kill-switch write capability is added;
15. exact-head production-audit/e2e/verify are green;
16. merge and deployment remain separately authorized human actions.
