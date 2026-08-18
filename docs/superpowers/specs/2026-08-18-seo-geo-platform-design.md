# SEO GEO 独立平台设计规范

**日期：** 2026-08-18  
**状态：** 已按对话确认内容整理，待仓库内评审  
**系统入口建议：** `seo.xingshantang.org`  
**被分析项目示例：** `xingshantang.org`

## 1. 产品定位

SEO GEO 是一个独立的、可服务多个网站的 SEO + GEO SaaS 平台，不与某一内容站绑定。系统同时覆盖传统 SEO、生成式搜索优化（GEO）、内容优化、实体与引用分析，以及高级版 AI Visibility 长期监控。

核心目标不是做“一次性 AI 审计器”，而是形成持续闭环：

`抓取 → 规则审计 → 历史存储 → AI/搜索采样 → 引用与实体解析 → DeepSeek 分析 → 任务 → 修复 → 再验证`

## 2. 产品版本边界

### 普通版

- 项目管理
- Crawler / 页面历史快照
- Technical SEO
- On-page SEO
- robots.txt / sitemap.xml
- Schema
- SEO Audit / Issue Detail
- 基础 GEO Score
- Citability 基础检测
- Entity 基础检测
- AI Crawler 检测
- DeepSeek SEO/GEO 分析
- 内容优化建议
- 基础报告

### 高级版

AI Visibility 整个模块属于高级版，包括：

- Prompt Library / Prompt Monitor
- 多 AI 平台采样
- 重复采样与历史答案
- AI Visibility
- Share of Voice
- Average Position
- Brand Mention
- Citation Tracking
- Owned / Earned / Competitor Citation
- Prompt × Platform 热力图
- Winning / Losing Prompts
- Global GEO / China GEO
- 竞争对手 SOV
- Answer Archive
- DeepSeek Visibility Intelligence
- Visibility 异常提醒
- 高级 GEO 报告

## 3. UI 与信息架构

视觉原则：深色左侧导航 + 白色主内容区 + 卡片指标 + 趋势图 + 表格 + 状态标签，保持高信息密度但层级清晰。

### 左侧导航

- 总览
  - 概览
- 项目
  - 项目列表
  - 页面中心
  - 任务中心
  - 抓取历史
- SEO
  - SEO 审计
  - 问题中心
  - 关键词
  - 内容分析
  - 内链分析
  - 技术 SEO
  - Schema
  - robots.txt
  - sitemap.xml
- GEO
  - GEO 概览
  - Citability
  - Entity
  - AI Crawler
  - 平台准备度
- AI Visibility · 高级版
  - AI 可见性
  - Prompt 监控
  - AI 平台
  - Citation 监控
  - 品牌提及
  - Share of Voice
  - 竞争对手
  - Answer Archive
- 内容
  - Topic Research
  - Content Gap
  - Content Brief
  - 内容优化
  - 内容更新
- DeepSeek
  - AI 分析中心
  - AI 任务
  - 调用记录
- 报告
  - 报告中心
  - 报告导出
- 系统
  - 项目设置
  - AI 设置
  - 用户权限
  - API
  - 系统设置

## 4. 六个核心页面

### 4.1 Dashboard

核心指标：SEO Score、GEO Score、AI Visibility、Citability、Entity Authority、AI Citations、Brand Mentions、Critical Issues。

页面包含：综合趋势、SEO 问题分布、GEO Opportunities、AI 平台表现、Prompt Monitor、竞争对手、DeepSeek 今日洞察、建议任务与最近活动。

每个数据卡必须支持点击钻取，并围绕三个问题组织：发生了什么、为什么、下一步做什么。

### 4.2 项目详情

Tabs：概览、SEO、GEO、AI 可见性、引用与提及、关键词、内容、页面、技术 SEO、竞争对手、历史记录、设置。

项目详情页提供项目级 DeepSeek Intelligence Panel，但 DeepSeek 只能读取真实数据并解释，不允许直接修改业务状态。

### 4.3 SEO Audit

规则引擎负责确定性检测；DeepSeek 负责解释、归纳和修复建议。

问题严重级别：Critical、High、Medium、Low。

SEO Audit 必须支持：规则版本、Issue 聚合、受影响页面、审计前后对比、已修复/新增/重新出现问题，以及创建修复任务。

### 4.4 GEO Overview

核心指标：GEO Score、AI Visibility、Citability、Citation Rate、Entity Authority、Brand Authority、AI Crawler Access、Share of Voice。

GEO Audit 与 AI Visibility 必须分离：前者评估“是否准备好被 AI 理解/引用”，后者记录“AI 实际是否提到/引用”。

支持 Global GEO / China GEO 两套视图。

### 4.5 AI Visibility（高级版）

真实采样维度：Prompt × Platform × Locale × Time。

核心指标：AI Visibility、SOV、Brand Mention Rate、Citation Rate、Owned Citation Rate、Average Position、Winning Prompts。

所有历史答案必须保留，不能只保存最后一次结果。

### 4.6 Prompt Detail（高级版）

展示单个 Prompt 在各平台的品牌出现、位置、官网引用、竞争品牌、趋势、Answer Snapshot、Citation History 和历史变化。

DeepSeek 负责跨平台差异分析、变化解释和行动建议。

## 5. 评分体系

统一评分：

- SEO Score
- GEO Score
- AI Visibility
- Citability
- Entity Authority
- Brand Authority
- Content Quality
- Technical Health

