import { describe, expect, it } from 'vitest';
import { ReportObservability, type ReportObservabilityEvent } from '../../src/modules/reporting/report-observability.js';

describe('P5-C report observability contract', () => {
  it('emits only bounded identifiers, version and aggregate counts', () => {
    const events: ReportObservabilityEvent[] = [];
    const observability = new ReportObservability((event) => events.push(event));

    observability.emit({ event: 'report.generated', projectId: 'project-1', reportId: 'report-1', reportVersion: 'PROJECT_REPORT_V1', sourceCount: 12 });
    observability.emit({ event: 'report.ai_summary.queued', projectId: 'project-1', reportId: 'report-1', reportVersion: 'PROJECT_REPORT_V1', taskId: 'task-1' });

    expect(events.map((event) => event.event)).toEqual(['report.generated', 'report.ai_summary.queued']);
    const serialized = JSON.stringify(events);
    for (const forbidden of ['factSnapshot', 'advisorySnapshot', 'Authorization', 'cookie=', 'prompt text', 'reasoning_content', 'full ai output', 'page body']) {
      expect(serialized).not.toContain(forbidden);
    }
  });
});
