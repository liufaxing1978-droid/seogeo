export type FeedbackObservabilityEventName =
  | 'optimization.feedback.accepted'
  | 'optimization.feedback.deferred'
  | 'optimization.feedback.profile.created'
  | 'optimization.feedback.reconciled';

export interface FeedbackObservabilityEvent extends Record<string, unknown> {
  event: FeedbackObservabilityEventName;
  projectId: string;
  experimentId?: string;
  observationId?: string;
  feedbackEvidenceId?: string;
  feedbackProfileId?: string;
  recommendedActionType?: string;
  marketCode?: string;
  locale?: string;
  sampleCount?: number;
  historicalRankAdjustment?: number;
  reasonCode?: string;
}

export type FeedbackObservabilitySink = (event: FeedbackObservabilityEvent) => void;

function clean(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').slice(0, 160);
}

function optionalClean(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? clean(value) : undefined;
}

function optionalFinite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export class FeedbackObservability {
  constructor(
    private readonly sink: FeedbackObservabilitySink = (event) => console.info(event)
  ) {}

  emit(event: FeedbackObservabilityEvent): void {
    const experimentId = optionalClean(event.experimentId);
    const observationId = optionalClean(event.observationId);
    const feedbackEvidenceId = optionalClean(event.feedbackEvidenceId);
    const feedbackProfileId = optionalClean(event.feedbackProfileId);
    const recommendedActionType = optionalClean(event.recommendedActionType);
    const marketCode = optionalClean(event.marketCode);
    const locale = optionalClean(event.locale);
    const reasonCode = optionalClean(event.reasonCode);
    const sampleCount = optionalFinite(event.sampleCount);
    const historicalRankAdjustment = optionalFinite(event.historicalRankAdjustment);

    this.sink({
      event: event.event,
      projectId: clean(event.projectId),
      ...(experimentId ? { experimentId } : {}),
      ...(observationId ? { observationId } : {}),
      ...(feedbackEvidenceId ? { feedbackEvidenceId } : {}),
      ...(feedbackProfileId ? { feedbackProfileId } : {}),
      ...(recommendedActionType ? { recommendedActionType } : {}),
      ...(marketCode ? { marketCode } : {}),
      ...(locale ? { locale } : {}),
      ...(sampleCount !== undefined ? { sampleCount } : {}),
      ...(historicalRankAdjustment !== undefined ? { historicalRankAdjustment } : {}),
      ...(reasonCode ? { reasonCode } : {})
    });
  }
}

export const feedbackObservability = new FeedbackObservability();
