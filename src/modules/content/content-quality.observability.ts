export type ContentQualityObservabilityEventName =
  | 'content.quality.queued'
  | 'content.quality.started'
  | 'content.quality.completed'
  | 'content.quality.failed'
  | 'content.quality.findings.materialized'
  | 'content.quality.finding.accepted';

export interface ContentQualityObservabilityEvent extends Record<string, unknown> {
  event: ContentQualityObservabilityEventName;
  projectId: string;
  runId?: string;
  findingId?: string;
  documentCount?: number;
  findingCount?: number;
  errorCode?: string;
}

export type ContentQualityObservabilitySink = (event: ContentQualityObservabilityEvent) => void;

function clean(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 160);
}

export class ContentQualityObservability {
  constructor(private readonly sink: ContentQualityObservabilitySink = (event) => console.info(event)) {}

  emit(event: ContentQualityObservabilityEvent): void {
    this.sink({
      ...event,
      projectId: clean(event.projectId),
      ...(event.runId ? { runId: clean(event.runId) } : {}),
      ...(event.findingId ? { findingId: clean(event.findingId) } : {}),
      ...(event.errorCode ? { errorCode: clean(event.errorCode) } : {})
    });
  }
}

export const contentQualityObservability = new ContentQualityObservability();
