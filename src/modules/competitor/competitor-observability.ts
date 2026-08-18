export type CompetitorObservabilityEventName =
  | 'competitor.crawl.queued'
  | 'competitor.crawl.started'
  | 'competitor.crawl.completed'
  | 'competitor.crawl.failed'
  | 'competitor.comparison.created';

export interface CompetitorObservabilityEvent extends Record<string, unknown> {
  event: CompetitorObservabilityEventName;
  projectId: string;
  competitorId: string;
  crawlId?: string;
  comparisonId?: string;
  pageCount?: number;
  errorCode?: string;
}

export type CompetitorObservabilitySink = (event: CompetitorObservabilityEvent) => void;

function clean(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 160);
}

export class CompetitorObservability {
  constructor(private readonly sink: CompetitorObservabilitySink = (event) => console.info(event)) {}

  emit(event: CompetitorObservabilityEvent): void {
    this.sink({
      ...event,
      projectId: clean(event.projectId),
      competitorId: clean(event.competitorId),
      ...(event.crawlId ? { crawlId: clean(event.crawlId) } : {}),
      ...(event.comparisonId ? { comparisonId: clean(event.comparisonId) } : {}),
      ...(event.errorCode ? { errorCode: clean(event.errorCode) } : {})
    });
  }
}

export const competitorObservability = new CompetitorObservability();
