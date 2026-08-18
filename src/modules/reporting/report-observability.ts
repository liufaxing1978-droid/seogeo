export type ReportObservabilityEventName = 'report.generated' | 'report.ai_summary.queued';

export interface ReportObservabilityEvent extends Record<string, unknown> {
  event: ReportObservabilityEventName;
  projectId: string;
  reportId: string;
  reportVersion: string;
  taskId?: string;
  sourceCount?: number;
}

export type ReportObservabilitySink = (event: ReportObservabilityEvent) => void;

function clean(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 160);
}

export class ReportObservability {
  constructor(private readonly sink: ReportObservabilitySink = (event) => console.info(event)) {}

  emit(event: ReportObservabilityEvent): void {
    this.sink({
      ...event,
      projectId: clean(event.projectId),
      reportId: clean(event.reportId),
      reportVersion: clean(event.reportVersion),
      ...(event.taskId ? { taskId: clean(event.taskId) } : {})
    });
  }
}

export const reportObservability = new ReportObservability();
