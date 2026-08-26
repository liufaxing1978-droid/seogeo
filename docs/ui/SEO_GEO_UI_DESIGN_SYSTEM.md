# SEO GEO UI Design System

**Applies to:** P10 UI productization  
**Rendering model:** Express + EJS + existing CSS/JS  
**Visual references:** `docs/ui/reference/`

## 1. Product character

The UI should feel calm, precise, premium and technically capable: a modern Apple-inspired enterprise console without copying Apple product chrome or adding unnecessary novelty.

Core attributes: clear, light, high-signal, trustworthy, data-first, subtle depth, restrained motion.

## 2. Visual tokens

Use semantic CSS custom properties rather than page-specific literal colors.

```css
:root {
  --ui-bg: #f7f9fc;
  --ui-surface: #ffffff;
  --ui-surface-subtle: #fbfcfe;
  --ui-surface-elevated: rgba(255, 255, 255, 0.92);
  --ui-border: #e8edf5;
  --ui-border-strong: #d9e1ec;
  --ui-text: #111827;
  --ui-text-secondary: #667085;
  --ui-text-tertiary: #98a2b3;
  --ui-primary: #2563eb;
  --ui-primary-soft: #eef4ff;
  --ui-cyan: #06b6d4;
  --ui-violet: #7c3aed;
  --ui-success: #10b981;
  --ui-warning: #f59e0b;
  --ui-danger: #ef4444;
  --ui-radius-xs: 8px;
  --ui-radius-control: 10px;
  --ui-radius-card: 16px;
  --ui-radius-panel: 20px;
  --ui-shadow-sm: 0 1px 2px rgba(16, 24, 40, 0.04);
  --ui-shadow-card: 0 10px 30px rgba(16, 24, 40, 0.05);
}
```

Final values may be tuned during UI-01, but every page consumes shared tokens.

## 3. Typography

Preferred system stack:

```css
font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
  "Hiragino Sans GB", "Microsoft YaHei", Arial, sans-serif;
```

Do not add a remote font dependency just for visual similarity.

Recommended hierarchy:

- Page title: 28-32 px, 700
- Section title: 18-20 px, 650/700
- Card metric: 28-36 px, 650/700
- Body: 14 px
- Secondary/meta: 12-13 px
- Table text: 13-14 px

## 4. Layout

Desktop shell: fixed/collapsible sidebar, stable top bar, 20-32 px content gutters, 16-24 px panel gaps, CSS Grid for metric/dashboard layouts and normal flow for long content. Avoid absolute positioning for core layout.

## 5. Surfaces

### Metric card
White surface, 1 px neutral border, 16 px radius, subtle shadow, label + large value + secondary status/trend, optional sparkline/icon.

### Data panel
White surface, 16 px radius, header with title/legend/bounded action, body for table/chart/list/state.

### AI accent panel
A contained blue/cyan/violet gradient is allowed for advisory AI insights. Critical actions must not rely on decorative treatment.

## 6. Components

### Buttons
Primary = solid blue. Secondary = white + neutral border. Tertiary = text/ghost. Danger only for destructive actions. Disabled state must be semantic and visibly disabled.

### Badges
Use text + color: success/verified/active green; warning/pending/partial amber; danger/failed/high-risk red; running/info blue; premium/AI violet; unknown/neutral gray. Never collapse distinct backend states into one friendly UI status if meaning changes.

### Tables
Subtle separators, stable status column, numeric alignment, horizontal scrolling on narrow widths. Do not hide evidence/status columns only to imitate a screenshot.

### Forms
Persistent labels, 40-44 px common control height, visible field errors. Passwords are never echoed. UI work never bypasses CSRF.

### Tabs
Use for sibling views inside one center, not unrelated route families.

### Empty states
Every center needs a truthful designed empty state, e.g. `暂无采样数据`, `尚未生成报告`, `当前没有可处理的优化事项`. Show an action only when the application genuinely supports it.

### Charts
Simple lines/bars/donuts, restrained grid lines, stable semantic colors, explicit gaps for missing evidence. Never interpolate unknown evidence as zero. Displayed values must match the same persisted facts used elsewhere on the page.

## 7. Navigation

First-level labels:

- 仪表盘
- 项目中心
- SEO 中心
- GEO / 可见度
- AI 分析中心
- 内容与发布
- 竞品情报
- 报告中心
- 优化运营
- 成员与权限
- 设置

Secondary pages live inside their owning center. Project-scoped routes must preserve the current project ID. With no selected project, project-scoped navigation returns to Project Center rather than inventing context.

## 8. Motion

120-220 ms hover/focus/panel transitions; no continuous decorative motion; honor `prefers-reduced-motion`.

## 9. Responsive rules

- ≥1440: full desktop, four metric cards where appropriate
- 1024-1439: desktop/tablet, two-column metric grids where needed
- <1024: collapsible navigation and stacked panels

Tables scroll horizontally rather than becoming illegible.

## 10. Accessibility

Visible focus ring, semantic headings, input labels, accessible names for icon-only buttons, sufficient contrast, semantic active navigation, status not color-only, no hover-only essential actions.

## 11. Data integrity checklist

Before adding a metric/card/chart/table, Codex must answer:

1. What repository/service/API supplies it?
2. Is evidence known-present, known-empty, unknown, unsupported or not eligible?
3. What project/market/window scope applies?
4. Does current RBAC permit this user to see/action it?
5. What is the empty/error state?

If these cannot be answered from the current codebase, preserve the visual slot only with a truthful unavailable/empty state; never invent data.
