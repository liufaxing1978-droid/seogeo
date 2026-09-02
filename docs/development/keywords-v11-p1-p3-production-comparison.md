# Keywords V1.1 P1-P3 — Production 对照与完成报告

日期：2026-09-02

仓库：`liufaxing1978-droid/seogeo`

Production / 开发基线 exact SHA：`461193813cb5dc61e1d2ef6fea40df0289f1a38d`

开发分支：`feat/keyword-v11-p1-p3`

Draft PR：[#193](https://github.com/liufaxing1978-droid/seogeo/pull/193)

> 本报告提交前的功能 exact SHA 为 `078a64fcefb1a839af25d819dfd4af2f6a039c7a`。报告提交后的最终 exact SHA 与 CI 证据记录在本报告末尾的“最终 exact-head 验证”中。

## 1. 执行边界与结论

- 从 Production 当前代码基线继续开发，没有从零重构，也没有建立平行关键词体系。
- 复用了原有 Keyword、KeywordGroup、KeywordGroupMembership、搜索证据、页面覆盖、RBAC、CSRF、审计及 AI suggestion 能力。
- P1、P2、P3 的缺口已进入数据库、service、API、Web UI 和测试链路，不是静态 Demo。
- 本分支没有合并到 `main`，没有部署 Production，也没有读取、修改或修补 Production 业务数据。
- P4-P12 未提前实现；尤其没有自动执行 redirect、canonical、merge、删除或其他高风险动作。

## 2. Production / 基线差距核验

### 已有并继续复用

- 项目隔离的 Keyword CRUD，`normalizedText` 项目内唯一。
- Keyword 父子关系、归档/恢复、锁定与人工修改保护。
- 通用 KeywordGroup 与 membership。
- 项目成员鉴权、capability 检查、CSRF 和 KeywordAuditLog。
- AI 关键词建议的生成、接受与拒绝。
- 已持久化的官方搜索证据和页面 coverage 事实。
- 现有 Keywords 页面、Express/EJS 路由结构和 Prisma/PostgreSQL 数据层。

### 基线部分实现但不满足 V1.1

- P1：已有单条 CRUD，但缺批量录入、完整筛选、统一严格写入校验和独立生命周期。
- P2：已有 group/membership，但缺 Cluster 改名、主关键词及原子批量分配。
- P3：已有 intent/type、priority、搜索证据和 coverage，但缺可解释 Opportunity Score、confidence、来源与历史快照。

### 基线尚未实现

- P4 Target URL 与 Cannibalization。
- P5 可追踪的 Content Gap 工作流。
- P6-P12 的 V1.1 增量能力，详见第 9 节。

### 数据结构冲突、重复与迁移判断

- 未新增重复的 Keyword/Cluster 主体系；P2 直接升级现有 `KeywordGroup`。
- `Keyword.status` 保留原有兼容语义；新增 `lifecycleStatus` 承载 V1.1 生命周期，避免强制重命名或破坏旧调用方。
- P3 以 append-only `KeywordOpportunitySnapshot` 保存计算事实，不把瞬时分数覆盖到 Keyword，也不把缺失数据伪造成零。
- 现有 target page / coverage 事实只作为已知评分输入；没有在 P1-P3 中冒充 P4/P5 状态。

## 3. P1 — 基础关键词管理

### 已完成能力

- 单条创建和批量文本录入共用项目内 normalized 去重规则。
- 批量输入支持换行和逗号分隔；同一请求内及数据库既有词均可识别重复。
- lifecycle 真正持久化，支持 `DISCOVERED` 到 `RETIRED` 的 V1.1 状态集合。
- 列表支持 query、status、lifecycle、intent、keyword type 和 origin 筛选。
- 写接口统一通过严格 Zod schema，拒绝未知字段及非法枚举。
- 保持原有 archive/restore、lock、parent、suggestion 和审计行为兼容。

### 数据库

- `20260902090000_add_keyword_lifecycle`
  - 新增 `KeywordLifecycleStatus` enum。
  - 新增非空 `Keyword.lifecycleStatus`，默认 `DISCOVERED`。
  - 旧 `DISABLED`/`ARCHIVED` 安全回填为 `RETIRED`，其余回填为 `DISCOVERED`。
  - 新增项目 + lifecycle 索引。

### API / UI

- 新增 `POST /api/v1/projects/:projectId/keywords/bulk`。
- 扩展 `GET /api/v1/projects/:projectId/keywords` 筛选参数。
- 创建/更新接口支持 lifecycle，并执行 server-side strict validation。
- Keywords 工作台新增批量录入、筛选和 lifecycle 展示/编辑。

## 4. P2 — Keyword Cluster

### 已完成能力

- 复用 `KeywordGroup` 作为 Cluster，不新建重复模型。
- Cluster 支持改名、指定/清除 primary keyword、批量分配关键词。
- primary keyword 自动保证属于 Cluster。
- 所有关键词、Cluster 和 primary 操作均校验同一 project。
- 批量分配先完整校验再事务写入，不产生半成功状态。
- 继续执行锁定确认和审计规则。

### 数据库

- `20260902100000_add_keyword_cluster_primary`
  - 新增 nullable `KeywordGroup.primaryKeywordId`。
  - 外键删除行为为 `SET NULL`，保留 Cluster。
  - 新增项目 + primary keyword 索引。

### API / UI

- `PATCH /api/v1/projects/:projectId/keyword-groups/:groupId`：改名。
- `PUT /api/v1/projects/:projectId/keyword-groups/:groupId/primary-keyword`：设置/清除主关键词。
- `PUT /api/v1/projects/:projectId/keyword-groups/:groupId/keywords`：批量分配。
- Web 页面新增 Keyword Cluster 区域、改名、主关键词和批量 membership 控件。

## 5. P3 — Intent + Opportunity Score

### 已完成能力

- 复用现有 keyword intent/type，并将其真正纳入评分输入。
- 新增集中式、带版本的 Opportunity Score 公式 `keyword-opportunity-v1`。
- 权重：relevance 25、demand 15、ranking 15、difficulty 10、content gap 10、authority fit 10、strategic 10、GEO 5，总计 100。
- 每一项记录状态、原始值、标准化值、权重、贡献、原因和来源。
- 仅在已知维度权重内归一化；已知权重低于 30 时 `score = null`。
- `dataConfidence = knownWeight / 100`；缺失数据保持 UNKNOWN，不用 AI 或默认零补齐。
- 计算消费当前 Keyword、持久化官方搜索证据和持久化页面 coverage；relevance/difficulty 无可靠事实时保持 UNKNOWN。
- 每次计算追加不可变快照，保留 formula version、breakdown、source provenance、actor 和时间，可查询最新值并保留历史。
- 项目隔离、RBAC、CSRF 和审计继续生效。

### 数据库

- `20260902110000_add_keyword_opportunity_snapshots`
  - 新增 append-only `KeywordOpportunitySnapshot`。
  - `score` nullable 且约束为 0-100；`dataConfidence` 约束为 0-1。
  - 保存 breakdown、sourceProvenance、formulaVersion、createdByUserId、createdAt。
  - 项目/关键词外键和 latest/history 查询索引。

### API / UI

- `GET /api/v1/projects/:projectId/keywords/:keywordId/opportunity-score`：获取最新快照。
- `POST /api/v1/projects/:projectId/keywords/:keywordId/opportunity-score`：以当前已持久化事实计算并追加快照。
- Keywords 工作台展示 score、confidence 和 breakdown；证据不足时明确显示 N/A，可计算/重算。

## 6. 新增与修改文件

### 设计和计划

- `docs/superpowers/specs/2026-09-02-keywords-v11-p1-p3-design.md`
- `docs/superpowers/plans/2026-09-02-keywords-v11-p1-p3.md`

### Prisma / migrations

- `prisma/schema.prisma`
- `prisma/models/keyword-demand.prisma`
- `prisma/migrations/20260902090000_add_keyword_lifecycle/migration.sql`
- `prisma/migrations/20260902100000_add_keyword_cluster_primary/migration.sql`
- `prisma/migrations/20260902110000_add_keyword_opportunity_snapshots/migration.sql`

### 应用代码和 UI

- `src/app.ts`
- `src/modules/keywords/keyword-bulk.ts`
- `src/modules/keywords/keyword-filter.ts`
- `src/modules/keywords/keyword-opportunity-score.ts`
- `src/modules/keywords/keyword-opportunity.repository.ts`
- `src/modules/keywords/keyword-opportunity.service.ts`
- `src/modules/keywords/keyword.repository.ts`
- `src/modules/keywords/keyword.routes.ts`
- `src/modules/keywords/keyword.schema.ts`
- `src/modules/keywords/keyword.service.ts`
- `src/modules/keywords/keyword.types.ts`
- `src/modules/keywords/keyword.web.repository.ts`
- `src/modules/keywords/keyword.web.routes.ts`
- `src/public/css/p11-keyword-clusters.css`
- `src/views/keywords/index.ejs`
- `src/views/layout.ejs`

### 测试

- `tests/unit/keyword-bulk.test.ts`
- `tests/unit/keyword-filter.test.ts`
- `tests/unit/keyword-opportunity-score.test.ts`
- `tests/unit/keyword-schema.test.ts`
- `tests/integration/keyword-opportunity.service.test.ts`
- `tests/integration/keywords.api.test.ts`
- `tests/integration/keywords.service.test.ts`
- `tests/integration/keywords.web.test.ts`
- `tests/e2e/keywords.spec.ts`

## 7. Migration 安全性与回滚

- Production 基线为 45 个 migration；P1-P3 各新增一个，当前合计 48 个。
- 三个 migration 均为 additive；没有删除或重命名现有列、表或 enum value。
- P1 的非空 lifecycle 在加约束前先确定性回填旧记录。
- P2 primary 外键 nullable 且 `ON DELETE SET NULL`。
- P3 新表不改写历史 Keyword 数据。
- 应用回滚：先回滚 Web/Worker 到部署前镜像；旧代码会忽略新增列/表。
- 数据库回滚只能在确认没有新版本写入依赖后单独执行：依次删除 P3 新表、P2 外键/索引/列、P1 索引/列/enum。Production 执行前必须备份，并验证 restore；本开发任务未执行任何 Production migration。

## 8. 测试与 exact-head CI 证据

功能提交 exact SHA：`078a64fcefb1a839af25d819dfd4af2f6a039c7a`

GitHub Actions：[run 33620673513](https://github.com/liufaxing1978-droid/seogeo/actions/runs/33620673513)

- `production-audit`：通过。
- `deployment-artifact`：通过；runtime image、migration image 和 exact artifact source SHA 均验证。
- `verify`：通过。
  - Prisma validate/generate：通过。
  - 48 个 migration 在隔离 PostgreSQL 测试库全部应用成功。
  - Typecheck：通过。
  - Vitest：407 个 test files、1924 个 tests 全部通过，0 failed。
  - Build：通过。
- `e2e`：42 个 Playwright browser smoke tests 全部通过，0 failed。

## 9. 剩余 P4-P12

- P4 Target URL + Cannibalization：映射、冲突 URL、风险等级与建议；不得自动执行 merge/redirect/canonical。
- P5 Content Gap：无页面覆盖检测、内容任务入口、可追踪 Gap 状态。
- P6 AI Question Expansion：related/long-tail/question 扩展、schema validation、用户确认入库。
- P7 Entity Graph：轻量 Entity/alias/topic 关系，关联 Keyword/Cluster。
- P8 Content Brief Integration：从 Gap/Cluster 创建 Brief，不默认一词一页。
- P9 IndexNow + Sitemap + Crawler Health：幂等提交、重试、可观察 URL/抓取状态，并区分 crawler。
- P10 Traditional Search Data：Google/Bing 等已有数据源回流，明确来源和时间范围。
- P11 AI Citation Tracking：Bing AI Performance 优先、provider adapter，严格区分 OFFICIAL 与 INTERNAL_OBSERVATION。
- P12 Optimization Engine：衰退、冲突和更新建议，解释清楚且不自动执行高风险动作。

## 10. 最终 exact-head 验证规则

包含本报告的提交 SHA 无法自引用写入自身文件，因此最终 handoff 以 `git rev-parse HEAD`、Draft PR #193 的 exact-head checks 和对应 GitHub Actions run 为准。只有该最终 report-only exact head 的 required checks 全部通过，P1-P3 才关闭；最终 SHA 与 run 链接必须在交付消息中明确记录。