GEO Score 由可解释组件加权组成，示例权重：

- AI Visibility 25%
- Citability 20%
- Entity Authority 15%
- Brand Authority 15%
- Technical AI Readiness 15%
- Content GEO Quality 10%

所有评分必须保存组件与 engine_version，历史评分不得覆盖。

## 6. DeepSeek 架构

采用 Provider 抽象方案：

`业务模块 → AI Gateway → Provider Interface → DeepSeek`

第一版前台只显示 DeepSeek，底层预留 Gemini、Claude、OpenAI、Qwen、Doubao 等 Provider。

DeepSeek Chat 用于普通分析、摘要、分类和内容任务；DeepSeek Reasoner 用于复杂 GEO、竞争对手、引用与差距推理。

DeepSeek 禁止凭空产生：HTTP 状态、页面数量、robots/sitemap 结果、关键词排名、Citation 数量、AI Visibility、Prompt 排名、流量、Backlinks、Core Web Vitals。上述数据必须由 Crawler、API、Monitor 或 Rule Engine 产生。

## 7. 数据主干

系统使用两条主干：

### Page 主干

`Project → Crawl Run → Page → Page Snapshot → SEO/GEO/Content/Entity/Score`

### Prompt 主干（高级版）

`Project → Prompt → Prompt Sample → AI Platform Result → Answer Snapshot → Mention/Citation/Competitor`

两条主干通过 Entity、Citation、Metrics、DeepSeek Intelligence 连接。

## 8. 核心数据表

第一批核心表：

- `projects`
- `crawl_runs`
- `pages`
- `page_snapshots`
- `seo_rules`
- `seo_rule_versions`
- `seo_issues`
- `prompts`
- `prompt_samples`
- `ai_platform_results`
- `citations`
- `entities`
- `score_snapshots`
- `score_components`

历史数据原则：审计结果、评分、页面快照、Prompt Answer、Citation 等原则上 append-only，不覆盖历史值。

## 9. 服务模块

第一版采用模块化单体，而不是立即拆微服务：

- Project Module
- Crawler Module
- SEO Engine
- GEO Engine
- Visibility Module（高级版）
- Entity Module
- Content Module
- AI Gateway
- Metrics Module
- Task Module
- Report Module
- Auth / Billing / System

建议目录边界：

```text
src/
  modules/
    projects/
    crawler/
    seo/
    geo/
    visibility/
    entities/
    content/
    ai/
    metrics/
    tasks/
    reports/
  core/
  db/
  queue/
  auth/
```

Crawler 只能写 Page/Snapshot；SEO Engine 只能从 Snapshot 生成 Rule Result/Issue/Score；GEO Engine 不能承担真实 AI 平台采样；Visibility 独立负责 Prompt 采样与历史答案；AI Gateway 不得直接修改 Issue/Task 状态。

## 10. 异步任务

Crawler、SEO Audit、GEO Audit、Prompt Sampling、DeepSeek Analysis、Report Generation、Daily Metrics 均应通过 Job Queue 执行。

推荐第一版使用 Redis + BullMQ，并按领域拆队列：

- `crawl.queue`
- `seo-audit.queue`
- `geo-audit.queue`
- `visibility.queue`
- `ai.queue`
- `report.queue`

## 11. 数据存储

主数据库：PostgreSQL。

Redis：队列、缓存、分布式锁、Rate Limit。

原始 HTML 与超大 Answer Archive 后期可迁移对象存储；V1 只在数据库保存引用位置和元数据，避免过早引入复杂大数据架构。

## 12. 权限原则

高级版能力必须在 API 层校验，不能只靠前端隐藏菜单。

建议 feature flags：

- `SEO_AUDIT`
- `GEO_AUDIT`
- `CONTENT_AI`
- `AI_VISIBILITY`
- `PROMPT_MONITOR`
- `CITATION_MONITOR`
- `COMPETITOR_SOV`
- `ADVANCED_REPORTS`
- `API_ACCESS`

## 13. 推荐开发阶段

- P0：平台基础、项目、数据库、权限、任务队列、统一 UI
- P1：Crawler + Technical SEO
- P2：SEO Rule Engine + Audit
- P3：GEO Engine + Citability + Entity
- P4：DeepSeek AI Gateway + Intelligence
- P5：内容系统 + 竞争分析 + 报告
- P6：AI Visibility 高级版

## 14. 当前仓库现实状态

截至 2026-08-18，远端 `liufaxing1978-droid/seogeo` 的 `main` 分支仅有 Initial commit 和 `README.md`。此前对话中提到的 Task 02–08、HTTP Parser、Browser Rendering 等实现没有出现在该远端仓库。

因此实施计划按“从干净仓库建立独立平台”设计；如果已有本地/其他分支实现，应在对应阶段先做代码导入与兼容性审计，再决定复用或替换。

## 15. 推荐技术栈（待执行前最终确认）

为了延续 Node.js 技术路线，并满足模块化与后台 UI 需求，推荐：

- Node.js 22 LTS
- TypeScript
- Express 5
- EJS（服务端后台 UI，后续可按需迁移 React）
- PostgreSQL
- Prisma ORM
- Redis + BullMQ
- Zod
- Vitest + Supertest
- Playwright（关键后台流程）

该技术栈是本实施计划的默认假设；如果执行前决定改为 Next.js/React 或其他 ORM，需要先更新本规范和对应实施计划。