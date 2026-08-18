# P5-C Reporting Design

## Goal

Build project-scoped report snapshots that combine P2 SEO, P3 GEO, P5-A Content and P5-B Competitor facts without blurring deterministic facts and AI advice.

## Non-goals

- no P6 AI Visibility sampling
- no scheduled email delivery
- no PDF renderer in P5-C
- no third-party ranking, traffic or keyword-volume data
- no AI mutation of deterministic source tables

## Architecture

`ReportSnapshot` is an immutable project report snapshot. Generation reads only already-persisted project data. The snapshot stores deterministic facts, advisory AI summaries separately, source references and a version string.

`PROJECT_REPORT_V1` is generated synchronously because it is a bounded database aggregation, not a crawler or paid provider job.

Optional executive narrative uses a new P4 AI task type `REPORT_EXECUTIVE_SUMMARY` and prompt `project-report-summary-v1`. The AI receives only the persisted report packet and must preserve fact/advice separation. Provider calls remain owned by the existing P4 AI worker.

## Persistence

### ReportSnapshot

- `id`
- `projectId`
- `reportType = PROJECT_SUMMARY`
- `reportVersion = PROJECT_REPORT_V1`
- `factSnapshot` JSON
- `advisorySnapshot` JSON
- `sourceReferences` JSON
- `executiveAiTaskId?`
- `createdAt`

Reports are immutable except for attaching `executiveAiTaskId` after an explicit AI-summary request.

## Deterministic fact packet

Bounded report facts include:

- project metadata
- latest completed SEO score and open issue counts by severity/status
- latest completed GEO score/dimension facts where available
- ContentDocument count and open ContentOpportunity counts by priority/category
- competitor count and latest deterministic comparison gap counts (`AHEAD/BEHIND/EVEN/UNKNOWN`)

Missing facts remain `null` / `UNKNOWN`; they are never converted to zero unless zero is an actual measured count.

## Advisory packet

The report may include bounded summaries from already-completed P4/P5 AI tasks. These stay under `advisorySnapshot`, visibly labeled advisory, with task IDs/source refs. The report builder never promotes AI statements into deterministic facts.

## Feature gates

Introduce `REPORTING` for Standard/Advanced/Enterprise. Keep `ADVANCED_REPORTS` unchanged for future advanced scheduling, bundles or automation.

## REST

- `POST /api/v1/projects/:projectId/reports`
- `GET /api/v1/projects/:projectId/reports`
- `GET /api/v1/projects/:projectId/reports/:reportId`
- `GET /api/v1/projects/:projectId/reports/:reportId/export.json`
- `POST /api/v1/projects/:projectId/reports/:reportId/ai-summary`

## Web

- `/projects/:id/reports`
- `/projects/:id/reports/:reportId`
- POST generate report
- POST executive summary
- JSON download link
- print-friendly browser view

The report page must visually separate “确定性事实” and “AI 建议/总结”.

## Observability

Allowed events:

- `report.generated`
- `report.ai_summary.queued`

Allowed fields: projectId, reportId, reportVersion, taskId and bounded aggregate counts. Never log report JSON, AI output, prompts or credentials.

## Acceptance

- snapshot is reproducible from persisted sources at generation time
- no live web/DeepSeek calls during normal report generation
- JSON export matches stored snapshot
- AI summary uses the P4 queue/gateway only
- P6 fields remain absent
- integration and Chromium E2E cover report generation/view/export
