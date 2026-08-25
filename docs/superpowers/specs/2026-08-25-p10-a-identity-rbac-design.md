# P10-A Identity, Session, Project Membership and RBAC Design

Date: 2026-08-25
Status: Approved design
Repository: `liufaxing1978-droid/seogeo`
Base: `main@60733718026b1876340d50ff8626fcd8cd1558f5`
Branch: `feat/p10-a-identity-rbac`

## 1. Purpose

P10-A introduces application-native identity, server-side sessions, project membership, role-based access control, CSRF protection, and trusted actor propagation so production mutations can be attributed to authenticated humans without weakening any existing P7/P8/P9 authority boundary.

P10-A answers four questions that the current application does not answer centrally:

1. Who is making this request?
2. Does that user belong to this project?
3. Does that project role allow the user to request this operation?
4. Does the existing plan/domain authority still allow the operation?

The authority chain is therefore:

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

The design extends the existing Express/EJS/Prisma application rather than introducing a second application framework.

Current repository facts relevant to P10-A:

- `createApp()` has no authentication/session middleware;
- `AppOptions` already exposes the P9-F `OperationsActorResolver` seam;
- `requireFeature()` checks project plan entitlement, not user identity or role;
- project create/list/get/update routes are not membership-scoped;
- `Project` has no owner/user/membership relation;
- Prisma uses the repository multi-file schema layout under `prisma/models`;
- `SESSION_SECRET` already exists in environment configuration but is not currently used for application authentication;
- P9-F policy revision already fails closed when no trusted server actor is available;
- P9-F rejects client-controlled `actorId`, `allowedRiskClass`, and `allowedOperationClasses`;
- P9-F GET/SSR surfaces are persisted-read only and must not acquire request-time authentication writes.

## 3. Chosen approach

### 3.1 Authentication approach

P10-A V1 uses local email + password authentication backed by application-native `User` and `UserSession` persistence.

Rejected alternatives:

- public self-registration: deferred because it requires verification, abuse handling, recovery and customer-facing onboarding;
- email magic link: deferred because the repository has no transactional email delivery foundation;
- Google/GitHub OAuth as the sole identity source: deferred so core project authorization is not coupled to one external provider;
- Cloudflare Access-only authorization: may remain an optional perimeter control but does not replace application identity or project RBAC.

Future OAuth or passwordless providers may map into the same stable application `User.id` without changing ProjectMembership semantics.

### 3.2 HTTP integration approach

P10-A uses a global optional authentication resolver plus explicit route authorization middleware.

It does not globally reject every unauthenticated request because `/health`, static assets and login routes remain public.

It does not allow each route to parse sessions or inspect raw roles independently.

## 4. Hard authority boundaries

P10-A MUST NOT:

- let a client submit or override the authenticated actor id;
- let a client submit a project role as proof of authorization;
- let OWNER or ADMIN bypass plan feature gates;
- let any human role change P7 Growth score, evidence, lifecycle or UNKNOWN semantics;
- let any human role bypass P8 risk, approval, immutable PublicationPlan, preview, mutation validation or VERIFIED semantics;
- expand P9-C automation beyond exact LOW-risk `CREATE_CONTENT_PAGE`;
- add automatic Merge authority;
- add automatic Deploy authority;
- add automatic Rollback authority;
- add a writable global autopilot kill switch;
- let authentication GET middleware enqueue work, call providers, call AI, call Git, materialize feedback, or update request activity timestamps;
- introduce a production authentication bypass, fallback actor, hard-coded admin actor, or client header/body identity fallback.

