# UI Reference Images

These images are visual targets for P10 UI productization. They define hierarchy, density, layout character and component style. They do **not** define application data, permissions, workflow semantics or backend capabilities.

The complete downloadable Codex design package contains the JPEG files listed below under `docs/ui/reference/`. Before Codex begins implementation, copy those JPEGs into the same repository path if they are not already present on the implementation branch. `SHA256SUMS.txt` is the integrity manifest for that exact reference set.

| File | Target |
|---|---|
| `01-login.jpg` | Login |
| `02-dashboard.jpg` | Main dashboard |
| `03-project-center.jpg` | Project Center |
| `04-seo-center.jpg` | SEO Center |
| `05-geo-visibility.jpg` | GEO / Visibility |
| `06-ai-analysis.jpg` | AI Analysis Center |
| `07-content-publishing.jpg` | Content & Publishing |
| `08-competitor-intelligence.jpg` | Competitor Intelligence |
| `09-report-center.jpg` | Report Center |
| `10-optimization-center.jpg` | Optimization Operations |
| `11-members-permissions.jpg` | Members & Permissions |

## Rules for Codex

1. Use references for visual composition, not hard-coded values.
2. Read the current route/repository/service before implementing a card/chart/table.
3. If a screenshot shows a metric with no truthful persisted source, render an explicit unavailable/empty state or omit it according to the approved design.
4. Never treat `UNKNOWN`, `NOT_ELIGIBLE`, `NO_DATA`, missing or failed evidence as numeric zero.
5. Never collapse domain states when doing so changes meaning.
6. Preserve RBAC, project scope, CSRF and feature gates.
7. Do not resize the application around one screenshot viewport.
