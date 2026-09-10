# 主站草稿同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 SEO GEO 的内容草稿可被显式同步成兴善堂主站的草稿文章，并让用户在每次同步时选择栏目。

**Architecture:** 主站保持文章和正式发布的唯一权威；它通过既有 HMAC API 创建草稿并拒绝重复 slug。SEO GEO 新增一个小型 CMS 客户端及持久化同步记录，页面 POST 操作在权限、CSRF 与版本幂等保护下调用该客户端。

**Tech Stack:** Node.js、TypeScript、Express、Prisma/PostgreSQL、Vitest/Supertest；主站 Node.js、Express、JSON store、HMAC-SHA256。

**Spec:** `docs/superpowers/specs/2026-09-10-main-site-draft-sync-design.md`

## Global Constraints

- 所有同步只允许创建主站 `draft`，不得调用主站发布、撤回或删除接口。
- 每次同步显示栏目选择，默认「六壬文化」，只接受主站白名单栏目。
- 主站 API 密钥、HMAC 签名和完整正文不得写入日志、页面、同步记录或错误详情。
- 同一 `(draftId, draftVersion)` 只能产生一个主站文章；编辑形成新版本后才允许再次同步。
- 主站同 slug 的未删除文章必须得到 `409 slug_conflict`，不得静默重复创建或覆盖。
- 所有写操作须登录、项目成员资格、`CONTENT_WRITE` 与 CSRF 校验。

---

### Task 1: 保护主站文章 API 的重复 slug 创建

**Files:**
- Modify: `/var/www/xingshantang/current/server/routes/api-articles.js:48-65`
- Test: `/var/www/xingshantang/current/tests/api-articles.test.js`（若测试目录不存在则创建）

**Interfaces:**
- Consumes: `articleRepo.findBySlug(slug)` 和 `POST /api/v1/articles` 的既有 HMAC 守卫。
- Produces: `409 { error: { code: 'slug_conflict', message: 'Slug 已存在，请更换后再保存' } }`，且不写入文章。

- [ ] **Step 1: 写出失败的主站 API 测试**

```js
it('rejects an API draft whose slug is already active', async () => {
  articleRepo.create({ title: 'Existing', slug: 'fuyingguan', section: '六壬文化', status: 'draft' });
  const response = await signedRequest(app)
    .post('/api/v1/articles')
    .send({ title: 'Duplicate', slug: 'fuyingguan', section: '六壬文化' });

  expect(response.status).toBe(409);
  expect(response.body.error.code).toBe('slug_conflict');
  expect(articleRepo.listActive()).toHaveLength(1);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- api-articles.test.js`

Expected: 现有 API 返回 `201` 并新增第二篇文章，因此断言失败。

- [ ] **Step 3: 在主站 API 写入前加入重复检查**

```js
const existing = articleRepo.findBySlug(input.slug);
if (existing) {
  res.status(409).json({
    error: { code: 'slug_conflict', message: 'Slug 已存在，请更换后再保存' },
  });
  return;
}
const article = articleRepo.create({ ...input, status: 'draft' });
```

- [ ] **Step 4: 运行主站 API 测试与现有主站测试**

Run: `npm test -- api-articles.test.js && npm test`

Expected: 新测试和现有测试均通过；正常 API 创建仍返回 `201`，且状态为 `draft`。

- [ ] **Step 5: 按既有主站 release 机制发布并验证**

Run: 使用主站既有 release 脚本创建新 release、切换 `current`、`pm2 reload xingshantang`，再以签名请求验证正常草稿创建与冲突返回。

Expected: 站点健康正常，主站后台既有内容不变。

### Task 2: 增加 SEO GEO 的 CMS 配置与签名客户端

**Files:**
- Modify: `src/config/env.ts`
- Create: `src/modules/publication/xingshantang-cms.client.ts`
- Test: `tests/unit/xingshantang-cms.client.test.ts`

**Interfaces:**
- Consumes: `XINGSHANTANG_CMS_API_BASE_URL`、`XINGSHANTANG_CMS_API_CLIENT_ID`、`XINGSHANTANG_CMS_API_SECRET`。
- Produces: `XingshantangCmsClient.createDraft(input): Promise<{ articleId: string; status: 'draft' }>` 和可安全显示的 `XingshantangCmsError`。

- [ ] **Step 1: 写出失败的签名与响应规范化单元测试**