`OWNER` means highest project human role. It is not a domain superuser.

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
passwordHash        encoded password hash
passwordHashVersion integer
status              ACTIVE | DISABLED
createdAt
updatedAt
```

Rules:

- `normalizedEmail` is the unique login identity;
- normalization trims surrounding whitespace and applies a deterministic lowercase normalization to the complete email string;
- normalization does not invent Gmail/provider-specific dot or plus-address semantics;
- a disabled user cannot create a new session;
- a disabled user cannot continue using an existing session;
- password material never appears in application logs, audit metadata, API responses or observability events.

## 6. Password hashing

P10-A V1 uses Node.js `crypto.scrypt` behind a narrow `PasswordHasher` port.

Required encoded format is versioned and self-describing. V1 conceptually records:

```text
algorithm = scrypt
formatVersion = 1
N = 32768
r = 8
p = 1
salt = 32 random bytes
derivedKey = 64 bytes
```

Verification uses constant-time comparison (`timingSafeEqual`) after deriving the candidate key with the stored parameters.

Rules:

- every password receives a cryptographically random independent salt;
- raw SHA-256/MD5/SHA-1 password hashing is forbidden;
- plaintext password is never persisted;
- password hash format and hash parameters are parsed from the encoded server-produced value, not from client input;
- malformed stored password hashes fail closed;
- `passwordHashVersion` permits a future successful-login rehash migration without changing user identity.

P10-A does not implement password recovery email or MFA.

## 7. Server-side session model

### 7.1 UserSession

Conceptual fields:

```text
id          UUID primary key
userId      FK -> User
 tokenHash   unique SHA-256 digest of random session token
