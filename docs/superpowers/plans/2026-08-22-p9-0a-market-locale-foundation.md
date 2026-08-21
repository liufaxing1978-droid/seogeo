# P9-0A Market & Locale Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a backward-compatible multi-market and locale foundation so one project can represent mainland China, overseas Chinese, and global markets without breaking existing P0-P8 data or behavior.

**Architecture:** Add a small `ProjectMarket` persistence model plus a focused `market` module that owns normalization, legacy fallback, persistence, and project-scoped REST configuration. Existing `Project.targetCountry` and `Project.defaultLanguage` remain untouched and become read-only fallback inputs when no explicit market rows exist; later P9-0 provider plans consume this module instead of reading those legacy fields directly.

**Tech Stack:** Node.js 22, TypeScript 5.9, Express 5, PostgreSQL/Prisma 6.14 multi-file schema, Zod 3.25, Vitest 3.2, Supertest 7, existing `AppError`/HTTP middleware and `createApp` dependency-injection pattern.

**Spec:** `docs/superpowers/specs/2026-08-22-p9-global-china-seogeo-controlled-autopilot-design.md`

## Global Constraints

- P0-P8-C remain complete; this plan is backward-compatible and does not rewrite historical facts.
- Initial market codes are exactly `CN`, `GLOBAL`, `HK`, `TW`, `SG`, `MY`.
- Locale strings are normalized BCP-47-style tags; this task does not invent market-specific SEO facts.
- Existing `Project.targetCountry` and `Project.defaultLanguage` remain present and unchanged.
- A project with zero persisted `ProjectMarket` rows resolves to exactly one legacy fallback market; GET reads do not write that fallback to the database.
- Unknown legacy country codes resolve to `GLOBAL`, never to `CN` by guesswork.
- `UNKNOWN`/unsupported provider semantics are out of scope here; provider adapters come in later P9-0 plans.
- No Google, Bing, Baidu, 360, Sogou, Shenma, AI-provider, DeepSeek, Git mutation, queue, or external network call is added by this plan.
- Market configuration is available to all plan levels because it is project identity/configuration, not a paid intelligence feature.
- GET routes are persisted-read only and have no side effects.
- PUT replaces the complete explicit market set atomically; partial patch semantics are intentionally not introduced.
- Maximum explicit market rows per project is 20.
- Every behavior task follows RED → minimal GREEN → focused regression → commit.

---

## Locked File Map

### New persistence

- `prisma/models/market.prisma`
- One generated Prisma migration named `p9_0a_market_locale_foundation` under `prisma/migrations/`.

### Existing persistence integration

- `prisma/schema.prisma`

### New market module

- `src/modules/market/market.types.ts`
- `src/modules/market/market.repository.ts`
- `src/modules/market/market.service.ts`
- `src/modules/market/market.routes.ts`

### Existing application integration

- `src/app.ts`

### Tests

- `tests/unit/market.types.test.ts`
- `tests/unit/market.service.test.ts`
- `tests/integration/market.persistence.test.ts`
- `tests/integration/market.api.test.ts`

### Documentation/release evidence

- `docs/development/p9-0a-market-locale-foundation.md`

---

### Task 1: Persist Explicit Project Markets Without Breaking Legacy Project Fields

**Files:**
- Create: `prisma/models/market.prisma`
- Modify: `prisma/schema.prisma` in `model Project`
- Test: `tests/integration/market.persistence.test.ts`
- Generated: Prisma migration named `p9_0a_market_locale_foundation`

**Interfaces:**
- Produces Prisma enum `MarketCode` with `CN | GLOBAL | HK | TW | SG | MY`.
- Produces Prisma model `ProjectMarket` keyed by project + market + normalized locale.
- Preserves existing `Project.targetCountry` and `Project.defaultLanguage` fields unchanged.

- [ ] **Step 1: Write the failing persistence test**

Create `tests/integration/market.persistence.test.ts` with a real test database fixture following the existing integration-test cleanup pattern. The core assertions are:

```ts
it('stores multiple explicit markets for one project without changing legacy fields', async () => {
  const project = await prisma.project.create({
    data: {
      name: 'Market Test',
      slug: `market-test-${Date.now()}`,
      primaryDomain: 'example.test',
      targetCountry: 'CN',
      defaultLanguage: 'zh-CN'
    }
  });

  await prisma.projectMarket.createMany({
    data: [
      { projectId: project.id, marketCode: 'CN', locale: 'zh-CN' },
      { projectId: project.id, marketCode: 'GLOBAL', locale: 'zh-Hant' },
      { projectId: project.id, marketCode: 'GLOBAL', locale: 'en' }
    ]
  });

  const reloaded = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
  expect(reloaded.targetCountry).toBe('CN');
  expect(reloaded.defaultLanguage).toBe('zh-CN');
  expect(await prisma.projectMarket.count({ where: { projectId: project.id } })).toBe(3);
});

it('rejects duplicate project + market + locale rows', async () => {
  const project = await createProject();
  await prisma.projectMarket.create({
    data: { projectId: project.id, marketCode: 'HK', locale: 'zh-Hant' }
  });

  await expect(prisma.projectMarket.create({
    data: { projectId: project.id, marketCode: 'HK', locale: 'zh-Hant' }
  })).rejects.toThrow();
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- tests/integration/market.persistence.test.ts
```

Expected: FAIL because `projectMarket` and `MarketCode` do not exist in the Prisma client.

- [ ] **Step 3: Add the exact Prisma model**

Create `prisma/models/market.prisma`:

```prisma
enum MarketCode {
  CN
  GLOBAL
  HK
  TW
  SG
  MY
}

model ProjectMarket {
  id         String     @id @default(uuid()) @db.Uuid
  projectId  String     @db.Uuid
  marketCode MarketCode
  locale     String
  enabled    Boolean    @default(true)
  createdAt  DateTime   @default(now())
  updatedAt  DateTime   @updatedAt

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)

  @@unique([projectId, marketCode, locale])
  @@index([projectId, enabled])
  @@index([marketCode, locale])
}
```

Modify only the `Project` relation section in `prisma/schema.prisma` by adding:

```prisma
markets ProjectMarket[]
```

Do not remove or rename `targetCountry` or `defaultLanguage`.

- [ ] **Step 4: Generate the migration and Prisma client**

Run:

```bash
npx prisma migrate dev --name p9_0a_market_locale_foundation
npx prisma validate
npx prisma generate
```

Expected: all commands exit 0; the generated migration adds only `MarketCode`, `ProjectMarket`, indexes, uniqueness, and the project foreign key.

- [ ] **Step 5: Run GREEN**

Run:

```bash
npm test -- tests/integration/market.persistence.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

Stage only the schema/model/test and the generated migration directory shown by `git status --short`:

```bash
git add prisma/schema.prisma prisma/models/market.prisma tests/integration/market.persistence.test.ts
git add prisma/migrations/*_p9_0a_market_locale_foundation/migration.sql
git commit -m "feat: add project market persistence"
```

---

### Task 2: Normalize Market and Locale Identity Deterministically

**Files:**
- Create: `src/modules/market/market.types.ts`
- Test: `tests/unit/market.types.test.ts`

**Interfaces:**

```ts
export const MARKET_CODES = ['CN', 'GLOBAL', 'HK', 'TW', 'SG', 'MY'] as const;
export type MarketCode = typeof MARKET_CODES[number];

export interface MarketSelection {
  marketCode: MarketCode;
  locale: string;
  enabled: boolean;
  source: 'EXPLICIT' | 'LEGACY_FALLBACK';
}

export interface LegacyProjectMarketInput {
  targetCountry: string;
  defaultLanguage: string;
}

export function normalizeLocale(value: string): string;
export function mapLegacyCountryToMarket(value: string): MarketCode;
export function resolveLegacyMarket(input: LegacyProjectMarketInput): MarketSelection;
export function marketIdentity(input: Pick<MarketSelection, 'marketCode' | 'locale'>): string;
```

- [ ] **Step 1: Write failing normalization tests**

Create `tests/unit/market.types.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  mapLegacyCountryToMarket,
  marketIdentity,
  normalizeLocale,
  resolveLegacyMarket
} from '../../src/modules/market/market.types.js';

describe('market identity', () => {
  it('normalizes common locale casing deterministically', () => {
    expect(normalizeLocale(' zh-cn ')).toBe('zh-CN');
    expect(normalizeLocale('ZH-hant')).toBe('zh-Hant');
    expect(normalizeLocale('en-us')).toBe('en-US');
  });

  it('maps known legacy countries and sends unknown countries to GLOBAL', () => {
    expect(mapLegacyCountryToMarket('cn')).toBe('CN');
    expect(mapLegacyCountryToMarket('HK')).toBe('HK');
    expect(mapLegacyCountryToMarket('US')).toBe('GLOBAL');
  });

  it('builds a read-only legacy fallback market', () => {
    expect(resolveLegacyMarket({ targetCountry: 'TW', defaultLanguage: 'zh-hant' })).toEqual({
      marketCode: 'TW',
      locale: 'zh-Hant',
      enabled: true,
      source: 'LEGACY_FALLBACK'
    });
  });

  it('uses a stable identity key', () => {
    expect(marketIdentity({ marketCode: 'GLOBAL', locale: 'zh-Hant' }))
      .toBe('GLOBAL:zh-Hant');
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- tests/unit/market.types.test.ts
```

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement strict locale normalization**

Use `Intl.getCanonicalLocales` so normalization follows the runtime's BCP-47 canonicalization rather than a home-grown case table:

```ts
export function normalizeLocale(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 64) {
    throw new MarketValidationError('Locale must be between 1 and 64 characters', 'INVALID_LOCALE');
  }

  try {
    return Intl.getCanonicalLocales(trimmed)[0]!;
  } catch {
    throw new MarketValidationError('Locale is not a valid BCP-47 language tag', 'INVALID_LOCALE');
  }
}
```

Implement the country map exactly as:

```ts
const LEGACY_COUNTRY_MARKET: Readonly<Record<string, MarketCode>> = {
  CN: 'CN',
  HK: 'HK',
  TW: 'TW',
  SG: 'SG',
  MY: 'MY'
};
```

Unknown country codes return `GLOBAL`.

Add a small exported `MarketValidationError` carrying code `INVALID_LOCALE` or `INVALID_MARKET` so routes/services can map errors consistently later.

- [ ] **Step 4: Run GREEN**

Run:

```bash
npm test -- tests/unit/market.types.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/market/market.types.ts tests/unit/market.types.test.ts
git commit -m "feat: add deterministic market identity"
```

---

### Task 3: Add Market Repository and Legacy Fallback Service

**Files:**
- Create: `src/modules/market/market.repository.ts`
- Create: `src/modules/market/market.service.ts`
- Test: `tests/unit/market.service.test.ts`
- Extend: `tests/integration/market.persistence.test.ts`

**Interfaces:**

```ts
export interface MarketRepository {
  findProjectIdentity(projectId: string): Promise<{
    id: string;
    targetCountry: string;
    defaultLanguage: string;
  } | null>;
  listExplicitMarkets(projectId: string): Promise<Array<{
    marketCode: MarketCode;
    locale: string;
    enabled: boolean;
  }>>;
  replaceExplicitMarkets(projectId: string, markets: Array<{
    marketCode: MarketCode;
    locale: string;
    enabled: boolean;
  }>): Promise<void>;
}

export class MarketService {
  constructor(private readonly repository: MarketRepository) {}
  listResolvedMarkets(projectId: string): Promise<MarketSelection[]>;
  replaceMarkets(projectId: string, input: MarketWriteInput[]): Promise<MarketSelection[]>;
}
```

- [ ] **Step 1: Write failing service tests**

Create an in-memory fake implementing `MarketRepository`. Cover all of these cases:

```ts
it('returns legacy fallback when no explicit markets exist', async () => {
  repository.project = { id: 'p1', targetCountry: 'CN', defaultLanguage: 'zh-cn' };
  repository.markets = [];
  await expect(service.listResolvedMarkets('p1')).resolves.toEqual([
    { marketCode: 'CN', locale: 'zh-CN', enabled: true, source: 'LEGACY_FALLBACK' }
  ]);
  expect(repository.replaceCalls).toBe(0);
});

it('returns explicit rows and does not append legacy fallback', async () => {
  repository.markets = [
    { marketCode: 'CN', locale: 'zh-CN', enabled: true },
    { marketCode: 'GLOBAL', locale: 'zh-Hant', enabled: true }
  ];
  const result = await service.listResolvedMarkets('p1');
  expect(result.map((row) => row.source)).toEqual(['EXPLICIT', 'EXPLICIT']);
});

it('rejects duplicate normalized identities before repository write', async () => {
  await expect(service.replaceMarkets('p1', [
    { marketCode: 'CN', locale: 'zh-cn', enabled: true },
    { marketCode: 'CN', locale: 'zh-CN', enabled: true }
  ])).rejects.toMatchObject({ code: 'DUPLICATE_MARKET' });
});

it('rejects more than 20 markets', async () => {
  const rows = Array.from({ length: 21 }, (_, index) => ({
    marketCode: 'GLOBAL' as const,
    locale: `x-p9-${index}`,
    enabled: true
  }));
  await expect(service.replaceMarkets('p1', rows)).rejects.toMatchObject({ code: 'MARKET_LIMIT_EXCEEDED' });
});
```

For the 21-row limit test, use valid private-use BCP-47 tags such as `en-x-p9-0`, `en-x-p9-1`, etc.; do not use invalid tags.

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- tests/unit/market.service.test.ts
```

Expected: FAIL because repository/service modules do not exist.

- [ ] **Step 3: Implement repository with atomic replace**

`replaceExplicitMarkets` must run in one Prisma transaction:

```ts
await prisma.$transaction(async (tx) => {
  await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { id: true } });
  await tx.projectMarket.deleteMany({ where: { projectId } });
  if (markets.length > 0) {
    await tx.projectMarket.createMany({
      data: markets.map((market) => ({ projectId, ...market }))
    });
  }
});
```

This is configuration replacement, not an immutable fact table; delete-and-recreate inside one transaction is intentional.

- [ ] **Step 4: Implement service behavior**

Requirements:

- verify the project exists before resolving or replacing markets;
- normalize every locale before duplicate detection;
- deterministic output sort: `marketCode ASC`, then `locale ASC`;
- explicit rows carry `source: 'EXPLICIT'`;
- zero explicit rows resolve to exactly one legacy fallback;
- `replaceMarkets(projectId, [])` is allowed and intentionally returns the legacy fallback after deleting explicit rows;
- GET/list never calls `replaceExplicitMarkets`.

- [ ] **Step 5: Add integration coverage for atomic replace**

Extend persistence tests to prove replacing two rows with three rows leaves exactly the new three rows, and a transaction failure leaves the old set intact.

- [ ] **Step 6: Run GREEN**

Run:

```bash
npm test -- tests/unit/market.service.test.ts tests/integration/market.persistence.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/modules/market/market.repository.ts src/modules/market/market.service.ts tests/unit/market.service.test.ts tests/integration/market.persistence.test.ts
git commit -m "feat: add project market service"
```

---

### Task 4: Expose Project-Scoped Market REST API With Side-Effect-Free GET

**Files:**
- Create: `src/modules/market/market.routes.ts`
- Modify: `src/app.ts`
- Test: `tests/integration/market.api.test.ts`

**Interfaces:**

Routes mounted under `/api`:

```text
GET /api/projects/:projectId/markets
PUT /api/projects/:projectId/markets
```

Response shape:

```ts
interface MarketApiResponse {
  data: Array<{
    marketCode: MarketCode;
    locale: string;
    enabled: boolean;
    source: 'EXPLICIT' | 'LEGACY_FALLBACK';
  }>;
}
```

`createMarketRoutes(injectedService?: MarketService)` follows the existing route dependency-injection pattern.

- [ ] **Step 1: Write failing API tests**

Create `tests/integration/market.api.test.ts` using Supertest and an injected fake service:

```ts
it('GET returns resolved markets without invoking a write method', async () => {
  const service = {
    listResolvedMarkets: vi.fn().mockResolvedValue([
      { marketCode: 'CN', locale: 'zh-CN', enabled: true, source: 'LEGACY_FALLBACK' }
    ]),
    replaceMarkets: vi.fn()
  };

  const response = await request(createApp({ marketService: service as never }))
    .get('/api/projects/p1/markets');

  expect(response.status).toBe(200);
  expect(service.listResolvedMarkets).toHaveBeenCalledWith('p1');
  expect(service.replaceMarkets).not.toHaveBeenCalled();
});

it('PUT canonicalizes locales and returns the complete explicit set', async () => {
  const response = await request(app)
    .put('/api/projects/p1/markets')
    .send({ markets: [
      { marketCode: 'GLOBAL', locale: 'zh-hant', enabled: true },
      { marketCode: 'CN', locale: 'zh-cn', enabled: true }
    ] });
  expect(response.status).toBe(200);
});

it('PUT rejects unknown market codes and more than 20 rows', async () => {
  // assert HTTP 400 before service mutation
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
npm test -- tests/integration/market.api.test.ts
```

Expected: FAIL because routes and `AppOptions.marketService` do not exist.

- [ ] **Step 3: Implement exact Zod request schema**

In `market.routes.ts`:

```ts
const marketWriteSchema = z.object({
  markets: z.array(z.object({
    marketCode: z.enum(['CN', 'GLOBAL', 'HK', 'TW', 'SG', 'MY']),
    locale: z.string().trim().min(1).max(64),
    enabled: z.boolean().default(true)
  }).strict()).max(20)
}).strict();
```

Do not put locale canonicalization in the route; the service remains authoritative for normalization and duplicate detection.

Map `MarketValidationError` to `AppError` with:

- validation/duplicate/limit → HTTP 400;
- missing project → HTTP 404.

- [ ] **Step 4: Wire dependency injection into `src/app.ts`**

Add:

```ts
import { createMarketRoutes } from './modules/market/market.routes.js';
import type { MarketService } from './modules/market/market.service.js';

export interface AppOptions {
  // existing options unchanged
  marketService?: MarketService;
}
```

Mount before generic error handling:

```ts
app.use('/api', createMarketRoutes(options.marketService));
```

Do not alter existing route mount paths.

- [ ] **Step 5: Run GREEN**

Run:

```bash
npm test -- tests/integration/market.api.test.ts
npm run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/market/market.routes.ts src/app.ts tests/integration/market.api.test.ts
git commit -m "feat: expose project market configuration API"
```

---

### Task 5: Prove Backward Compatibility and Establish the Provider-Plan Contract

**Files:**
- Extend: `tests/unit/market.service.test.ts`
- Extend: `tests/integration/market.api.test.ts`
- Create: `docs/development/p9-0a-market-locale-foundation.md`

**Interfaces:**
- Establishes `MarketService.listResolvedMarkets(projectId)` as the only supported market-resolution interface for later P9-0B through P9-0H plans.
- Later search/visibility/provider code must not read `Project.targetCountry` or `Project.defaultLanguage` directly when deciding active markets.

- [ ] **Step 1: Add focused backward-compatibility regression tests**

Add these exact cases:

```ts
it('keeps an existing CN project behavior when there are no explicit rows', async () => {
  repository.project = { id: 'p1', targetCountry: 'CN', defaultLanguage: 'zh-CN' };
  repository.markets = [];
  expect(await service.listResolvedMarkets('p1')).toEqual([
    { marketCode: 'CN', locale: 'zh-CN', enabled: true, source: 'LEGACY_FALLBACK' }
  ]);
});

it('maps a legacy US project to GLOBAL rather than inventing a new market code', async () => {
  repository.project = { id: 'p1', targetCountry: 'US', defaultLanguage: 'en-US' };
  repository.markets = [];
  expect(await service.listResolvedMarkets('p1')).toEqual([
    { marketCode: 'GLOBAL', locale: 'en-US', enabled: true, source: 'LEGACY_FALLBACK' }
  ]);
});

it('restores legacy fallback after explicit markets are cleared', async () => {
  await service.replaceMarkets('p1', []);
  expect(await service.listResolvedMarkets('p1')).toEqual([
    { marketCode: 'CN', locale: 'zh-CN', enabled: true, source: 'LEGACY_FALLBACK' }
  ]);
});
```

- [ ] **Step 2: Run the focused regression set**

Run:

```bash
npm test -- tests/unit/market.types.test.ts tests/unit/market.service.test.ts tests/integration/market.persistence.test.ts tests/integration/market.api.test.ts
```

Expected: PASS.

- [ ] **Step 3: Write operator/developer documentation**

Create `docs/development/p9-0a-market-locale-foundation.md` with these concrete sections:

1. **Purpose** — explicit multi-market configuration while preserving legacy fields.
2. **Supported market codes** — `CN`, `GLOBAL`, `HK`, `TW`, `SG`, `MY`.
3. **Fallback contract** — zero explicit rows resolve from `targetCountry/defaultLanguage`; unknown country becomes `GLOBAL`; GET never persists fallback.
4. **REST contract** — exact GET/PUT routes and replacement semantics.
5. **Downstream rule** — future P9 provider code consumes `MarketService.listResolvedMarkets`, not legacy fields directly.
6. **Non-goals** — no provider APIs, rankings, AI sampling, queues, P7 scoring changes, or P8 mutation changes in P9-0A.
7. **Rollback** — application rollback may stop using the new module while the additive table remains harmless; database rollback may drop only `ProjectMarket`/`MarketCode` after verifying no later P9 migration depends on them.

- [ ] **Step 4: Run full local release gate**

Run in this order:

```bash
npx prisma validate
npx prisma generate
npm run typecheck
npm test
npm run build
npm run test:e2e
npm audit --omit=dev --audit-level=high --legacy-peer-deps
```

Expected: every command exits 0. Do not claim P9-0A complete from focused tests alone.

- [ ] **Step 5: Commit**

```bash
git add tests/unit/market.service.test.ts tests/integration/market.api.test.ts docs/development/p9-0a-market-locale-foundation.md
git commit -m "docs: verify P9-0A market foundation"
```

---

## P9-0A Completion Gate

Before opening or updating a PR, verify all of the following against the exact branch head:

- `Project.targetCountry` and `Project.defaultLanguage` still exist and no historical row was rewritten.
- `ProjectMarket` supports the six approved market codes and normalized locale tags.
- zero explicit rows resolve through a read-only legacy fallback.
- unknown legacy countries resolve to `GLOBAL`.
- GET `/api/projects/:projectId/markets` performs no writes.
- PUT replacement is bounded to 20 rows, normalizes before duplicate detection, and writes atomically.
- no provider/network/AI/Git/queue behavior was introduced.
- full Vitest, TypeScript build, Chromium E2E, Prisma validation/generation, and production dependency audit are green on the exact head.

## Follow-on Plan Sequence

P9-0A intentionally stops at market identity. After it is merged and verified, write and execute separate implementation plans in this order:

1. **P9-0B Global Search Provider Layer** — generalized search-provider contract plus Google adapter/backward compatibility and Bing official adapter.
2. **P9-0C China Search Provider Layer** — Baidu, 360, Sogou, Shenma capability manifests and official adapters only where supported.
3. **P9-0D Global AI Visibility Expansion** — capability metadata on existing P6 providers and supported global search-grounded providers.
4. **P9-0E China AI Visibility Expansion** — Baidu/Qwen/Hunyuan first; DeepSeek/Doubao/Kimi/Yuanbao/Quark only under verified official capability semantics.
5. **P9-0F Unified Search Facts** — normalized provider-aware immutable evidence.
6. **P9-0G P7 Multi-provider Growth Adapter** — provider/market-aware Growth ingestion without rewriting P7 authority.
7. **P9-0H Third-party Skill Foundation** — reviewed, SHA-pinned, licensed vendor registry and compatibility/safety tests.
8. **P9-A Optimization Planner** — begins only after the provider/evidence foundation above is release-gated.
