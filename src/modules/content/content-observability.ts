export type ContentObservabilityEventName =
  | 'content.refresh.queued'
  | 'content.refresh.started'
  | 'content.document.updated'
  | 'content.opportunity.updated'
  | 'content.refresh.completed'
  | 'content.refresh.failed';

export interface ContentObservabilityEvent extends Record<string, unknown> {
  event: ContentObservabilityEventName;
  projectId: string;
  documentId?: string;
  documentsUpdated?: number;
  opportunitiesEvaluated?: number;
  errorCode?: string;
}

export type ContentObservabilitySink = (event: ContentObservabilityEvent) => void;

function clean(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 160);
}

export class ContentObservability {
  constructor(private readonly sink: ContentObservabilitySink = (event) => console.info(event)) {}

  emit(event: ContentObservabilityEvent): void {
    this.sink({
      ...event,
      projectId: clean(event.projectId),
      ...(event.documentId ? { documentId: clean(event.documentId) } : {}),
      ...(event.errorCode ? { errorCode: clean(event.errorCode) } : {})
    });
  }
}

export const contentObservability = new ContentObservability();
