export type ContentQualityObservabilityEvent =
  | { event: 'content.quality.queued'; projectId: string; runId: string; queuedCount: 1 }
  | { event: 'content.quality.deduplicated'; projectId: string; runId: string; deduplicatedCount: 1 }
  | { event: 'content.quality.started'; projectId: string; runId: string; startedCount: 1 }
  | { event: 'content.quality.completed'; projectId: string; runId: string; completedCount: 1; documentCount: number; findingCount: number }
  | { event: 'content.quality.failed'; projectId: string; runId: string; failedCount: 1; errorCode: string }
  | { event: 'content.quality.findings.materialized'; projectId: string; runId: string; materializedCount: number }
  | { event: 'content.quality.finding.transitioned'; projectId: string; findingId: string; toStatus: 'OPEN' | 'IN_REVIEW' | 'DISMISSED'; transitionCount: 1 }
  | { event: 'content.quality.finding.accepted'; projectId: string; findingId: string; runId?: string; acceptedCount: 1 };

export type ContentQualityObservabilitySink = (event: ContentQualityObservabilityEvent) => void;

function clean(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 160);
}

function boundedCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1_000_000, Math.floor(value))) : 0;
}

export class ContentQualityObservability {
  constructor(private readonly sink: ContentQualityObservabilitySink = (event) => console.info(event)) {}

  emit(event: ContentQualityObservabilityEvent): void {
    switch (event.event) {
      case 'content.quality.queued':
        this.sink({ event: event.event, projectId: clean(event.projectId), runId: clean(event.runId), queuedCount: 1 });
        return;
      case 'content.quality.deduplicated':
        this.sink({ event: event.event, projectId: clean(event.projectId), runId: clean(event.runId), deduplicatedCount: 1 });
        return;
      case 'content.quality.started':
        this.sink({ event: event.event, projectId: clean(event.projectId), runId: clean(event.runId), startedCount: 1 });
        return;
      case 'content.quality.completed':
        this.sink({
          event: event.event, projectId: clean(event.projectId), runId: clean(event.runId), completedCount: 1,
          documentCount: boundedCount(event.documentCount), findingCount: boundedCount(event.findingCount)
        });
        return;
      case 'content.quality.failed':
        this.sink({ event: event.event, projectId: clean(event.projectId), runId: clean(event.runId), failedCount: 1, errorCode: clean(event.errorCode) });
        return;
      case 'content.quality.findings.materialized':
        this.sink({ event: event.event, projectId: clean(event.projectId), runId: clean(event.runId), materializedCount: boundedCount(event.materializedCount) });
        return;
      case 'content.quality.finding.transitioned':
        this.sink({ event: event.event, projectId: clean(event.projectId), findingId: clean(event.findingId), toStatus: event.toStatus, transitionCount: 1 });
        return;
      case 'content.quality.finding.accepted':
        this.sink({
          event: event.event, projectId: clean(event.projectId), findingId: clean(event.findingId), acceptedCount: 1,
          ...(event.runId ? { runId: clean(event.runId) } : {})
        });
    }
  }
}

export const contentQualityObservability = new ContentQualityObservability();