```ts
it('posts a signed draft request without exposing the secret', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
    article: { id: 'main-article-1', status: 'draft' },
  }), { status: 201 }));
  const client = new XingshantangCmsClient(config, fetcher);

  await expect(client.createDraft(payload)).resolves.toEqual({ articleId: 'main-article-1', status: 'draft' });
  expect(fetcher.mock.calls[0][1].headers).toMatchObject({ 'X-Client-Id': config.clientId });
  expect(JSON.stringify(fetcher.mock.calls[0][1])).not.toContain(config.secret);
});

it('maps a 409 slug_conflict to a safe retryable=false error', async () => {
  // mocked response body: { error: { code: 'slug_conflict' } }
});
```

- [ ] **Step 2: 运行单元测试确认失败**

Run: `npm test -- --run tests/unit/xingshantang-cms.client.test.ts`

Expected: 失败，因为客户端与配置尚不存在。

- [ ] **Step 3: 实现配置与客户端**

```ts
type CmsDraftInput = {
  title: string; slug: string; section: MainSiteSection; summary: string; body: string;
};

type CmsConfig = { baseUrl: string; clientId: string; secret: string } | null;

// JSON.stringify(payload) 后以 POST、/api/v1/articles、Date.now()、randomUUID()
// 与 SHA-256 body hash 构成与主站相同的 HMAC-SHA256 canonical string。
```

实现 10 秒 `AbortSignal.timeout`、HTTPS 基址校验、固定允许栏目集合、`201` 响应校验，以及不携带签名和正文的错误对象。

- [ ] **Step 4: 运行客户端测试与类型检查**

Run: `npm test -- --run tests/unit/xingshantang-cms.client.test.ts && npm run typecheck`

Expected: 通过。

- [ ] **Step 5: 提交客户端变更**

```bash
git add src/config/env.ts src/modules/publication/xingshantang-cms.client.ts tests/unit/xingshantang-cms.client.test.ts
git commit -m "feat: add signed main-site draft client"
```

### Task 3: 持久化每个内容版本的同步结果

**Files:**
- Modify: `prisma/models/publication.prisma`
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_main_site_draft_sync/migration.sql`
- Modify: `src/modules/publication/publication.repository.ts`
- Create: `src/modules/publication/main-site-draft-sync.service.ts`
- Test: `tests/integration/main-site-draft-sync.service.test.ts`

**Interfaces:**
- Consumes: `ContentDraft`、`ContentDraftVersion` 与 `XingshantangCmsClient`。
- Produces: `MainSiteDraftSync`（唯一 `draftId + draftVersion`）和 `syncDraftVersion({ projectId, draftId, section, actorId })`。

- [ ] **Step 1: 写出失败的幂等与失败不落成功记录测试**

```ts
it('creates exactly one main-site draft for the same content version', async () => {
  const first = await service.syncDraftVersion(input);
  const second = await service.syncDraftVersion(input);
  expect(second).toEqual(first);
  expect(cms.createDraft).toHaveBeenCalledTimes(1);
});