createdAt
expiresAt
revokedAt   nullable
```

P10-A deliberately does not update `lastSeenAt` on ordinary requests. This preserves the existing P9-F persisted-read GET boundary.

### 7.2 Session token

At successful login:

1. generate at least 32 random bytes using a cryptographically secure RNG;
2. encode as an opaque base64url token;
3. store only SHA-256(token) in `UserSession.tokenHash`;
4. return only the raw token in the HttpOnly session cookie.

Session lookup hashes the presented cookie token and performs an indexed equality lookup by `tokenHash`.

### 7.3 Session lifetime

P10-A V1 uses a seven-day absolute expiration.

There is no sliding expiration and no request-time session refresh.

A session is valid only when all are true:

- session row exists;
- `revokedAt IS NULL`;
- `expiresAt > now`;
- related user status is `ACTIVE`.

### 7.4 Cookie

Cookie name is an application-owned constant and MUST be configured with:

```text
HttpOnly = true
Secure = true in production
SameSite = Lax
Path = /
Max-Age aligned with absolute session lifetime
```

Login always creates a new session token. An existing cookie is never promoted into an authenticated session.

## 8. CSRF design

Because browser authentication is cookie-based, every authenticated unsafe method requires CSRF validation before business mutation.

Unsafe methods are:

```text
POST
PUT
PATCH
DELETE
```

P10-A uses a server-derived per-session CSRF token.

Conceptually:

```text
csrfToken = HMAC-SHA256(SESSION_SECRET, canonical(sessionId + tokenHash))
```

The server can derive the token from authenticated server state without storing a second raw secret in the database.

Rules:

- SSR forms receive the CSRF value as a hidden input;
- authenticated browser JSON requests send `X-CSRF-Token`;
- comparison is constant-time;
- CSRF validation runs before business commands, queue operations, AI/provider work or Git work;
- GET/HEAD do not mutate state and do not require CSRF;
- CSRF token is never accepted as authentication;
- `SESSION_SECRET` in production must be a non-default high-entropy secret of at least 32 bytes/characters as validated by application config;
- development/test may use an explicit local default.

## 9. Authentication request context

P10-A adds one global optional authentication middleware after request parsing and before protected application routes.

It resolves:

```text
session cookie
→ token digest
→ UserSession
→ User
→ res.locals.auth
```

Authenticated request context is:

```text
AuthenticatedActor {
  userId: string
  sessionId: string
}
```

Unauthenticated/invalid requests receive:

```text
res.locals.auth = null
```

The middleware MUST NOT read identity from:

```text
X-User-Id
X-Actor-Id
Authorization values pretending to be local session identity
query.userId
body.userId
body.actorId
```

The middleware performs no request-time persistence write.

## 10. Authentication routes

P10-A V1 defines these browser/API authentication capabilities:

```text
GET  /auth/login
POST /auth/login
POST /auth/logout
GET  /auth/session
POST /auth/password/change
```

### 10.1 Login

Login input:

```text
email
password
```

Failure for nonexistent email, invalid password or disabled user returns one bounded public error:

```text
INVALID_CREDENTIALS
```

The response does not reveal which credential fact failed.

Successful login creates a fresh UserSession and sets the session cookie.

### 10.2 Logout

Logout requires authentication and CSRF.

It sets the current session `revokedAt` and clears the browser cookie.

### 10.3 Session endpoint

`GET /auth/session` is read-only and returns bounded authenticated-user/session state. It never returns token hashes, password fields or CSRF server secrets.

### 10.4 Password change

Password change requires:

- active authentication;
- valid CSRF;
- current password verification;
- valid new password input.

On success, one transaction:

1. updates the password hash/version;
2. revokes every active UserSession for that user, including the current session.

The caller must log in again.

## 11. Login rate limiting

P10-A introduces an injected `LoginAttemptLimiter` port.

The production default uses the repository's existing Redis infrastructure (`REDIS_URL`) with bounded keys derived from a non-reversible hash of:

```text
normalized email + source IP
```

Required V1 policy:

- rolling/fixed bounded window equivalent to at most 10 failed attempts per 15 minutes per email+IP key;
- successful authentication clears the bounded failure bucket for that key;
- rate-limit errors do not reveal whether the email exists;
- Redis payloads do not store plaintext passwords or session tokens;
- if the production limiter backend is unavailable, login fails closed with a bounded service-unavailable error rather than silently disabling the limiter;
- tests use an injected deterministic fake/in-memory limiter rather than a live external Redis service unless a dedicated integration test explicitly targets Redis.

The rate limiter protects the login endpoint only in P10-A V1. It is not a general application abuse platform.

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

A revoked membership remains persisted for historical continuity and can only be reactivated through the membership command policy.

Project ownership is represented by one or more ACTIVE OWNER memberships. `Project` does not receive a single `ownerId` field.

## 13. Project capability model

Routes and services do not scatter `role === ...` checks.

P10-A defines central `ProjectCapability` values and a deterministic role-to-capability mapping.

Initial V1 capabilities:

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

VIEWER receives read-only capabilities, including:

```text
PROJECT_READ
PROJECT_MEMBER_READ
EXPERIMENT_READ
FEEDBACK_READ
```

and read access to other project surfaces for which the plan feature gate permits viewing.

VIEWER receives no mutation capability.

### 13.2 OPERATOR

OPERATOR includes VIEWER read capabilities plus normal operational capabilities:

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

Every operation remains subject to its existing plan and domain authority.

### 13.3 ADMIN

ADMIN includes OPERATOR capabilities plus:

```text
PROJECT_SETTINGS_WRITE
PROJECT_MEMBER_MANAGE_BASIC
```

ADMIN membership management is limited to VIEWER and OPERATOR target memberships.

ADMIN cannot:

- create OWNER memberships;
- create ADMIN memberships;
- modify an OWNER membership;
- modify another ADMIN membership;
- promote itself or another user to OWNER/ADMIN.

### 13.4 OWNER

OWNER includes ADMIN capabilities plus:

```text
PROJECT_MEMBER_MANAGE_ALL
```

OWNER may manage all membership roles subject to the last-owner invariant.

OWNER still cannot bypass plan or domain authority.

## 14. Last-owner invariant

Every normal project MUST have at least one ACTIVE OWNER after P10-A authorization is enabled.

Membership commands fail closed if an operation would produce zero ACTIVE OWNER memberships.

Forbidden atomic outcomes include:

```text
revoke last OWNER
demote last OWNER
remove last OWNER
```

Ownership transfer requires promoting another membership to OWNER before the previous last OWNER is demoted/revoked.

The invariant is enforced in the membership command/repository transaction, not only in the UI.

## 15. Membership HTTP API

P10-A V1 adds:

```text
GET    /api/projects/:projectId/members
POST   /api/projects/:projectId/members
PATCH  /api/projects/:projectId/members/:membershipId
DELETE /api/projects/:projectId/members/:membershipId
```

### 15.1 Read

`GET` requires `PROJECT_MEMBER_READ`.

The response is bounded and never includes password/session secrets.

### 15.2 Add/reactivate member

`POST` accepts:

```text
email
role
```

The email must resolve to an existing ACTIVE User. P10-A does not create a global User through this project endpoint.

If a matching project membership is REVOKED, the command may reactivate it subject to actor capability and target-role rules.

A missing/disabled user returns a bounded `USER_NOT_AVAILABLE` style error without exposing global user inventory.

### 15.3 Change role

`PATCH` accepts only the new role and applies central target-role policy plus the last-owner invariant.

### 15.4 Revoke

`DELETE` is logical revocation:

```text
status = REVOKED
```

It does not physically delete the membership row.

## 16. Global user provisioning

P10-A V1 has no public signup and no project route that creates a global User.

Global identity provisioning remains an explicit server-operator CLI responsibility.

Two CLI commands are in scope:

```text
auth bootstrap-owner
auth provision-user
```

The CLI accepts email as a normal argument/input but reads passwords through interactive standard input/TTY confirmation, never as a command-line password argument.

Global user disable/enable may be provided through the same server-operator boundary if included by the implementation plan; it is not project RBAC authority.

No HTTP endpoint lists all global users.

## 17. Initial owner bootstrap

P10-A uses an explicit one-time bootstrap command rather than startup-time implicit admin creation.

`auth bootstrap-owner` rules:

- allowed only when the database contains zero User rows;
- creates the initial ACTIVE User;
- in the same command, creates ACTIVE OWNER memberships for every existing Project;
- if there are no Projects, creates only the User;
- if one or more Users already exist, fails closed and makes no changes;
- password is never accepted through a command-line argument;
- command output never prints password/password hash/session data.

This command solves migration of all pre-P10-A projects without hard-coding an administrator in a migration.

## 18. Project creation and listing after P10-A

### 18.1 Create project

`POST /api/projects` requires authentication because no project membership exists before creation.

Creation is one database transaction:

```text
create Project
+
create ProjectMembership {
  userId = authenticated user
  role = OWNER
  status = ACTIVE
}
```

If either write fails, the entire transaction rolls back.

An ownerless project cannot be created through the normal HTTP command.

### 18.2 List projects

`GET /api/projects` no longer calls an unscoped `findMany()`.

It returns only Projects with an ACTIVE membership for the authenticated user.

### 18.3 Get project

`GET /api/projects/:id` requires `PROJECT_READ`.

A missing project and a project for which the actor has no active membership use the same non-enumerating not-found behavior.

### 18.4 Update project

`PATCH /api/projects/:id` requires `PROJECT_SETTINGS_WRITE` plus CSRF.

## 19. Middleware chain

For project-scoped authenticated browser mutation, the required order is:

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

For project-scoped reads:

```text
authenticationMiddleware
→ requireAuthentication
→ requireProjectMembership
→ requireProjectCapability(PROJECT_READ or narrower read capability)
→ requireFeature(...) when feature-gated
→ persisted read
```

`requireProjectMembership` resolves the Project and membership once and stores them in `res.locals`.

`requireFeature()` is changed to reuse `res.locals.project` when available and retain a compatibility lookup fallback for routes/tests that have not yet adopted membership middleware.

Role and PlanLevel remain separate policy dimensions.

Examples:

```text
OWNER + STANDARD
→ cannot use ADVANCED-only Operations Center

