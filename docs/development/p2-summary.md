# SEO GEO 独立平台 — P2 阶段总结文档

**阶段：** SEO Rule Engine + Audit UI  
**状态：** 已完成并合并 `main`  
**仓库：** `liufaxing1978-droid/seogeo`  
**P2 最终合并提交：** `a5102d4d6e0496845fab940a87940b0f1458405d`  
**日期：** 2026-08-18

## 1. P2 阶段目标

P2 在 P1 的真实抓取事实之上建立确定性的 SEO 解释层。P1 回答“网站实际发生了什么”，P2 回答“这些事实构成什么 SEO 问题、影响哪些页面、如何形成可解释的 SEO Score，以及问题在多次审计之间是新增、持续、复发还是已修复”。

核心原则：

- P2 不重新抓网页，也不修改 P1 的 PageSnapshot / HTTP / robots / sitemap 历史事实。
- PASS / FAIL / UNKNOWN 全部由确定性 Rule Engine 产生。
- Raw Rule Result 与用户级 Stable Issue 分离。
- SEO Score 必须可拆解到具体规则、严重度、影响比例与扣分组件。
- DeepSeek 不参与 P2 的事实判断、严重度、分数或修复验证。

## 2. P2 完整链路

```text
Completed CrawlRun
→ PageSnapshot / HTTP / robots / sitemap facts
→ SeoAuditRun
→ Versioned Rule Engine
→ SeoRuleResult (PASS / FAIL / UNKNOWN)
→ SeoIssue + SeoIssueOccurrence + SeoIssuePage
→ SeoScore + SeoScoreComponent
→ Audit Compare
→ SEO Audit / Issue Center / Issue Detail UI
```

## 3. 数据模型基线

- `SeoAuditRun`
- `SeoRule`
- `SeoRuleVersion`
- `SeoRuleResult`
- `SeoIssue`
- `SeoIssueOccurrence`
- `SeoIssuePage`
- `SeoScore`
- `SeoScoreComponent`

## 4. 初始规则目录

P2 初始目录共 **20 条规则：15 条页面规则 + 5 条 Crawl 规则**。

### 页面规则

- `HTTP_5XX` — Server error response
- `HTTP_4XX` — Client error response
- `HTTP_REDIRECT` — Redirected URL
- `TITLE_MISSING` — Missing title
- `TITLE_TOO_SHORT` — Title too short（<20 characters）
- `TITLE_TOO_LONG` — Title too long（>60 characters）
- `META_DESCRIPTION_MISSING` — Missing meta description
- `META_DESCRIPTION_TOO_LONG` — Meta description too long（>160 characters）
- `H1_MISSING` — Missing H1
- `H1_MULTIPLE` — Multiple H1 headings
- `CANONICAL_MISSING` — Missing canonical
- `THIN_CONTENT` — Thin content（<200 words）
- `IMAGE_ALT_MISSING` — Images missing alt text
- `SLOW_RESPONSE` — Slow server response（>3000 ms）
- `HTML_TOO_LARGE` — HTML document too large（>2,000,000 bytes）

### Crawl 规则

- `ROBOTS_FETCH_FAILED`
- `ROBOTS_SERVER_ERROR`
- `SITEMAP_UNAVAILABLE`
- `SITEMAP_PARSE_ERROR`
- `SITEMAP_EMPTY`

## 5. Rule Versioning

`ruleCode` 是稳定逻辑身份；Severity、Weight、Threshold、Detection Config、SEO Impact、Fix Guide 属于 `SeoRuleVersion`。历史 `SeoRuleResult` 指向执行当时的准确版本，因此规则以后升级也不会改变历史审计语义。

## 6. PASS / FAIL / UNKNOWN

- PASS：事实足够且规则条件不成立。
- FAIL：事实足够且规则条件成立。
- UNKNOWN：事实不足，不能可靠判断。
- UNKNOWN 不制造人工 SEO 扣分。

## 7. Issue Lifecycle 与 Audit Compare

Comparison：

- `NEW`
- `PERSISTENT`
- `REGRESSED`
- `FIXED`

Stable Issue workflow：

- `OPEN`
- `IN_PROGRESS`
- `PARTIALLY_FIXED`
- `RESOLVED`
- `IGNORED`
- `REGRESSED`

人工或未来 AI 可以辅助工作流，但不能直接把技术 Issue 判定为 `RESOLVED`；必须由后续 Crawl + deterministic Audit 验证。

## 8. SEO Score

```text
penalty = weight × severityMultiplier × pageImpactFactor × importanceFactor
SEO Score = clamp(100 - Σ penalty, 0, 100)

CRITICAL = 4.0
HIGH     = 2.5
MEDIUM   = 1.5
LOW      = 0.5
```

`pageImpactFactor = affectedPages / eligiblePages`，限制在 0~1；P2 当前 `importanceFactor = 1`。UNKNOWN 不构成人工惩罚。

## 9. UI 与 API

P2 已完成：

- SEO Audit Dashboard
- Issue Center
- Issue Detail
- Workflow Actions
- Audit Compare（NEW / PERSISTENT / REGRESSED / FIXED）
- SEO 审计与问题中心真实导航

API 支持 Audit 创建、SEO Summary、Audit History / Detail、Issue List / Detail、允许的 Issue Workflow Status 更新，以及 Audit Compare。

## 10. 异步执行与 Observability

生产审计通过 BullMQ `seo-audit` queue 执行，PostgreSQL 是业务 source of truth。

结构化事件：

- `seo.audit.started`
- `seo.rule.evaluated.summary`
- `seo.issues.synced`
- `seo.score.calculated`
- `seo.audit.completed`
- `seo.audit.failed`

日志只保存 ID、Engine Version 和聚合统计，不记录 Raw HTML、页面正文、Evidence、Cookie、Authorization 等敏感信息。

## 11. P1 / P2 边界

P1 owns crawler facts；P2 owns SEO interpretation。P2 可以读取 P1 历史事实，但不能为了让 Audit 通过而修改 P1 数据。

## 12. DeepSeek / AI 边界

DeepSeek 不决定：

- PASS / FAIL
- HTTP Status
- Affected Pages Count
- Issue Severity
- SEO Score
- NEW / PERSISTENT / REGRESSED / FIXED
- 技术问题是否真正修复

P4 接入 DeepSeek 后，只能通过 AI Gateway 做解释、摘要和修复建议。

## 13. 最终验收

- `verify`：Prisma validate/generate/migrate、TypeScript、**146 个自动化测试**、production build — passed
- `production-audit`：deployable runtime dependency tree 安全审计 — passed
- `e2e`：Chromium + Playwright browser smoke tests — passed

## 14. P2 最终成果

```text
P1 Facts
→ Deterministic SEO Rule Engine
→ Rule Results
→ Stable Issues
→ Explainable SEO Score
→ Audit Compare
→ SEO Audit UI
```

P2 最终合并提交：

`a5102d4d6e0496845fab940a87940b0f1458405d`

## 15. P3 交接

P3 = GEO Engine + Citability + Entity。

P3 优先产生 deterministic `GEO_READINESS_V1`，不会把尚未存在的 AI 平台采样伪造成 AI Visibility。真正的 ChatGPT / Gemini / Perplexity / DeepSeek / 豆包 / 百度 AI 等平台可见性和引用采样仍属于 P6。