it('does not create a successful sync record when the main site rejects the request', async () => {
  cms.createDraft.mockRejectedValue(new XingshantangCmsError('slug_conflict', 409, false));
  await expect(service.syncDraftVersion(input)).rejects.toMatchObject({ code: 'slug_conflict' });
  await expect(prisma.mainSiteDraftSync.count()).resolves.toBe(0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- --run tests/integration/main-site-draft-sync.service.test.ts`

Expected: 失败，因为 Prisma 模型、服务和表尚不存在。

- [ ] **Step 3: 增加模型、迁移、仓储和服务**

```prisma
model MainSiteDraftSync {
  id            String   @id @default(uuid()) @db.Uuid
  projectId     String   @db.Uuid
  draftId       String   @db.Uuid
  draftVersion  Int
  mainArticleId String
  section       String
  createdAt     DateTime @default(now())
  @@unique([draftId, draftVersion])
  @@index([projectId, createdAt])
}
```

服务读取不可变 `ContentDraftVersion`，要求 `slugCandidate` 非空，调用客户端后在事务中写入成功记录；遇到唯一冲突时读取并返回已存在记录。不得将失败响应持久化为成功同步。

- [ ] **Step 4: 生成 Prisma 客户端并运行集成测试**

Run: `npx prisma generate && npm test -- --run tests/integration/main-site-draft-sync.service.test.ts`

Expected: 通过；同版本只创建一次，新版本可创建第二条记录。

- [ ] **Step 5: 提交数据层变更**

```bash
git add prisma src/modules/publication/main-site-draft-sync.service.ts tests/integration/main-site-draft-sync.service.test.ts
git commit -m "feat: persist main-site draft syncs"
```

### Task 4: 加入受保护的页面操作与栏目选择

**Files:**
- Modify: `src/modules/publication/publication.web.repository.ts`
- Modify: `src/modules/publication/publication.web.routes.ts`
- Modify: `src/views/publication/editor.ejs`
- Modify: `src/app.ts`（仅在需要注入 CMS 客户端时）
- Test: `tests/integration/publication.main-site-sync.web.test.ts`

**Interfaces:**
- Consumes: `MainSiteDraftSyncService`、`requireAuthentication`、`requireCsrf`、`requireProjectMembership`、`requireProjectCapability('CONTENT_WRITE')`。
- Produces: `POST /projects/:id/publication/drafts/:draftId/main-site-draft-sync`，提交 `section`，成功后重定向回草稿详情。

- [ ] **Step 1: 写出失败的 Web 测试**

```ts
it('renders the section selector with 六壬文化 selected by default', async () => {
  const response = await authenticatedGet(`/projects/${project.id}/publication/drafts/${draft.id}`);
  expect(response.text).toContain('同步到主站草稿');
  expect(response.text).toContain('<option value="六壬文化" selected>六壬文化</option>');
});

it('rejects sync POST without CSRF or CONTENT_WRITE', async () => {
  await request(app).post(path).set('Cookie', viewer.sessionCookie).send({ section: '六壬文化' }).expect(403);
});
```

- [ ] **Step 2: 运行 Web 测试确认失败**

Run: `npm test -- --run tests/integration/publication.main-site-sync.web.test.ts`

Expected: 失败，因为页面和 POST 路由尚不存在。

- [ ] **Step 3: 实现页面显示与 POST 路由**

在草稿详情的「主站草稿」区块渲染固定允许栏目：`最新消息`、`六壬文化`、`民宗文献`、`会员专区`、`购物专区`、`联系我们`；默认选择 `六壬文化`。当当前版本已有同步记录时，显示主站文章 ID、栏目、同步时间与主站后台编辑链接，并禁用重复提交。

路由必须按顺序执行：认证、CSRF、项目成员、内容写入能力、section 白名单校验、服务同步；成功使用 `303` 回到详情页，失败使用受控错误提示且不暴露 API 秘密。

- [ ] **Step 4: 运行 Web 与权限回归测试**

Run: `npm test -- --run tests/integration/publication.main-site-sync.web.test.ts tests/integration/project-membership.test.ts`

Expected: 通过；只有具有内容写入权限的成员能提交。

- [ ] **Step 5: 提交页面与路由变更**

```bash
git add src/modules/publication src/views/publication/editor.ejs src/app.ts tests/integration/publication.main-site-sync.web.test.ts
git commit -m "feat: sync publication drafts to main-site drafts"
```

### Task 5: 完整验证与部署

**Files:**
- Modify: `.env.example`（记录三个 CMS 配置键但不写入真实值）
- Test: `tests/e2e/publication.spec.ts`（增加已登录的草稿同步可见性断言）

**Interfaces:**
- Consumes: 已部署的主站 API、SEO GEO 生产环境已存在的 CMS 配置。
- Produces: 可审计、可重复验证的生产同步流程。

- [ ] **Step 1: 写出失败的已登录 E2E 断言**

```ts
await page.goto(`/projects/${projectId}/publication/drafts/${draftId}`);
await expect(page.getByRole('button', { name: '同步到主站草稿' })).toBeVisible();
await expect(page.getByLabel('主站栏目')).toHaveValue('六壬文化');
```

- [ ] **Step 2: 运行 E2E 断言确认失败**

Run: `npm run test:e2e -- tests/e2e/publication.spec.ts`

Expected: 在实现前找不到同步操作。

- [ ] **Step 3: 增加环境说明与完成 E2E 测试**

将 `XINGSHANTANG_CMS_API_BASE_URL`、`XINGSHANTANG_CMS_API_CLIENT_ID`、`XINGSHANTANG_CMS_API_SECRET` 写入 `.env.example` 的注释示例，不填真实值；实现后更新 E2E fixture/断言。

- [ ] **Step 4: 运行完整验证**

Run: `npm run typecheck && npm test && npm run build && npm run test:e2e`

Expected: 全部通过。对生产部署使用一篇专用测试草稿执行一次同步，检查主站后台显示 `draft`，并检查前台文章页不可访问或不可索引。

- [ ] **Step 5: 创建 PR、通过 CI 后部署**

```bash
git add .env.example tests/e2e/publication.spec.ts
git commit -m "test: cover main-site draft sync"
git push -u origin feat/main-site-draft-sync
gh pr create --base main --head feat/main-site-draft-sync --title "feat: sync SEO GEO drafts to main site"
```

部署前备份 SEO GEO PostgreSQL 与主站 `data/site.db`；部署后执行健康检查、一次专用草稿同步和主站后台验证。任何失败都停止，保留原草稿，不自动发布。