VIEWER + ADVANCED
→ may read Operations Center
→ may not revise policy

OPERATOR + ADVANCED
→ may request policy revision
→ request still cannot change P9-C authority fields
```

## 20. Public route boundary

P10-A V1 public routes are limited to:

```text
/health
/assets/*
GET /auth/login
POST /auth/login
```

All project-scoped application/API surfaces require authentication after route migration is complete.

The login page does not accept arbitrary external post-login redirect targets. Any return path is normalized to a same-origin relative application path.

## 21. P9-F Operations Actor rollout

P9-F already requires a server-resolved actor for policy revision.

P10-A changes the production resolver source to:

```text
Authenticated User
→ ACTIVE ProjectMembership
→ AUTOPILOT_POLICY_REVISE capability
→ OperationsActor { actorId = User.id }
```

Stable `User.id` is the canonical audit actor. Email is not the audit actor because email can change in future phases.

The client still cannot submit:

```text
actorId
allowedRiskClass
allowedOperationClasses
```

The policy revision command keeps:

- optimistic concurrency;
- request idempotency;
- immutable AutopilotPolicyRevision;
- atomic policy update + revision write;
- P9-C hard lock on LOW + CREATE_CONTENT_PAGE.

## 22. P9-F SSR integration

The Operations Center read page requires authenticated project read access plus the existing `OPTIMIZATION_OPERATIONS_CENTER` feature gate.

`policyMutationAvailable` is no longer based only on actor presence. It is derived server-side from all required human authorization facts:

```text
authenticated user
AND active membership
AND AUTOPILOT_POLICY_REVISE
AND OPTIMIZATION_OPERATIONS_CENTER feature
```

The UI state is informational only. The POST route repeats the complete server authorization chain.

## 23. Preserve persisted-read GET semantics

P10-A authentication MUST NOT turn existing read routes into hidden writes.

Therefore ordinary authenticated GET/HEAD requests do not:

- update UserSession timestamps;
- rotate sessions;
- refresh expiration;
- write audit rows solely because a page was viewed;
- enqueue login/session maintenance work.

This specifically preserves the P9-F persisted-read Operations Center contract.

## 24. Identity and membership audit

P10-A adds a small append-only bounded security audit surface rather than a general SIEM.

Initial event vocabulary:

```text
USER_PROVISIONED
USER_DISABLED
USER_ENABLED
SESSION_CREATED
SESSION_REVOKED
SESSIONS_REVOKED_ALL
MEMBERSHIP_CREATED
MEMBERSHIP_REACTIVATED
MEMBERSHIP_ROLE_CHANGED
MEMBERSHIP_REVOKED
```

Allowlisted fields may include:

```text
eventType
actorUserId nullable for bootstrap/server-operator events
targetUserId
projectId nullable
roleBefore nullable
roleAfter nullable
createdAt
```

Audit events MUST NOT contain:

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

Membership role/revocation history must remain reconstructable through current state plus append-only audit events.

## 25. Database migration strategy

P10-A uses forward additive migrations only.

The migration creates:

- UserStatus enum;
- ProjectRole enum;
- MembershipStatus enum;
- User;
- UserSession;
- ProjectMembership;
- identity/security audit persistence if implemented as a dedicated table;
- required indexes, unique constraints and foreign keys.

The migration does NOT:

- create a hard-coded user;
- assign memberships based on an email literal;
- modify historical P9 actor ids;
- delete/rewrite P7/P8/P9 rows;
- drop existing project data;
- rewrite existing AutopilotPolicyRevision rows.

Existing projects receive their first OWNER only through the explicit bootstrap command.

## 26. Production rollout order

P10-A production rollout must follow this order:

```text
1. deploy/apply forward database migration
2. run auth bootstrap-owner
3. verify every existing project has >= 1 ACTIVE OWNER
4. start the P10-A application version
5. verify login
6. verify membership-scoped project list
7. verify protected cross-project access
8. verify P9-F policy revision actor attribution
```

There is no temporary production auth bypass.

If bootstrap verification fails, the new application version must not be promoted as ready for authenticated traffic.

## 27. Error semantics

Required bounded error classes include:

```text
AUTHENTICATION_REQUIRED        401
INVALID_CREDENTIALS            401
AUTH_SESSION_INVALID           401
CSRF_INVALID                   403
PROJECT_NOT_FOUND              404 for absent or unauthorized project visibility
PROJECT_CAPABILITY_REQUIRED    403
FEATURE_NOT_AVAILABLE          403 existing feature gate
LAST_PROJECT_OWNER_REQUIRED    409
USER_NOT_AVAILABLE             404/409 bounded membership provisioning failure
LOGIN_RATE_LIMITED             429
AUTH_RATE_LIMITER_UNAVAILABLE  503
```

Exact HTTP error mapping is centralized; routes do not include credential or membership internals in public messages.

P9-F existing policy command conflict/idempotency errors remain unchanged except that ordinary authenticated authorization no longer relies on an unavailable default actor resolver.

## 28. Testing strategy

P10-A implementation follows RED → minimal GREEN per task.

### 28.1 Unit tests

Required unit coverage:

- email normalization;
- scrypt encoded hash creation/parse/verification;
- malformed password hash fail-closed;
- session token digest and expiry/revocation;
- CSRF derivation/verification;
- role → ProjectCapability matrix;
- ADMIN target-role restrictions;
- last-owner invariant;
- return-path same-origin normalization;
- login limiter behavior.

### 28.2 Integration tests

Required database/HTTP integration contracts include:

```text
unauthenticated project list → 401
unauthenticated project mutation → 401
invalid session → 401
revoked session → 401
disabled user with otherwise-valid session → 401

User A requests User B project → PROJECT_NOT_FOUND
and no protected project data is returned

VIEWER GET permitted
VIEWER unsafe mutation rejected before command side effect

OPERATOR + ADVANCED Operations read permitted
OPERATOR + ADVANCED policy revision permitted with CSRF
OPERATOR + STANDARD feature rejected
OWNER + STANDARD feature still rejected

missing/invalid CSRF
→ policy/project command not called
→ queue/provider/AI/Git adapters not called

client actorId / allowedRiskClass / allowedOperationClasses
→ rejected before policy command

new project creation
→ project + OWNER membership commit atomically

last OWNER demotion/revocation
→ rejected transactionally

membership role downgrade/revocation
→ applies on next request without re-login
```

### 28.3 Authentication read purity tests

At least one integration contract proves authenticated GET routes do not update UserSession or write security audit rows simply because a page was read.

This contract protects P9-F persisted-read semantics.

### 28.4 P9 authority regression tests

Release requires explicit regression proof that no human role enables:

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

## 29. Browser E2E

Required Chromium paths include:

1. login with valid local user;
2. project list shows only active memberships;
3. cross-project URL does not leak project existence;
4. VIEWER can read an allowed project/Operations page and does not receive mutation controls;
5. OPERATOR with Advanced feature sees policy controls;
6. valid CSRF policy revision succeeds and audit actor matches authenticated User.id;
7. logout revokes access to protected pages;
8. existing P8/P9 browser smoke coverage remains green.

No E2E test uses a production credential or real external provider write.

## 30. Migration verification

P10-A exact-head verification must cover both:

### 30.1 Blank database

All migrations from zero apply successfully.

### 30.2 Current P9 database shape

A database representing current `main@60733718026b1876340d50ff8626fcd8cd1558f5` applies only the new forward P10-A migration(s) without rewriting existing P9 facts.

P9 immutable/history tables remain intact.

## 31. Release gate

P10-A uses the repository's established exact-head release gate:

```text
production-audit
e2e
verify
```

`verify` must include:

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
- all three required jobs are green on that exact head;
- changed-file authority review is complete;
- authentication/RBAC static boundary checks are complete;
- expected negative database/security logs are inspected rather than described as globally clean;
- unresolved review threads are zero or explicitly resolved before merge authorization.

Merge requires a separate explicit human authorization.

Deployment requires another separate explicit human authorization.

## 32. Implementation decomposition

The implementation plan should decompose P10-A into bounded TDD slices in this order:

1. identity enums/models and password hashing contracts;
2. UserSession persistence and authentication resolver;
3. login/logout/session/password-change routes and CSRF;
4. one-time bootstrap/provision-user CLI;
5. ProjectMembership model, capabilities and last-owner invariant;
6. membership API;
7. project create/list/get/update migration to membership scope;
8. shared project middleware and `requireFeature()` integration;
9. P9-F actor rollout and Operations SSR capability controls;
10. remaining project-scoped read routes authorization classification;
11. remaining mutation routes capability + CSRF adoption;
12. security audit and rate limiter integration;
13. P9 authority regression/static scans;
14. browser E2E, migration verification, development docs and exact-head release gate.

The implementation plan may split a slice further if RED evidence exposes hidden complexity, but it must not merge independent authority layers into one unreviewable change.

## 33. Non-goals for P10-A V1

P10-A does not include:

- public signup;
- email verification;
- password reset email;
- magic links;
- OAuth login;
- MFA/passkeys;
- organization/workspace-level RBAC;
- SSO/SAML;
- SCIM;
- API keys/service accounts;
- billing/seat limits;
- permission customization UI;
- automatic user invitation email;
- cross-project organization roles;
- any new P9 autonomous authority.

These can be additive future phases using stable User and ProjectMembership identities.

## 34. Success criteria

P10-A is complete when all are true:

1. every protected browser/API request derives user identity only from a validated server-side session;
2. every project request verifies an ACTIVE membership before protected data or mutation is exposed;
3. project roles map through central capabilities rather than scattered route role comparisons;
4. PlanLevel and human RBAC remain separate gates;
5. unsafe cookie-authenticated mutations require valid CSRF;
6. all existing projects can be assigned a bootstrap OWNER before authorization enforcement;
7. normal project creation atomically creates its OWNER membership;
8. the last ACTIVE OWNER cannot be removed/demoted/revoked;
9. P9-F policy revision actor id is the stable authenticated User.id;
10. P9-F client authority-field protections remain intact;
11. authenticated GET paths remain request-write-free;
12. OWNER cannot bypass P7/P8/P9 domain authority;
13. no auto Merge/Deploy/Rollback/global-kill-switch write capability is added;
14. exact-head production-audit/e2e/verify are green;
15. no deployment occurs without separate explicit human authorization.
